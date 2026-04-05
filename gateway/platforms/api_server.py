"""
OpenAI-compatible API server platform adapter.

Exposes an HTTP server with endpoints:
- POST /v1/chat/completions        — OpenAI Chat Completions format (stateless; opt-in session continuity via X-Hermes-Session-Id header)
- POST /v1/responses               — OpenAI Responses API format (stateful via previous_response_id)
- GET  /v1/responses/{response_id} — Retrieve a stored response
- DELETE /v1/responses/{response_id} — Delete a stored response
- GET  /v1/models                  — lists hermes-agent as an available model
- GET  /health                     — health check

Any OpenAI-compatible frontend (Open WebUI, LobeChat, LibreChat,
AnythingLLM, NextChat, ChatBox, etc.) can connect to hermes-agent
through this adapter by pointing at http://localhost:8642/v1.

Requires:
- aiohttp (already available in the gateway)
"""

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

try:
    from aiohttp import web
    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False
    web = None  # type: ignore[assignment]

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    SendResult,
)

logger = logging.getLogger(__name__)

# Default settings
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8642
MAX_STORED_RESPONSES = 100
MAX_REQUEST_BYTES = 1_000_000  # 1 MB default limit for POST bodies


def check_api_server_requirements() -> bool:
    """Check if API server dependencies are available."""
    return AIOHTTP_AVAILABLE


class ResponseStore:
    """
    SQLite-backed LRU store for Responses API state.

    Each stored response includes the full internal conversation history
    (with tool calls and results) so it can be reconstructed on subsequent
    requests via previous_response_id.

    Persists across gateway restarts.  Falls back to in-memory SQLite
    if the on-disk path is unavailable.
    """

    def __init__(self, max_size: int = MAX_STORED_RESPONSES, db_path: str = None):
        self._max_size = max_size
        if db_path is None:
            try:
                from hermes_cli.config import get_hermes_home
                db_path = str(get_hermes_home() / "response_store.db")
            except Exception:
                db_path = ":memory:"
        try:
            self._conn = sqlite3.connect(db_path, check_same_thread=False)
        except Exception:
            self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS responses (
                response_id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                accessed_at REAL NOT NULL
            )"""
        )
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS conversations (
                name TEXT PRIMARY KEY,
                response_id TEXT NOT NULL
            )"""
        )
        self._conn.commit()
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS auth_tokens (
                jti TEXT PRIMARY KEY,
                token_type TEXT NOT NULL,
                issued_at REAL NOT NULL,
                expires_at REAL NOT NULL
            )"""
        )
        self._conn.commit()

    def store_refresh_token(self, jti: str, expires_at: float) -> None:
        import time
        self._conn.execute(
            "INSERT OR REPLACE INTO auth_tokens (jti, token_type, issued_at, expires_at) VALUES (?, 'refresh', ?, ?)",
            (jti, time.time(), expires_at),
        )
        self._conn.commit()

    def is_refresh_token_valid(self, jti: str) -> bool:
        import time
        row = self._conn.execute(
            "SELECT token_type, expires_at FROM auth_tokens WHERE jti = ?", (jti,)
        ).fetchone()
        if row is None:
            return False
        token_type, expires_at = row
        return token_type == "refresh" and expires_at > time.time()

    def revoke_token(self, jti: str) -> None:
        self._conn.execute(
            "UPDATE auth_tokens SET token_type='revoked' WHERE jti = ?", (jti,)
        )
        self._conn.commit()

    def prune_expired_tokens(self) -> None:
        import time
        self._conn.execute("DELETE FROM auth_tokens WHERE expires_at < ?", (time.time(),))
        self._conn.commit()

    def get(self, response_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a stored response by ID (updates access time for LRU)."""
        row = self._conn.execute(
            "SELECT data FROM responses WHERE response_id = ?", (response_id,)
        ).fetchone()
        if row is None:
            return None
        import time
        self._conn.execute(
            "UPDATE responses SET accessed_at = ? WHERE response_id = ?",
            (time.time(), response_id),
        )
        self._conn.commit()
        return json.loads(row[0])

    def put(self, response_id: str, data: Dict[str, Any]) -> None:
        """Store a response, evicting the oldest if at capacity."""
        import time
        self._conn.execute(
            "INSERT OR REPLACE INTO responses (response_id, data, accessed_at) VALUES (?, ?, ?)",
            (response_id, json.dumps(data, default=str), time.time()),
        )
        # Evict oldest entries beyond max_size
        count = self._conn.execute("SELECT COUNT(*) FROM responses").fetchone()[0]
        if count > self._max_size:
            self._conn.execute(
                "DELETE FROM responses WHERE response_id IN "
                "(SELECT response_id FROM responses ORDER BY accessed_at ASC LIMIT ?)",
                (count - self._max_size,),
            )
        self._conn.commit()

    def delete(self, response_id: str) -> bool:
        """Remove a response from the store. Returns True if found and deleted."""
        cursor = self._conn.execute(
            "DELETE FROM responses WHERE response_id = ?", (response_id,)
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def get_conversation(self, name: str) -> Optional[str]:
        """Get the latest response_id for a conversation name."""
        row = self._conn.execute(
            "SELECT response_id FROM conversations WHERE name = ?", (name,)
        ).fetchone()
        return row[0] if row else None

    def set_conversation(self, name: str, response_id: str) -> None:
        """Map a conversation name to its latest response_id."""
        self._conn.execute(
            "INSERT OR REPLACE INTO conversations (name, response_id) VALUES (?, ?)",
            (name, response_id),
        )
        self._conn.commit()

    def close(self) -> None:
        """Close the database connection."""
        try:
            self._conn.close()
        except Exception:
            pass

    def __len__(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM responses").fetchone()
        return row[0] if row else 0


# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------

_CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
}


if AIOHTTP_AVAILABLE:
    @web.middleware
    async def cors_middleware(request, handler):
        """Add CORS headers for explicitly allowed origins; handle OPTIONS preflight."""
        adapter = request.app.get("api_server_adapter")
        origin = request.headers.get("Origin", "")
        cors_headers = None
        if adapter is not None:
            if not adapter._origin_allowed(origin):
                return web.Response(status=403)
            cors_headers = adapter._cors_headers_for_origin(origin)

        if request.method == "OPTIONS":
            if cors_headers is None:
                return web.Response(status=403)
            return web.Response(status=200, headers=cors_headers)

        response = await handler(request)
        if cors_headers is not None:
            response.headers.update(cors_headers)
        return response
else:
    cors_middleware = None  # type: ignore[assignment]


def _openai_error(message: str, err_type: str = "invalid_request_error", param: str = None, code: str = None) -> Dict[str, Any]:
    """OpenAI-style error envelope."""
    return {
        "error": {
            "message": message,
            "type": err_type,
            "param": param,
            "code": code,
        }
    }


if AIOHTTP_AVAILABLE:
    @web.middleware
    async def body_limit_middleware(request, handler):
        """Reject overly large request bodies early based on Content-Length."""
        if request.method in ("POST", "PUT", "PATCH"):
            cl = request.headers.get("Content-Length")
            if cl is not None:
                try:
                    if int(cl) > MAX_REQUEST_BYTES:
                        return web.json_response(_openai_error("Request body too large.", code="body_too_large"), status=413)
                except ValueError:
                    return web.json_response(_openai_error("Invalid Content-Length header.", code="invalid_content_length"), status=400)
        return await handler(request)
else:
    body_limit_middleware = None  # type: ignore[assignment]

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


if AIOHTTP_AVAILABLE:
    @web.middleware
    async def security_headers_middleware(request, handler):
        """Add security headers to all responses (including errors)."""
        response = await handler(request)
        for k, v in _SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response
else:
    security_headers_middleware = None  # type: ignore[assignment]


class _IdempotencyCache:
    """In-memory idempotency cache with TTL and basic LRU semantics."""
    def __init__(self, max_items: int = 1000, ttl_seconds: int = 300):
        from collections import OrderedDict
        self._store = OrderedDict()
        self._ttl = ttl_seconds
        self._max = max_items

    def _purge(self):
        import time as _t
        now = _t.time()
        expired = [k for k, v in self._store.items() if now - v["ts"] > self._ttl]
        for k in expired:
            self._store.pop(k, None)
        while len(self._store) > self._max:
            self._store.popitem(last=False)

    async def get_or_set(self, key: str, fingerprint: str, compute_coro):
        self._purge()
        item = self._store.get(key)
        if item and item["fp"] == fingerprint:
            return item["resp"]
        resp = await compute_coro()
        import time as _t
        self._store[key] = {"resp": resp, "fp": fingerprint, "ts": _t.time()}
        self._purge()
        return resp


_idem_cache = _IdempotencyCache()


def _make_request_fingerprint(body: Dict[str, Any], keys: List[str]) -> str:
    from hashlib import sha256
    subset = {k: body.get(k) for k in keys}
    return sha256(repr(subset).encode("utf-8")).hexdigest()


class APIServerAdapter(BasePlatformAdapter):
    """
    OpenAI-compatible HTTP API server adapter.

    Runs an aiohttp web server that accepts OpenAI-format requests
    and routes them through hermes-agent's AIAgent.
    """

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform.API_SERVER)
        extra = config.extra or {}
        self._host: str = extra.get("host", os.getenv("API_SERVER_HOST", DEFAULT_HOST))
        self._port: int = int(extra.get("port", os.getenv("API_SERVER_PORT", str(DEFAULT_PORT))))
        self._api_key: str = extra.get("key", os.getenv("API_SERVER_KEY", ""))
        self._cors_origins: tuple[str, ...] = self._parse_cors_origins(
            extra.get("cors_origins", os.getenv("API_SERVER_CORS_ORIGINS", "")),
        )
        self._app: Optional["web.Application"] = None
        self._runner: Optional["web.AppRunner"] = None
        self._site: Optional["web.TCPSite"] = None
        self._response_store = ResponseStore()
        self._session_db: Optional[Any] = None  # Lazy-init SessionDB for session continuity
        self._jwt_secret: Optional[bytes] = (
            self._derive_jwt_secret(self._api_key) if self._api_key else None
        )

    @staticmethod
    def _derive_jwt_secret(api_key: str) -> bytes:
        import hashlib
        return hashlib.pbkdf2_hmac(
            "sha256",
            api_key.encode("utf-8"),
            b"hermes-jwt-salt-v1",
            iterations=100_000,
        )

    @staticmethod
    def _parse_cors_origins(value: Any) -> tuple[str, ...]:
        """Normalize configured CORS origins into a stable tuple."""
        if not value:
            return ()

        if isinstance(value, str):
            items = value.split(",")
        elif isinstance(value, (list, tuple, set)):
            items = value
        else:
            items = [str(value)]

        return tuple(str(item).strip() for item in items if str(item).strip())

    def _cors_headers_for_origin(self, origin: str) -> Optional[Dict[str, str]]:
        """Return CORS headers for an allowed browser origin."""
        if not origin or not self._cors_origins:
            return None

        if "*" in self._cors_origins:
            headers = dict(_CORS_HEADERS)
            headers["Access-Control-Allow-Origin"] = "*"
            headers["Access-Control-Max-Age"] = "600"
            return headers

        if origin not in self._cors_origins:
            return None

        headers = dict(_CORS_HEADERS)
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
        headers["Access-Control-Max-Age"] = "600"
        return headers

    def _origin_allowed(self, origin: str) -> bool:
        """Allow non-browser clients and explicitly configured browser origins."""
        if not origin:
            return True

        if not self._cors_origins:
            return False

        return "*" in self._cors_origins or origin in self._cors_origins

    # ------------------------------------------------------------------
    # Auth helper
    # ------------------------------------------------------------------

    def _check_auth(self, request: "web.Request") -> Optional["web.Response"]:
        """
        Validate Bearer token from Authorization header or query param.

        First attempts JWT decode for short-lived access tokens,
        then falls back to raw API key comparison for backward compatibility.
        Returns None if auth is OK, or a 401 web.Response on failure.
        If no API key is configured, all requests are allowed.
        """
        if not self._api_key:
            return None  # No key configured — allow all (local-only use)

        # Try to extract token from Authorization header or query parameter
        auth_header = request.headers.get("Authorization", "")
        if not auth_header:
            auth_header = "Bearer " + request.query.get("token", "")

        if not auth_header.startswith("Bearer "):
            return web.json_response(
                {"error": {"message": "Invalid API key", "type": "invalid_request_error", "code": "invalid_api_key"}},
                status=401,
            )

        token = auth_header[7:].strip()

        # Try JWT decode first
        if self._jwt_secret and token != self._api_key:
            try:
                import jwt as pyjwt
                payload = pyjwt.decode(token, self._jwt_secret, algorithms=["HS256"])
                if payload.get("type") == "access":
                    return None  # Auth OK — stateless access token
            except Exception:
                pass  # Fall through to raw key check

        # Raw key fallback (backward compat)
        if token == self._api_key:
            return None

        return web.json_response(
            {"error": {"message": "Invalid API key", "type": "invalid_request_error", "code": "invalid_api_key"}},
            status=401,
        )

    # ------------------------------------------------------------------
    # Session DB helper
    # ------------------------------------------------------------------

    def _ensure_session_db(self):
        """Lazily initialise and return the shared SessionDB instance.

        Sessions are persisted to ``state.db`` so that ``hermes sessions list``
        shows API-server conversations alongside CLI and gateway ones.
        """
        if self._session_db is None:
            try:
                from hermes_state import SessionDB
                self._session_db = SessionDB()
            except Exception as e:
                logger.debug("SessionDB unavailable for API server: %s", e)
        return self._session_db

    # ------------------------------------------------------------------
    # Agent creation helper
    # ------------------------------------------------------------------

    def _create_agent(
        self,
        ephemeral_system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        stream_delta_callback=None,
        tool_progress_callback=None,
    ) -> Any:
        """
        Create an AIAgent instance using the gateway's runtime config.

        Uses _resolve_runtime_agent_kwargs() to pick up model, api_key,
        base_url, etc. from config.yaml / env vars.  Toolsets are resolved
        from config.yaml platform_toolsets.api_server (same as all other
        gateway platforms), falling back to the hermes-api-server default.
        """
        from run_agent import AIAgent
        from gateway.run import _resolve_runtime_agent_kwargs, _resolve_gateway_model, _load_gateway_config
        from hermes_cli.tools_config import _get_platform_tools

        runtime_kwargs = _resolve_runtime_agent_kwargs()
        model = _resolve_gateway_model()

        user_config = _load_gateway_config()
        enabled_toolsets = sorted(_get_platform_tools(user_config, "api_server"))

        max_iterations = int(os.getenv("HERMES_MAX_ITERATIONS", "90"))

        agent = AIAgent(
            model=model,
            **runtime_kwargs,
            max_iterations=max_iterations,
            quiet_mode=True,
            verbose_logging=False,
            ephemeral_system_prompt=ephemeral_system_prompt or None,
            enabled_toolsets=enabled_toolsets,
            session_id=session_id,
            platform="api_server",
            stream_delta_callback=stream_delta_callback,
            tool_progress_callback=tool_progress_callback,
            session_db=self._ensure_session_db(),
        )
        return agent

    # ------------------------------------------------------------------
    # HTTP Handlers
    # ------------------------------------------------------------------


    async def _handle_auth_token(self, request: "web.Request") -> "web.Response":
        """POST /api/auth/token - Exchange raw API key for JWT tokens."""
        if not self._api_key:
            return web.json_response(
                {"error": {"message": "No API key configured", "type": "server_error", "code": "no_api_key"}},
                status=501,
            )

        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": {"message": "Invalid JSON", "type": "invalid_request_error"}}, status=400)

        provided_key = body.get("api_key", "")
        if provided_key != self._api_key:
            return web.json_response(
                {"error": {"message": "Invalid API key", "type": "invalid_request_error", "code": "invalid_api_key"}},
                status=401,
            )

        import jwt as pyjwt
        now = int(time.time())
        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())

        access_token = pyjwt.encode(
            {"sub": "api_client", "iat": now, "exp": now + 3600,
             "jti": access_jti, "type": "access"},
            self._jwt_secret,
            algorithm="HS256",
        )

        refresh_exp = now + 30 * 24 * 3600
        refresh_token = pyjwt.encode(
            {"sub": "api_client", "iat": now, "exp": refresh_exp,
             "jti": refresh_jti, "type": "refresh"},
            self._jwt_secret,
            algorithm="HS256",
        )

        self._response_store.store_refresh_token(refresh_jti, float(refresh_exp))

        return web.json_response({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": 3600,
            "token_type": "Bearer",
        })

    async def _handle_auth_refresh(self, request: "web.Request") -> "web.Response":
        """POST /api/auth/refresh - Exchange a refresh token for new token pair."""
        if not self._api_key:
            return web.json_response(
                {"error": {"message": "No API key configured", "type": "server_error", "code": "no_api_key"}},
                status=501,
            )

        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": {"message": "Invalid JSON", "type": "invalid_request_error"}}, status=400)

        refresh_token_str = body.get("refresh_token", "")
        try:
            import jwt as pyjwt
            payload = pyjwt.decode(refresh_token_str, self._jwt_secret, algorithms=["HS256"])
        except Exception:
            return web.json_response(
                {"error": {"message": "Invalid or expired refresh token", "code": "invalid_token"}},
                status=401,
            )

        if payload.get("type") != "refresh":
            return web.json_response(
                {"error": {"message": "Not a refresh token", "code": "invalid_token"}},
                status=401,
            )

        jti = payload.get("jti", "")
        if not self._response_store.is_refresh_token_valid(jti):
            return web.json_response(
                {"error": {"message": "Refresh token revoked or expired", "code": "token_revoked"}},
                status=401,
            )

        # Rotate: revoke old refresh token, issue new pair
        self._response_store.revoke_token(jti)

        now = int(time.time())
        new_access_jti = str(uuid.uuid4())
        new_refresh_jti = str(uuid.uuid4())

        access_token = pyjwt.encode(
            {"sub": "api_client", "iat": now, "exp": now + 3600,
             "jti": new_access_jti, "type": "access"},
            self._jwt_secret,
            algorithm="HS256",
        )

        refresh_exp = now + 30 * 24 * 3600
        new_refresh_token = pyjwt.encode(
            {"sub": "api_client", "iat": now, "exp": refresh_exp,
             "jti": new_refresh_jti, "type": "refresh"},
            self._jwt_secret,
            algorithm="HS256",
        )

        self._response_store.store_refresh_token(new_refresh_jti, float(refresh_exp))

        return web.json_response({
            "access_token": access_token,
            "refresh_token": new_refresh_token,
            "expires_in": 3600,
            "token_type": "Bearer",
        })

    async def _handle_auth_revoke(self, request: "web.Request") -> "web.Response":
        """POST /api/auth/revoke - Revoke a refresh token (requires auth)."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": {"message": "Invalid JSON", "type": "invalid_request_error"}}, status=400)

        refresh_token_str = body.get("refresh_token", "")
        try:
            import jwt as pyjwt
            payload = pyjwt.decode(refresh_token_str, self._jwt_secret, algorithms=["HS256"])
            jti = payload.get("jti", "")
            self._response_store.revoke_token(jti)
        except Exception:
            pass  # Revoke is idempotent — ignore invalid tokens

        return web.json_response({"revoked": True})

    # ------------------------------------------------------------------
    # Config Management
    # ------------------------------------------------------------------

    _SECRET_KEYS = frozenset({
        "key", "api_key", "token", "password", "secret",
        "webhook_url", "bot_token", "access_token", "refresh_token",
    })

    @staticmethod
    def _redact_secrets(obj: Any) -> Any:
        """Recursively redact secret fields in a config dict."""
        if isinstance(obj, dict):
            return {
                k: "***" if k.lower() in APIServerAdapter._SECRET_KEYS else APIServerAdapter._redact_secrets(v)
                for k, v in obj.items()
            }
        if isinstance(obj, list):
            return [APIServerAdapter._redact_secrets(item) for item in obj]
        return obj

    async def _handle_get_config(self, request: "web.Request") -> "web.Response":
        """GET /api/config — return redacted config."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        from hermes_cli.config import get_hermes_home
        config_path = get_hermes_home() / "config.yaml"
        try:
            import yaml
            with open(config_path, encoding="utf-8") as f:
                config = yaml.safe_load(f) or {}
        except FileNotFoundError:
            config = {}
        except Exception as e:
            return web.json_response(_openai_error(f"Failed to read config: {e}"), status=500)

        return web.json_response({"config": self._redact_secrets(config)})

    @staticmethod
    def _apply_dot_notation(config: dict, updates: dict) -> dict:
        """Apply flat dot-notation keys and nested dict updates to config."""
        import copy
        result = copy.deepcopy(config)
        for key, value in updates.items():
            if isinstance(value, dict) and "." not in key:
                if key not in result or not isinstance(result[key], dict):
                    result[key] = {}
                result[key] = APIServerAdapter._apply_dot_notation(result[key], value)
            elif "." in key:
                parts = key.split(".", 1)
                if parts[0] not in result or not isinstance(result[parts[0]], dict):
                    result[parts[0]] = {}
                result[parts[0]] = APIServerAdapter._apply_dot_notation(
                    result[parts[0]], {parts[1]: value}
                )
            else:
                result[key] = value
        return result

    async def _handle_patch_config(self, request: "web.Request") -> "web.Response":
        """PATCH /api/config — update config with dot-notation support."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        try:
            updates = await request.json()
        except Exception:
            return web.json_response(_openai_error("Invalid JSON"), status=400)

        if not isinstance(updates, dict):
            return web.json_response(_openai_error("Request body must be a JSON object"), status=400)

        from hermes_cli.config import get_hermes_home
        config_path = get_hermes_home() / "config.yaml"
        try:
            import yaml
            with open(config_path, encoding="utf-8") as f:
                current = yaml.safe_load(f) or {}
        except FileNotFoundError:
            current = {}

        merged = self._apply_dot_notation(current, updates)

        try:
            import yaml
            yaml.safe_dump(merged)
        except Exception as e:
            return web.json_response(_openai_error(f"Invalid config values: {e}"), status=400)

        try:
            from utils import atomic_yaml_write
            atomic_yaml_write(config_path, merged)
        except Exception as e:
            return web.json_response(_openai_error(f"Failed to write config: {e}"), status=500)

        return web.json_response({"config": self._redact_secrets(merged)})

    # ------------------------------------------------------------------
    # Memory Management
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_memory_entries(content: str) -> list:
        """Split §-delimited memory file into entries."""
        return [e.strip() for e in content.split("§") if e.strip()]

    async def _handle_get_memory(self, request: "web.Request") -> "web.Response":
        """GET /api/memory — return memory and user entries."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        from hermes_cli.config import get_hermes_home
        hermes_home = get_hermes_home()
        result = {}
        for target, filename, char_limit in [
            ("memory", "MEMORY.md", 2200),
            ("user", "USER.md", 1375),
        ]:
            path = hermes_home / "memories" / filename
            try:
                content = path.read_text(encoding="utf-8") if path.exists() else ""
            except Exception:
                content = ""
            entries = self._parse_memory_entries(content)
            char_count = len(content)
            result[target] = {
                "entries": entries,
                "char_count": char_count,
                "char_limit": char_limit,
                "usage_pct": round(char_count / char_limit * 100, 1),
            }

        return web.json_response(result)

    async def _handle_patch_memory(self, request: "web.Request") -> "web.Response":
        """PATCH /api/memory and DELETE /api/memory/entry — add/replace/remove entries."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        try:
            body = await request.json()
        except Exception:
            return web.json_response(_openai_error("Invalid JSON"), status=400)

        target = body.get("target")  # "memory" or "user"
        action = body.get("action")  # "add", "replace", "remove"
        content = body.get("content", "")
        old_text = body.get("old_text", "")

        if target not in ("memory", "user"):
            return web.json_response(_openai_error("'target' must be 'memory' or 'user'"), status=400)
        if action not in ("add", "replace", "remove"):
            return web.json_response(_openai_error("'action' must be 'add', 'replace', or 'remove'"), status=400)

        filename = "MEMORY.md" if target == "memory" else "USER.md"
        char_limit = 2200 if target == "memory" else 1375
        from hermes_cli.config import get_hermes_home
        path = get_hermes_home() / "memories" / filename
        path.parent.mkdir(parents=True, exist_ok=True)

        current = path.read_text(encoding="utf-8") if path.exists() else ""
        entries = self._parse_memory_entries(current)

        if action == "add":
            if content and self._memory_security_scan(content):
                return web.json_response(_openai_error("Content rejected by security scan", code="security_scan_rejected"), status=422)
            new_content = current.rstrip() + ("\n§\n" if entries else "") + content
            if len(new_content) > char_limit:
                return web.json_response(_openai_error(
                    f"Adding this entry would exceed the {char_limit} char limit",
                    code="memory_limit_exceeded"
                ), status=413)
            path.write_text(new_content, encoding="utf-8")

        elif action in ("replace", "remove"):
            if not old_text:
                return web.json_response(_openai_error("'old_text' required for replace/remove"), status=400)
            matches = [e for e in entries if old_text in e]
            if len(matches) == 0:
                return web.json_response(_openai_error("No entry found matching 'old_text'", code="entry_not_found"), status=400)
            if len(matches) > 1:
                return web.json_response(_openai_error("'old_text' matches multiple entries — be more specific", code="ambiguous_match"), status=400)
            if action == "replace":
                if content and self._memory_security_scan(content):
                    return web.json_response(_openai_error("Content rejected by security scan", code="security_scan_rejected"), status=422)
                entries = [content if old_text in e else e for e in entries]
            else:
                entries = [e for e in entries if old_text not in e]
            path.write_text("\n§\n".join(entries), encoding="utf-8")

        updated = path.read_text(encoding="utf-8") if path.exists() else ""
        updated_entries = self._parse_memory_entries(updated)
        return web.json_response({
            "success": True,
            "target": target,
            "entries": updated_entries,
            "char_count": len(updated),
            "char_limit": char_limit,
        })

    @staticmethod
    def _memory_security_scan(content: str) -> bool:
        """Returns True if content should be rejected. Reuse logic from memory_tool.py."""
        try:
            from tools.memory_tool import _scan_for_threats
            return _scan_for_threats(content)
        except ImportError:
            return False

    # ------------------------------------------------------------------
    # Skills Management
    # ------------------------------------------------------------------

    async def _handle_list_skills(self, request: "web.Request") -> "web.Response":
        """GET /api/skills — list installed skills."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        from hermes_cli.config import get_hermes_home
        skills_dir = get_hermes_home() / "skills"
        category_filter = request.rel_url.query.get("category")
        skills = []

        if skills_dir.exists():
            for skill_path in skills_dir.rglob("SKILL.md"):
                skill = self._parse_skill_metadata(skill_path)
                if category_filter and skill.get("category") != category_filter:
                    continue
                skills.append(skill)

        skills.sort(key=lambda s: s["name"])
        return web.json_response({"skills": skills, "total": len(skills)})

    @staticmethod
    def _parse_skill_metadata(skill_path) -> dict:
        """Parse SKILL.md frontmatter for metadata."""
        import re
        content = skill_path.read_text(encoding="utf-8", errors="replace")
        name = skill_path.parent.name
        category = skill_path.parent.parent.name
        description = ""
        version = None

        fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        if fm_match:
            try:
                import yaml
                fm = yaml.safe_load(fm_match.group(1)) or {}
                description = fm.get("description", "")
                version = fm.get("version")
                name = fm.get("name", name)
            except Exception:
                pass

        return {
            "name": name,
            "category": category,
            "description": description,
            "version": version,
            "path": str(skill_path.parent),
            "has_references": (skill_path.parent / "references").exists(),
            "has_scripts": (skill_path.parent / "scripts").exists(),
            "has_templates": (skill_path.parent / "templates").exists(),
        }

    async def _handle_get_skill(self, request: "web.Request") -> "web.Response":
        """GET /api/skills/{name} — get a specific skill."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        name = request.match_info["name"]
        from hermes_cli.config import get_hermes_home
        skills_dir = get_hermes_home() / "skills"

        for candidate in skills_dir.rglob("SKILL.md"):
            if candidate.parent.name == name:
                skill = self._parse_skill_metadata(candidate)
                return web.json_response(skill)

        return web.json_response(_openai_error("Skill not found", err_type="not_found_error"), status=404)

    async def _handle_install_skill(self, request: "web.Request") -> "web.Response":
        """POST /api/skills/install — install a skill from the hub."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        try:
            body = await request.json()
        except Exception:
            return web.json_response(_openai_error("Invalid JSON"), status=400)

        skill_id = body.get("skill", "").strip()
        force = body.get("force", False)

        if not skill_id:
            return web.json_response(_openai_error("Missing 'skill' field"), status=400)

        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(None, lambda: self._install_skill_sync(skill_id, force))
            return web.json_response(result)
        except Exception as e:
            return web.json_response(_openai_error(str(e), err_type="install_error"), status=422)

    @staticmethod
    def _install_skill_sync(skill_id: str, force: bool) -> dict:
        """Synchronous wrapper for skill installation."""
        from hermes_cli.skills_hub import install_skill
        return install_skill(skill_id, force=force)

    async def _handle_delete_skill(self, request: "web.Request") -> "web.Response":
        """DELETE /api/skills/{name} — remove an installed skill."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        name = request.match_info["name"]
        from hermes_cli.config import get_hermes_home
        skills_dir = get_hermes_home() / "skills"

        skill_path = None
        for candidate in skills_dir.rglob("SKILL.md"):
            if candidate.parent.name == name:
                skill_path = candidate.parent
                break

        if skill_path is None:
            return web.json_response(_openai_error("Skill not found", err_type="not_found_error"), status=404)

        import shutil
        shutil.rmtree(skill_path)
        return web.Response(status=204)

    async def _handle_check_skills(self, request: "web.Request") -> "web.Response":
        """POST /api/skills/check — check for skill updates."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._check_skills_sync)
        return web.json_response(result)

    @staticmethod
    def _check_skills_sync() -> dict:
        """Synchronous wrapper for checking skill updates."""
        try:
            from hermes_cli.skills_hub import check_skill_updates
            return check_skill_updates()
        except Exception as e:
            return {"error": str(e), "updates_available": [], "up_to_date": []}

    async def _handle_update_skills(self, request: "web.Request") -> "web.Response":
        """POST /api/skills/update — update skills."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        body = {}
        try:
            body = await request.json()
        except Exception:
            pass

        skills_filter = body.get("skills")  # None = update all
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: self._update_skills_sync(skills_filter))
        return web.json_response(result)

    @staticmethod
    def _update_skills_sync(skills_filter: Optional[List[str]] = None) -> dict:
        """Synchronous wrapper for updating skills."""
        try:
            from hermes_cli.skills_hub import update_skills
            return update_skills(skills=skills_filter)
        except Exception as e:
            return {"error": str(e), "updated": [], "failed": []}

    async def _handle_health(self, request: "web.Request") -> "web.Response":
        """GET /health — simple health check."""
        return web.json_response({"status": "ok", "platform": "hermes-agent"})

    async def _handle_models(self, request: "web.Request") -> "web.Response":
        """GET /v1/models — return hermes-agent as an available model."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        return web.json_response({
            "object": "list",
            "data": [
                {
                    "id": "hermes-agent",
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "hermes",
                    "permission": [],
                    "root": "hermes-agent",
                    "parent": None,
                }
            ],
        })

    async def _handle_chat_completions(self, request: "web.Request") -> "web.Response":
        """POST /v1/chat/completions — OpenAI Chat Completions format."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        # Parse request body
        try:
            body = await request.json()
        except (json.JSONDecodeError, Exception):
            return web.json_response(_openai_error("Invalid JSON in request body"), status=400)

        messages = body.get("messages")
        if not messages or not isinstance(messages, list):
            return web.json_response(
                {"error": {"message": "Missing or invalid 'messages' field", "type": "invalid_request_error"}},
                status=400,
            )

        stream = body.get("stream", False)

        # Extract system message (becomes ephemeral system prompt layered ON TOP of core)
        system_prompt = None
        conversation_messages: List[Dict[str, str]] = []

        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "system":
                # Accumulate system messages
                if system_prompt is None:
                    system_prompt = content
                else:
                    system_prompt = system_prompt + "\n" + content
            elif role in ("user", "assistant"):
                conversation_messages.append({"role": role, "content": content})

        # Extract the last user message as the primary input
        user_message = ""
        history = []
        if conversation_messages:
            user_message = conversation_messages[-1].get("content", "")
            history = conversation_messages[:-1]

        if not user_message:
            return web.json_response(
                {"error": {"message": "No user message found in messages", "type": "invalid_request_error"}},
                status=400,
            )

        # Allow caller to continue an existing session by passing X-Hermes-Session-Id.
        # When provided, history is loaded from state.db instead of from the request body.
        provided_session_id = request.headers.get("X-Hermes-Session-Id", "").strip()
        if provided_session_id:
            session_id = provided_session_id
            try:
                db = self._ensure_session_db()
                if db is not None:
                    history = db.get_messages_as_conversation(session_id)
            except Exception as e:
                logger.warning("Failed to load session history for %s: %s", session_id, e)
                history = []
        else:
            session_id = str(uuid.uuid4())
            # history already set from request body above

        completion_id = f"chatcmpl-{uuid.uuid4().hex[:29]}"
        model_name = body.get("model", "hermes-agent")
        created = int(time.time())

        if stream:
            import queue as _q
            _stream_q: _q.Queue = _q.Queue()

            def _on_delta(delta):
                # Filter out None — the agent fires stream_delta_callback(None)
                # to signal the CLI display to close its response box before
                # tool execution, but the SSE writer uses None as end-of-stream
                # sentinel.  Forwarding it would prematurely close the HTTP
                # response, causing Open WebUI (and similar frontends) to miss
                # the final answer after tool calls.  The SSE loop detects
                # completion via agent_task.done() instead.
                if delta is not None:
                    _stream_q.put(delta)

            def _on_tool_progress(name, preview, args):
                """Inject tool progress into the SSE stream for Open WebUI."""
                if name.startswith("_"):
                    return  # Skip internal events (_thinking)
                from agent.display import get_tool_emoji
                emoji = get_tool_emoji(name)
                label = preview or name
                _stream_q.put(f"\n`{emoji} {label}`\n")

            # Start agent in background.  agent_ref is a mutable container
            # so the SSE writer can interrupt the agent on client disconnect.
            agent_ref = [None]
            agent_task = asyncio.ensure_future(self._run_agent(
                user_message=user_message,
                conversation_history=history,
                ephemeral_system_prompt=system_prompt,
                session_id=session_id,
                stream_delta_callback=_on_delta,
                tool_progress_callback=_on_tool_progress,
                agent_ref=agent_ref,
            ))

            return await self._write_sse_chat_completion(
                request, completion_id, model_name, created, _stream_q,
                agent_task, agent_ref, session_id=session_id,
            )

        # Non-streaming: run the agent (with optional Idempotency-Key)
        async def _compute_completion():
            return await self._run_agent(
                user_message=user_message,
                conversation_history=history,
                ephemeral_system_prompt=system_prompt,
                session_id=session_id,
            )

        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key:
            fp = _make_request_fingerprint(body, keys=["model", "messages", "tools", "tool_choice", "stream"])
            try:
                result, usage = await _idem_cache.get_or_set(idempotency_key, fp, _compute_completion)
            except Exception as e:
                logger.error("Error running agent for chat completions: %s", e, exc_info=True)
                return web.json_response(
                    _openai_error(f"Internal server error: {e}", err_type="server_error"),
                    status=500,
                )
        else:
            try:
                result, usage = await _compute_completion()
            except Exception as e:
                logger.error("Error running agent for chat completions: %s", e, exc_info=True)
                return web.json_response(
                    _openai_error(f"Internal server error: {e}", err_type="server_error"),
                    status=500,
                )

        final_response = result.get("final_response", "")
        if not final_response:
            final_response = result.get("error", "(No response generated)")

        response_data = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": model_name,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": final_response,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            },
        }

        return web.json_response(response_data, headers={"X-Hermes-Session-Id": session_id})

    async def _write_sse_chat_completion(
        self, request: "web.Request", completion_id: str, model: str,
        created: int, stream_q, agent_task, agent_ref=None, session_id: str = None,
    ) -> "web.StreamResponse":
        """Write real streaming SSE from agent's stream_delta_callback queue.

        If the client disconnects mid-stream (network drop, browser tab close),
        the agent is interrupted via ``agent.interrupt()`` so it stops making
        LLM API calls, and the asyncio task wrapper is cancelled.
        """
        import queue as _q

        sse_headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache"}
        # CORS middleware can't inject headers into StreamResponse after
        # prepare() flushes them, so resolve CORS headers up front.
        origin = request.headers.get("Origin", "")
        cors = self._cors_headers_for_origin(origin) if origin else None
        if cors:
            sse_headers.update(cors)
        if session_id:
            sse_headers["X-Hermes-Session-Id"] = session_id
        response = web.StreamResponse(status=200, headers=sse_headers)
        await response.prepare(request)

        try:
            # Role chunk
            role_chunk = {
                "id": completion_id, "object": "chat.completion.chunk",
                "created": created, "model": model,
                "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
            }
            await response.write(f"data: {json.dumps(role_chunk)}\n\n".encode())

            # Stream content chunks as they arrive from the agent
            loop = asyncio.get_event_loop()
            while True:
                try:
                    delta = await loop.run_in_executor(None, lambda: stream_q.get(timeout=0.5))
                except _q.Empty:
                    if agent_task.done():
                        # Drain any remaining items
                        while True:
                            try:
                                delta = stream_q.get_nowait()
                                if delta is None:
                                    break
                                content_chunk = {
                                    "id": completion_id, "object": "chat.completion.chunk",
                                    "created": created, "model": model,
                                    "choices": [{"index": 0, "delta": {"content": delta}, "finish_reason": None}],
                                }
                                await response.write(f"data: {json.dumps(content_chunk)}\n\n".encode())
                            except _q.Empty:
                                break
                        break
                    continue

                if delta is None:  # End of stream sentinel
                    break

                content_chunk = {
                    "id": completion_id, "object": "chat.completion.chunk",
                    "created": created, "model": model,
                    "choices": [{"index": 0, "delta": {"content": delta}, "finish_reason": None}],
                }
                await response.write(f"data: {json.dumps(content_chunk)}\n\n".encode())

            # Get usage from completed agent
            usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
            try:
                result, agent_usage = await agent_task
                usage = agent_usage or usage
            except Exception:
                pass

            # Finish chunk
            finish_chunk = {
                "id": completion_id, "object": "chat.completion.chunk",
                "created": created, "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": {
                    "prompt_tokens": usage.get("input_tokens", 0),
                    "completion_tokens": usage.get("output_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                },
            }
            await response.write(f"data: {json.dumps(finish_chunk)}\n\n".encode())
            await response.write(b"data: [DONE]\n\n")
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            # Client disconnected mid-stream.  Interrupt the agent so it
            # stops making LLM API calls at the next loop iteration, then
            # cancel the asyncio task wrapper.
            agent = agent_ref[0] if agent_ref else None
            if agent is not None:
                try:
                    agent.interrupt("SSE client disconnected")
                except Exception:
                    pass
            if not agent_task.done():
                agent_task.cancel()
                try:
                    await agent_task
                except (asyncio.CancelledError, Exception):
                    pass
            logger.info("SSE client disconnected; interrupted agent task %s", completion_id)

        return response

    async def _handle_responses(self, request: "web.Request") -> "web.Response":
        """POST /v1/responses — OpenAI Responses API format."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        # Parse request body
        try:
            body = await request.json()
        except (json.JSONDecodeError, Exception):
            return web.json_response(
                {"error": {"message": "Invalid JSON in request body", "type": "invalid_request_error"}},
                status=400,
            )

        raw_input = body.get("input")
        if raw_input is None:
            return web.json_response(_openai_error("Missing 'input' field"), status=400)

        instructions = body.get("instructions")
        previous_response_id = body.get("previous_response_id")
        conversation = body.get("conversation")
        store = body.get("store", True)

        # conversation and previous_response_id are mutually exclusive
        if conversation and previous_response_id:
            return web.json_response(_openai_error("Cannot use both 'conversation' and 'previous_response_id'"), status=400)

        # Resolve conversation name to latest response_id
        if conversation:
            previous_response_id = self._response_store.get_conversation(conversation)
            # No error if conversation doesn't exist yet — it's a new conversation

        # Normalize input to message list
        input_messages: List[Dict[str, str]] = []
        if isinstance(raw_input, str):
            input_messages = [{"role": "user", "content": raw_input}]
        elif isinstance(raw_input, list):
            for item in raw_input:
                if isinstance(item, str):
                    input_messages.append({"role": "user", "content": item})
                elif isinstance(item, dict):
                    role = item.get("role", "user")
                    content = item.get("content", "")
                    # Handle content that may be a list of content parts
                    if isinstance(content, list):
                        text_parts = []
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "input_text":
                                text_parts.append(part.get("text", ""))
                            elif isinstance(part, dict) and part.get("type") == "output_text":
                                text_parts.append(part.get("text", ""))
                            elif isinstance(part, str):
                                text_parts.append(part)
                        content = "\n".join(text_parts)
                    input_messages.append({"role": role, "content": content})
        else:
            return web.json_response(_openai_error("'input' must be a string or array"), status=400)

        # Reconstruct conversation history from previous_response_id
        conversation_history: List[Dict[str, str]] = []
        if previous_response_id:
            stored = self._response_store.get(previous_response_id)
            if stored is None:
                return web.json_response(_openai_error(f"Previous response not found: {previous_response_id}"), status=404)
            conversation_history = list(stored.get("conversation_history", []))
            # If no instructions provided, carry forward from previous
            if instructions is None:
                instructions = stored.get("instructions")

        # Append new input messages to history (all but the last become history)
        for msg in input_messages[:-1]:
            conversation_history.append(msg)

        # Last input message is the user_message
        user_message = input_messages[-1].get("content", "") if input_messages else ""
        if not user_message:
            return web.json_response(_openai_error("No user message found in input"), status=400)

        # Truncation support
        if body.get("truncation") == "auto" and len(conversation_history) > 100:
            conversation_history = conversation_history[-100:]

        # Run the agent (with Idempotency-Key support)
        session_id = str(uuid.uuid4())

        async def _compute_response():
            return await self._run_agent(
                user_message=user_message,
                conversation_history=conversation_history,
                ephemeral_system_prompt=instructions,
                session_id=session_id,
            )

        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key:
            fp = _make_request_fingerprint(
                body,
                keys=["input", "instructions", "previous_response_id", "conversation", "model", "tools"],
            )
            try:
                result, usage = await _idem_cache.get_or_set(idempotency_key, fp, _compute_response)
            except Exception as e:
                logger.error("Error running agent for responses: %s", e, exc_info=True)
                return web.json_response(
                    _openai_error(f"Internal server error: {e}", err_type="server_error"),
                    status=500,
                )
        else:
            try:
                result, usage = await _compute_response()
            except Exception as e:
                logger.error("Error running agent for responses: %s", e, exc_info=True)
                return web.json_response(
                    _openai_error(f"Internal server error: {e}", err_type="server_error"),
                    status=500,
                )

        final_response = result.get("final_response", "")
        if not final_response:
            final_response = result.get("error", "(No response generated)")

        response_id = f"resp_{uuid.uuid4().hex[:28]}"
        created_at = int(time.time())

        # Build the full conversation history for storage
        # (includes tool calls from the agent run)
        full_history = list(conversation_history)
        full_history.append({"role": "user", "content": user_message})
        # Add agent's internal messages if available
        agent_messages = result.get("messages", [])
        if agent_messages:
            full_history.extend(agent_messages)
        else:
            full_history.append({"role": "assistant", "content": final_response})

        # Build output items (includes tool calls + final message)
        output_items = self._extract_output_items(result)

        response_data = {
            "id": response_id,
            "object": "response",
            "status": "completed",
            "created_at": created_at,
            "model": body.get("model", "hermes-agent"),
            "output": output_items,
            "usage": {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            },
        }

        # Store the complete response object for future chaining / GET retrieval
        if store:
            self._response_store.put(response_id, {
                "response": response_data,
                "conversation_history": full_history,
                "instructions": instructions,
            })
            # Update conversation mapping so the next request with the same
            # conversation name automatically chains to this response
            if conversation:
                self._response_store.set_conversation(conversation, response_id)

        return web.json_response(response_data)

    # ------------------------------------------------------------------
    # GET / DELETE response endpoints
    # ------------------------------------------------------------------

    async def _handle_get_response(self, request: "web.Request") -> "web.Response":
        """GET /v1/responses/{response_id} — retrieve a stored response."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        response_id = request.match_info["response_id"]
        stored = self._response_store.get(response_id)
        if stored is None:
            return web.json_response(_openai_error(f"Response not found: {response_id}"), status=404)

        return web.json_response(stored["response"])

    async def _handle_delete_response(self, request: "web.Request") -> "web.Response":
        """DELETE /v1/responses/{response_id} — delete a stored response."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err

        response_id = request.match_info["response_id"]
        deleted = self._response_store.delete(response_id)
        if not deleted:
            return web.json_response(_openai_error(f"Response not found: {response_id}"), status=404)

        return web.json_response({
            "id": response_id,
            "object": "response",
            "deleted": True,
        })

    # ------------------------------------------------------------------
    # Cron jobs API
    # ------------------------------------------------------------------

    # Check cron module availability once (not per-request)
    _CRON_AVAILABLE = False
    try:
        from cron.jobs import (
            list_jobs as _cron_list,
            get_job as _cron_get,
            create_job as _cron_create,
            update_job as _cron_update,
            remove_job as _cron_remove,
            pause_job as _cron_pause,
            resume_job as _cron_resume,
            trigger_job as _cron_trigger,
        )
        _CRON_AVAILABLE = True
    except ImportError:
        pass

    _JOB_ID_RE = __import__("re").compile(r"[a-f0-9]{12}")
    # Allowed fields for update — prevents clients injecting arbitrary keys
    _UPDATE_ALLOWED_FIELDS = {"name", "schedule", "prompt", "deliver", "skills", "skill", "repeat", "enabled"}
    _MAX_NAME_LENGTH = 200
    _MAX_PROMPT_LENGTH = 5000

    def _check_jobs_available(self) -> Optional["web.Response"]:
        """Return error response if cron module isn't available."""
        if not self._CRON_AVAILABLE:
            return web.json_response(
                {"error": "Cron module not available"}, status=501,
            )
        return None

    def _check_job_id(self, request: "web.Request") -> tuple:
        """Validate and extract job_id. Returns (job_id, error_response)."""
        job_id = request.match_info["job_id"]
        if not self._JOB_ID_RE.fullmatch(job_id):
            return job_id, web.json_response(
                {"error": "Invalid job ID format"}, status=400,
            )
        return job_id, None

    async def _handle_list_jobs(self, request: "web.Request") -> "web.Response":
        """GET /api/jobs — list all cron jobs."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        try:
            include_disabled = request.query.get("include_disabled", "").lower() in ("true", "1")
            jobs = self._cron_list(include_disabled=include_disabled)
            return web.json_response({"jobs": jobs})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_create_job(self, request: "web.Request") -> "web.Response":
        """POST /api/jobs — create a new cron job."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        try:
            body = await request.json()
            name = (body.get("name") or "").strip()
            schedule = (body.get("schedule") or "").strip()
            prompt = body.get("prompt", "")
            deliver = body.get("deliver", "local")
            skills = body.get("skills")
            repeat = body.get("repeat")

            if not name:
                return web.json_response({"error": "Name is required"}, status=400)
            if len(name) > self._MAX_NAME_LENGTH:
                return web.json_response(
                    {"error": f"Name must be ≤ {self._MAX_NAME_LENGTH} characters"}, status=400,
                )
            if not schedule:
                return web.json_response({"error": "Schedule is required"}, status=400)
            if len(prompt) > self._MAX_PROMPT_LENGTH:
                return web.json_response(
                    {"error": f"Prompt must be ≤ {self._MAX_PROMPT_LENGTH} characters"}, status=400,
                )
            if repeat is not None and (not isinstance(repeat, int) or repeat < 1):
                return web.json_response({"error": "Repeat must be a positive integer"}, status=400)

            kwargs = {
                "prompt": prompt,
                "schedule": schedule,
                "name": name,
                "deliver": deliver,
            }
            if skills:
                kwargs["skills"] = skills
            if repeat is not None:
                kwargs["repeat"] = repeat

            job = self._cron_create(**kwargs)
            return web.json_response({"job": job})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_get_job(self, request: "web.Request") -> "web.Response":
        """GET /api/jobs/{job_id} — get a single cron job."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        job_id, id_err = self._check_job_id(request)
        if id_err:
            return id_err
        try:
            job = self._cron_get(job_id)
            if not job:
                return web.json_response({"error": "Job not found"}, status=404)
            return web.json_response({"job": job})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_update_job(self, request: "web.Request") -> "web.Response":
        """PATCH /api/jobs/{job_id} — update a cron job."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        job_id, id_err = self._check_job_id(request)
        if id_err:
            return id_err
        try:
            body = await request.json()
            # Whitelist allowed fields to prevent arbitrary key injection
            sanitized = {k: v for k, v in body.items() if k in self._UPDATE_ALLOWED_FIELDS}
            if not sanitized:
                return web.json_response({"error": "No valid fields to update"}, status=400)
            # Validate lengths if present
            if "name" in sanitized and len(sanitized["name"]) > self._MAX_NAME_LENGTH:
                return web.json_response(
                    {"error": f"Name must be ≤ {self._MAX_NAME_LENGTH} characters"}, status=400,
                )
            if "prompt" in sanitized and len(sanitized["prompt"]) > self._MAX_PROMPT_LENGTH:
                return web.json_response(
                    {"error": f"Prompt must be ≤ {self._MAX_PROMPT_LENGTH} characters"}, status=400,
                )
            job = self._cron_update(job_id, sanitized)
            if not job:
                return web.json_response({"error": "Job not found"}, status=404)
            return web.json_response({"job": job})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_delete_job(self, request: "web.Request") -> "web.Response":
        """DELETE /api/jobs/{job_id} — delete a cron job."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        job_id, id_err = self._check_job_id(request)
        if id_err:
            return id_err
        try:
            success = self._cron_remove(job_id)
            if not success:
                return web.json_response({"error": "Job not found"}, status=404)
            return web.json_response({"ok": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_pause_job(self, request: "web.Request") -> "web.Response":
        """POST /api/jobs/{job_id}/pause — pause a cron job."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        job_id, id_err = self._check_job_id(request)
        if id_err:
            return id_err
        try:
            job = self._cron_pause(job_id)
            if not job:
                return web.json_response({"error": "Job not found"}, status=404)
            return web.json_response({"job": job})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_resume_job(self, request: "web.Request") -> "web.Response":
        """POST /api/jobs/{job_id}/resume — resume a paused cron job."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        job_id, id_err = self._check_job_id(request)
        if id_err:
            return id_err
        try:
            job = self._cron_resume(job_id)
            if not job:
                return web.json_response({"error": "Job not found"}, status=404)
            return web.json_response({"job": job})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def _handle_run_job(self, request: "web.Request") -> "web.Response":
        """POST /api/jobs/{job_id}/run — trigger immediate execution."""
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        cron_err = self._check_jobs_available()
        if cron_err:
            return cron_err
        job_id, id_err = self._check_job_id(request)
        if id_err:
            return id_err
        try:
            job = self._cron_trigger(job_id)
            if not job:
                return web.json_response({"error": "Job not found"}, status=404)
            return web.json_response({"job": job})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # ------------------------------------------------------------------
    # Output extraction helper
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_output_items(result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Build the full output item array from the agent's messages.

        Walks *result["messages"]* and emits:
        - ``function_call`` items for each tool_call on assistant messages
        - ``function_call_output`` items for each tool-role message
        - a final ``message`` item with the assistant's text reply
        """
        items: List[Dict[str, Any]] = []
        messages = result.get("messages", [])

        for msg in messages:
            role = msg.get("role")
            if role == "assistant" and msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    func = tc.get("function", {})
                    items.append({
                        "type": "function_call",
                        "name": func.get("name", ""),
                        "arguments": func.get("arguments", ""),
                        "call_id": tc.get("id", ""),
                    })
            elif role == "tool":
                items.append({
                    "type": "function_call_output",
                    "call_id": msg.get("tool_call_id", ""),
                    "output": msg.get("content", ""),
                })

        # Final assistant message
        final = result.get("final_response", "")
        if not final:
            final = result.get("error", "(No response generated)")

        items.append({
            "type": "message",
            "role": "assistant",
            "content": [
                {
                    "type": "output_text",
                    "text": final,
                }
            ],
        })
        return items


    async def _handle_ws_agent(self, request):
        """GET /ws/agent -- WebSocket endpoint for real-time agent communication."""
        token = request.query.get("token", "")
        if self._api_key and token != self._api_key:
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_json({"type": "error", "message": "Invalid API key"})
            await ws.close()
            return ws

        ws = web.WebSocketResponse()
        await ws.prepare(request)

        connection_id = str(uuid.uuid4())[:8]
        logger.info("[%s] WebSocket agent connection established: %s", self.name, connection_id)

        try:
            msg = await ws.receive()
            if msg.type != web.WSMsgType.TEXT:
                await ws.close()
                return ws

            try:
                payload = json.loads(msg.data)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                await ws.close()
                return ws

            if payload.get("type") != "message" or not payload.get("content"):
                await ws.send_json({"type": "error", "message": "Expected {type: message, content: ...}"})
                await ws.close()
                return ws

            user_message = payload["content"]
            session_id = payload.get("session_id") or str(uuid.uuid4())
            tool_events = payload.get("tool_events", False)
            history = []

            if payload.get("session_id"):
                try:
                    db = self._ensure_session_db()
                    if db is not None:
                        history = db.get_messages_as_conversation(session_id)
                except Exception as e:
                    logger.warning("Failed to load session %s: %s", session_id, e)

            output_queue = asyncio.Queue()
            agent_ref = [None]

            agent_task = asyncio.ensure_future(
                self._ws_run_agent(
                    user_message=user_message,
                    conversation_history=history,
                    session_id=session_id,
                    output_queue=output_queue,
                    agent_ref=agent_ref,
                    tool_events=tool_events,
                )
            )

            try:
                while True:
                    client_fut = asyncio.ensure_future(ws.receive())
                    queue_fut = asyncio.ensure_future(output_queue.get())
                    done, pending = await asyncio.wait(
                        [client_fut, queue_fut], return_when=asyncio.FIRST_COMPLETED,
                    )
                    for f in pending:
                        f.cancel()
                    if client_fut in done:
                        m = client_fut.result()
                        if m.type == web.WSMsgType.TEXT:
                            try:
                                d = json.loads(m.data)
                                if d.get("type") == "interrupt" and agent_ref[0]:
                                    agent_ref[0].interrupt("Client requested interrupt")
                            except Exception:
                                pass
                        elif m.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR, web.WSMsgType.CLOSING):
                            if agent_ref[0]:
                                agent_ref[0].interrupt("WebSocket client disconnected")
                            break
                    elif queue_fut in done:
                        item = queue_fut.result()
                        if item is None:
                            break
                        await ws.send_json(item)
            except asyncio.CancelledError:
                pass

            if not agent_task.done():
                try:
                    await agent_task
                except Exception:
                    pass
        except Exception as e:
            logger.error("[%s] WebSocket agent handler error: %s", self.name, e, exc_info=True)
            try:
                await ws.send_json({"type": "error", "message": str(e)})
            except Exception:
                pass
        finally:
            try:
                if not ws.closed:
                    await ws.close()
            except Exception:
                pass
        return ws

    async def _ws_run_agent(
        self, user_message, conversation_history, session_id,
        output_queue, agent_ref, tool_events=False,
    ):
        """Run AIAgent with streaming callbacks via async queue."""
        try:
            def _on_delta(delta):
                if delta is not None:
                    try:
                        output_queue.put_nowait({"type": "delta", "content": delta})
                    except asyncio.QueueFull:
                        pass

            def _on_tool_progress(name, preview, args_obj):
                if not tool_events or name.startswith("_"):
                    return
                from agent.display import get_tool_emoji
                emoji = get_tool_emoji(name)
                try:
                    output_queue.put_nowait({"type": "tool_progress", "name": name, "preview": preview or "", "emoji": emoji})
                except asyncio.QueueFull:
                    pass

            def _blocking_run():
                agent = self._create_agent(session_id=session_id, stream_delta_callback=_on_delta, tool_progress_callback=_on_tool_progress)
                agent_ref[0] = agent
                result = agent.run_conversation(user_message=user_message, conversation_history=conversation_history)
                return {"input_tokens": getattr(agent, "session_prompt_tokens", 0) or 0, "output_tokens": getattr(agent, "session_completion_tokens", 0) or 0, "total_tokens": getattr(agent, "session_total_tokens", 0) or 0}

            loop = asyncio.get_event_loop()
            usage = await loop.run_in_executor(None, _blocking_run)
            output_queue.put_nowait({"type": "done", "session_id": session_id, "usage": usage})
            output_queue.put_nowait(None)
        except Exception as e:
            logger.error("[%s] WebSocket agent run error: %s", self.name, e, exc_info=True)
            try:
                output_queue.put_nowait({"type": "error", "message": str(e)})
                output_queue.put_nowait(None)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Agent execution
    # ------------------------------------------------------------------

    async def _run_agent(
        self,
        user_message: str,
        conversation_history: List[Dict[str, str]],
        ephemeral_system_prompt: Optional[str] = None,
        session_id: Optional[str] = None,
        stream_delta_callback=None,
        tool_progress_callback=None,
        agent_ref: Optional[list] = None,
    ) -> tuple:
        """
        Create an agent and run a conversation in a thread executor.

        Returns ``(result_dict, usage_dict)`` where *usage_dict* contains
        ``input_tokens``, ``output_tokens`` and ``total_tokens``.

        If *agent_ref* is a one-element list, the AIAgent instance is stored
        at ``agent_ref[0]`` before ``run_conversation`` begins.  This allows
        callers (e.g. the SSE writer) to call ``agent.interrupt()`` from
        another thread to stop in-progress LLM calls.
        """
        loop = asyncio.get_event_loop()

        def _run():
            agent = self._create_agent(
                ephemeral_system_prompt=ephemeral_system_prompt,
                session_id=session_id,
                stream_delta_callback=stream_delta_callback,
                tool_progress_callback=tool_progress_callback,
            )
            if agent_ref is not None:
                agent_ref[0] = agent
            result = agent.run_conversation(
                user_message=user_message,
                conversation_history=conversation_history,
            )
            usage = {
                "input_tokens": getattr(agent, "session_prompt_tokens", 0) or 0,
                "output_tokens": getattr(agent, "session_completion_tokens", 0) or 0,
                "total_tokens": getattr(agent, "session_total_tokens", 0) or 0,
            }
            return result, usage

        return await loop.run_in_executor(None, _run)


    # ------------------------------------------------------------------
    # Session Management Endpoints
    # ------------------------------------------------------------------

    async def _handle_list_sessions(self, request: "web.Request") -> "web.Response":
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        limit = min(int(request.rel_url.query.get("limit", 20)), 100)
        offset = int(request.rel_url.query.get("offset", 0))
        source = request.rel_url.query.get("source")
        db = self._ensure_session_db()
        if db is None:
            return web.json_response({"sessions": [], "total": 0, "limit": limit, "offset": offset})
        sessions, total = db.list_sessions(limit=limit, offset=offset, source=source)
        return web.json_response({"sessions": sessions, "total": total, "limit": limit, "offset": offset})

    async def _handle_search_sessions(self, request: "web.Request") -> "web.Response":
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        q = request.rel_url.query.get("q", "").strip()
        if not q:
            return web.json_response(_openai_error("Missing query parameter 'q'"), status=400)
        limit = min(int(request.rel_url.query.get("limit", 10)), 50)
        source = request.rel_url.query.get("source")
        db = self._ensure_session_db()
        if db is None:
            return web.json_response({"results": [], "total": 0})
        source_filter = [source] if source else None
        results = db.search_messages(q, source_filter=source_filter, limit=limit)
        return web.json_response({"results": results, "total": len(results)})

    async def _handle_get_session(self, request: "web.Request") -> "web.Response":
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        session_id = request.match_info["session_id"]
        db = self._ensure_session_db()
        if db is None:
            return web.json_response(_openai_error("Database unavailable", code="db_unavailable"), status=503)
        session = db.get_session(session_id)
        if session is None:
            return web.json_response(_openai_error("Session not found", err_type="not_found_error", code="session_not_found"), status=404)
        messages = db.get_messages_as_conversation(session_id)
        return web.json_response({"session": session, "messages": messages})

    async def _handle_delete_session(self, request: "web.Request") -> "web.Response":
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        session_id = request.match_info["session_id"]
        db = self._ensure_session_db()
        if db is None:
            return web.json_response(_openai_error("Database unavailable"), status=503)
        if db.get_session(session_id) is None:
            return web.json_response(_openai_error("Session not found", err_type="not_found_error", code="session_not_found"), status=404)
        db.delete_session(session_id)
        return web.Response(status=204)

    async def _handle_export_session(self, request: "web.Request") -> "web.Response":
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        session_id = request.match_info["session_id"]
        db = self._ensure_session_db()
        if db is None:
            return web.json_response(_openai_error("Database unavailable"), status=503)
        if db.get_session(session_id) is None:
            return web.json_response(_openai_error("Session not found", err_type="not_found_error", code="session_not_found"), status=404)
        messages = db.get_messages(session_id)
        cols = [d[0] for d in db._conn.description]
        lines = [json.dumps(dict(zip(cols, row)), default=str) for row in messages]
        body = "\n".join(lines)
        return web.Response(
            body=body,
            content_type="application/x-ndjson",
            headers={"Content-Disposition": f'attachment; filename="session-{session_id}.jsonl"'},
        )

    async def _handle_rename_session(self, request: "web.Request") -> "web.Response":
        auth_err = self._check_auth(request)
        if auth_err:
            return auth_err
        session_id = request.match_info["session_id"]
        try:
            body = await request.json()
        except Exception:
            return web.json_response(_openai_error("Invalid JSON"), status=400)
        title = body.get("title", "").strip()
        if not title:
            return web.json_response(_openai_error("Missing 'title' field"), status=400)
        db = self._ensure_session_db()
        if db is None:
            return web.json_response(_openai_error("Database unavailable"), status=503)
        if db.get_session(session_id) is None:
            return web.json_response(_openai_error("Session not found", err_type="not_found_error", code="session_not_found"), status=404)
        try:
            db.set_session_title(session_id, title)
        except Exception as e:
            if "UNIQUE" in str(e):
                return web.json_response(_openai_error("Title already in use", code="title_conflict"), status=409)
            raise
        session = db.get_session(session_id)
        return web.json_response({"session": session})

    # ------------------------------------------------------------------
    # BasePlatformAdapter interface
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        """Start the aiohttp web server."""
        if not AIOHTTP_AVAILABLE:
            logger.warning("[%s] aiohttp not installed", self.name)
            return False

        try:
            mws = [mw for mw in (cors_middleware, body_limit_middleware, security_headers_middleware) if mw is not None]
            self._app = web.Application(middlewares=mws)
            self._app["api_server_adapter"] = self
            self._app.router.add_get("/health", self._handle_health)
            self._app.router.add_get("/v1/health", self._handle_health)
            self._app.router.add_get("/v1/models", self._handle_models)
            self._app.router.add_post("/v1/chat/completions", self._handle_chat_completions)
            self._app.router.add_post("/v1/responses", self._handle_responses)
            self._app.router.add_get("/v1/responses/{response_id}", self._handle_get_response)
            self._app.router.add_delete("/v1/responses/{response_id}", self._handle_delete_response)
            # Session management API
            self._app.router.add_get("/api/sessions/search", self._handle_search_sessions)
            self._app.router.add_get("/api/sessions", self._handle_list_sessions)
            self._app.router.add_get("/api/sessions/{session_id}", self._handle_get_session)
            self._app.router.add_delete("/api/sessions/{session_id}", self._handle_delete_session)
            self._app.router.add_get("/api/sessions/{session_id}/export", self._handle_export_session)
            self._app.router.add_patch("/api/sessions/{session_id}", self._handle_rename_session)
            # Cron jobs management API
            self._app.router.add_get("/api/jobs", self._handle_list_jobs)
            self._app.router.add_post("/api/jobs", self._handle_create_job)
            self._app.router.add_get("/api/jobs/{job_id}", self._handle_get_job)
            self._app.router.add_patch("/api/jobs/{job_id}", self._handle_update_job)
            self._app.router.add_delete("/api/jobs/{job_id}", self._handle_delete_job)
            self._app.router.add_post("/api/jobs/{job_id}/pause", self._handle_pause_job)
            self._app.router.add_post("/api/jobs/{job_id}/resume", self._handle_resume_job)
            self._app.router.add_post("/api/jobs/{job_id}/run", self._handle_run_job)
            # WebSocket agent communication
            self._app.router.add_get("/ws/agent", self._handle_ws_agent)


            # JWT Auth endpoints
            self._app.router.add_post("/api/auth/token", self._handle_auth_token)
            self._app.router.add_post("/api/auth/refresh", self._handle_auth_refresh)
            self._app.router.add_post("/api/auth/revoke", self._handle_auth_revoke)

            # Config management
            self._app.router.add_get("/api/config", self._handle_get_config)
            self._app.router.add_patch("/api/config", self._handle_patch_config)

            # Memory management
            self._app.router.add_get("/api/memory", self._handle_get_memory)
            self._app.router.add_patch("/api/memory", self._handle_patch_memory)
            self._app.router.add_delete("/api/memory/entry", self._handle_patch_memory)

            # Skills management (literals BEFORE /api/skills/{name})
            self._app.router.add_get("/api/skills", self._handle_list_skills)
            self._app.router.add_get("/api/skills/{name}", self._handle_get_skill)
            self._app.router.add_post("/api/skills/install", self._handle_install_skill)
            self._app.router.add_post("/api/skills/check", self._handle_check_skills)
            self._app.router.add_post("/api/skills/update", self._handle_update_skills)
            self._app.router.add_delete("/api/skills/{name}", self._handle_delete_skill)

            # Port conflict detection — fail fast if port is already in use
            import socket as _socket
            try:
                with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as _s:
                    _s.settimeout(1)
                    _s.connect(('127.0.0.1', self._port))
                logger.error('[%s] Port %d already in use. Set a different port in config.yaml: platforms.api_server.port', self.name, self._port)
                return False
            except (ConnectionRefusedError, OSError):
                pass  # port is free

            self._runner = web.AppRunner(self._app)
            await self._runner.setup()
            self._site = web.TCPSite(self._runner, self._host, self._port)
            await self._site.start()

            self._mark_connected()
            logger.info(
                "[%s] API server listening on http://%s:%d",
                self.name, self._host, self._port,
            )
            return True

        except Exception as e:
            logger.error("[%s] Failed to start API server: %s", self.name, e)
            return False

    async def disconnect(self) -> None:
        """Stop the aiohttp web server."""
        self._mark_disconnected()
        if self._site:
            await self._site.stop()
            self._site = None
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
        self._app = None
        logger.info("[%s] API server stopped", self.name)

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """
        Not used — HTTP request/response cycle handles delivery directly.
        """
        return SendResult(success=False, error="API server uses HTTP request/response, not send()")

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        """Return basic info about the API server."""
        return {
            "name": "API Server",
            "type": "api",
            "host": self._host,
            "port": self._port,
        }
