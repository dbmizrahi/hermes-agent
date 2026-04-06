"""
Tests for JWT Auth and Session Management API endpoints.

JWT Auth covers:
- Token exchange (POST /api/auth/token)
- Token refresh / rotation (POST /api/auth/refresh)
- Token revocation (POST /api/auth/revoke)
- JWT validation inside _check_auth()

Session Management covers:
- GET /api/sessions (paginated list + source filter)
- GET /api/sessions/search (FTS5 search with q= param)
- GET /api/sessions/{session_id} (single session + messages)
- DELETE /api/sessions/{session_id} (204 on success, 404 if missing)
- GET /api/sessions/{session_id}/export (JSONL with Content-Disposition header)
- PATCH /api/sessions/{session_id} (rename/title, 409 on conflict)
- Auth required on all session endpoints
"""

import json
import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter, cors_middleware

# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------

API_KEY = "test-key-123"

SAMPLE_SESSION = {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "source": "cli",
    "model": "hermes-3-llama-3.1-8b",
    "title": "My Test Session",
    "started_at": 1700000000.0,
    "ended_at": None,
    "message_count": 4,
    "tool_call_count": 1,
    "user_id": None,
}

SAMPLE_MESSAGES = [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there!"},
]


def _derive_jwt_secret_from_key(api_key: str) -> bytes:
    """Reproduce the PBKDF2 derivation used by APIServerAdapter._derive_jwt_secret."""
    import hashlib
    return hashlib.pbkdf2_hmac(
        "sha256",
        api_key.encode("utf-8"),
        b"hermes-jwt-salt-v1",
        100_000,
    )


def _make_adapter(api_key: str = "") -> APIServerAdapter:
    """Create an adapter with optional API key."""
    extra = {}
    if api_key:
        extra["key"] = api_key
    config = PlatformConfig(enabled=True, extra=extra)
    return APIServerAdapter(config)


def _create_jwt(adapter: APIServerAdapter, token_type: str = "access", exp_offset: int = 3600,
                jti: str = None):
    """Create a JWT using the adapter's secret for testing."""
    import jwt as pyjwt
    now = int(time.time())
    payload = {
        "sub": "api_client",
        "iat": now,
        "exp": now + exp_offset,
        "jti": jti or str(uuid.uuid4()),
        "type": token_type,
    }
    return pyjwt.encode(payload, adapter._jwt_secret, algorithm="HS256")


def _create_app(auth_jwt_routes: bool = False,
                session_routes: bool = False,
                adapter: APIServerAdapter = None) -> web.Application:
    """Create aiohttp app with selected routes registered."""
    app = web.Application(middlewares=[cors_middleware])
    if adapter is not None:
        app["api_server_adapter"] = adapter
    if auth_jwt_routes:
        app.router.add_post("/api/auth/token", adapter._handle_auth_token)
        app.router.add_post("/api/auth/refresh", adapter._handle_auth_refresh)
        app.router.add_post("/api/auth/revoke", adapter._handle_auth_revoke)
    if session_routes:
        # Search must be registered before {session_id} to avoid route conflict
        app.router.add_get("/api/sessions/search", adapter._handle_search_sessions)
        app.router.add_get("/api/sessions", adapter._handle_list_sessions)
        app.router.add_get("/api/sessions/{session_id}/export", adapter._handle_export_session)
        app.router.add_get("/api/sessions/{session_id}", adapter._handle_get_session)
        app.router.add_patch("/api/sessions/{session_id}", adapter._handle_rename_session)
        app.router.add_delete("/api/sessions/{session_id}", adapter._handle_delete_session)
    # health for sanity
    app.router.add_get("/health", adapter._handle_health)
    return app


@pytest.fixture
def adapter():
    """Adapter with no API key."""
    return _make_adapter()


@pytest.fixture
def auth_adapter():
    """Adapter with API key set."""
    return _make_adapter(api_key=API_KEY)


# ===================================================================
# JWT AUTH — POST /api/auth/token
# ===================================================================

class TestAuthToken:
    @pytest.mark.asyncio
    async def test_auth_token_valid_api_key(self, auth_adapter):
        """POST /api/auth/token with valid api_key returns access + refresh tokens."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            assert resp.status == 200
            data = await resp.json()
            assert "access_token" in data
            assert "refresh_token" in data
            assert "expires_in" in data
            assert data["expires_in"] == 3600
            assert data["token_type"] == "Bearer"
            # Tokens should be non-empty strings
            assert data["access_token"] and isinstance(data["access_token"], str)
            assert data["refresh_token"] and isinstance(data["refresh_token"], str)

    @pytest.mark.asyncio
    async def test_auth_token_invalid_api_key(self, auth_adapter):
        """POST /api/auth/token with wrong api_key returns 401."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": "wrong-key"})
            assert resp.status == 401
            data = await resp.json()
            assert "error" in data
            assert data["error"].get("message") == "Invalid API key"

    @pytest.mark.asyncio
    async def test_auth_token_no_body(self, auth_adapter):
        """POST /api/auth/token with empty body returns api_key missing → 401."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/token", json={})
            # api_key defaults to "", which != the real key → 401
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_auth_token_invalid_json(self, auth_adapter):
        """POST /api/auth/token with non-JSON body returns 400."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/auth/token",
                data="not json",
                headers={"Content-Type": "application/json"},
            )
            assert resp.status == 400

    @pytest.mark.asyncio
    async def test_auth_token_no_key_configured(self, adapter):
        """POST /api/auth/token when no API key is configured returns 501."""
        app = _create_app(auth_jwt_routes=True, adapter=adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": "anything"})
            assert resp.status == 501
            data = await resp.json()
            assert data["error"]["message"] == "No API key configured"

    @pytest.mark.asyncio
    async def test_auth_token_returns_valid_jwt(self, auth_adapter):
        """The access_token returned by /auth/token is a valid decodable JWT."""
        import jwt as pyjwt
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            assert resp.status == 200
            data = await resp.json()
            access = data["access_token"]
            payload = pyjwt.decode(access, auth_adapter._jwt_secret, algorithms=["HS256"])
            assert payload["sub"] == "api_client"
            assert payload["type"] == "access"
            assert "jti" in payload
            assert "exp" in payload
            assert "iat" in payload

    @pytest.mark.asyncio
    async def test_auth_token_returns_valid_refresh_jwt(self, auth_adapter):
        """The refresh_token returned by /auth/token is a valid JWT with type=refresh."""
        import jwt as pyjwt
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            assert resp.status == 200
            data = await resp.json()
            refresh = data["refresh_token"]
            payload = pyjwt.decode(refresh, auth_adapter._jwt_secret, algorithms=["HS256"])
            assert payload["type"] == "refresh"
            assert "jti" in payload


# ===================================================================
# JWT AUTH — POST /api/auth/refresh
# ===================================================================

class TestAuthRefresh:
    @pytest.mark.asyncio
    async def test_auth_refresh_valid_token(self, auth_adapter):
        """POST /api/auth/refresh with a valid refresh token returns new pair."""
        # First, obtain a refresh token
        token_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(token_app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            assert resp.status == 200
            tokens = await resp.json()
            refresh_token = tokens["refresh_token"]

        # Now refresh it
        refresh_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(refresh_app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": refresh_token})
            assert resp.status == 200
            data = await resp.json()
            assert "access_token" in data
            assert "refresh_token" in data
            assert data["expires_in"] == 3600
            assert data["token_type"] == "Bearer"
            # New tokens should differ from the old (rotation)
            assert data["refresh_token"] != refresh_token

    @pytest.mark.asyncio
    async def test_auth_refresh_invalid_token_returns_401(self, auth_adapter):
        """POST /api/auth/refresh with garbage token returns 401."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": "not-a-jwt"})
            assert resp.status == 401
            data = await resp.json()
            assert "invalid" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_auth_refresh_access_token_rejected(self, auth_adapter):
        """POST /api/auth/refresh with an access token (not refresh) returns 401."""
        token_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(token_app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            access = (await resp.json())["access_token"]

        refresh_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(refresh_app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": access})
            assert resp.status == 401
            data = await resp.json()
            assert "not a refresh token" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_auth_refresh_missing_field(self, auth_adapter):
        """POST /api/auth/refresh without refresh_token field returns empty-string → 401."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={})
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_auth_refresh_twice_fails(self, auth_adapter):
        """Reusing a refresh token after successful refresh returns 401 (rotation)."""
        token_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(token_app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            refresh_token = (await resp.json())["refresh_token"]

        refresh_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(refresh_app)) as cli:
            # First refresh succeeds
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": refresh_token})
            assert resp.status == 200
            # Second refresh with the same (now-rotated) token fails
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": refresh_token})
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_auth_refresh_no_key_configured(self, adapter):
        """POST /api/auth/refresh when no API key configured returns 501."""
        app = _create_app(auth_jwt_routes=True, adapter=adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": "x"})
            assert resp.status == 501

    @pytest.mark.asyncio
    async def test_auth_refresh_invalid_json(self, auth_adapter):
        """POST /api/auth/refresh with non-JSON body returns 400."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/auth/refresh",
                data="bad",
                headers={"Content-Type": "application/json"},
            )
            assert resp.status == 400


# ===================================================================
# JWT AUTH — POST /api/auth/revoke
# ===================================================================

class TestAuthRevoke:
    @pytest.mark.asyncio
    async def test_auth_revoke_valid_jwt(self, auth_adapter):
        """POST /api/auth/revoke with a valid refresh token marks it revoked."""
        # Get a refresh token first
        token_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(token_app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            refresh_token = (await resp.json())["refresh_token"]

        # Revoke it — needs a valid access token for auth
        access_token = _create_jwt(auth_adapter, "access")
        revoke_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(revoke_app)) as cli:
            resp = await cli.post(
                "/api/auth/revoke",
                json={"refresh_token": refresh_token},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert resp.status == 200
            data = await resp.json()
            assert data["revoked"] is True

    @pytest.mark.asyncio
    async def test_auth_revoke_without_auth_returns_401(self, auth_adapter):
        """POST /api/auth/revoke without auth header returns 401."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post("/api/auth/revoke", json={"refresh_token": "x"})
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_auth_revoke_invalidates_refresh(self, auth_adapter):
        """After revoke, the refresh token can no longer be used."""
        # Get tokens
        token_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(token_app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            tokens = await resp.json()
            refresh = tokens["refresh_token"]

        # Revoke
        access_token = _create_jwt(auth_adapter, "access")
        revoke_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(revoke_app)) as cli:
            resp = await cli.post(
                "/api/auth/revoke",
                json={"refresh_token": refresh},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert resp.status == 200

        # Try refreshing the revoked token — must fail
        refresh_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(refresh_app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": refresh})
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_auth_revoke_idempotent(self, auth_adapter):
        """Revoke with an already-invalid token still returns {revoked: true}."""
        access_token = _create_jwt(auth_adapter, "access")
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/auth/revoke",
                json={"refresh_token": "nonexistent-jti-token"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            assert resp.status == 200
            data = await resp.json()
            assert data["revoked"] is True

    @pytest.mark.asyncio
    async def test_auth_revoke_invalid_json(self, auth_adapter):
        """POST /api/auth/revoke with non-JSON body returns 400."""
        app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.post(
                "/api/auth/revoke",
                data="garbage",
                headers={"Content-Type": "application/json"},
            )
            assert resp.status == 400


# ===================================================================
# JWT VALIDATION IN _check_auth()
# ===================================================================

class TestCheckAuthJWT:
    @pytest.mark.asyncio
    async def test_access_token_authorizes_session_list(self, auth_adapter):
        """A valid JWT access token should authorize /api/sessions."""
        access_token = _create_jwt(auth_adapter, "access")
        app = _create_app(session_routes=True, adapter=auth_adapter)
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([], 0)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["sessions"] == []
                assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, auth_adapter):
        """An expired JWT access token returns 401."""
        expired_token = _create_jwt(auth_adapter, "access", exp_offset=-3600)
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                "/api/sessions",
                headers={"Authorization": f"Bearer {expired_token}"},
            )
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_refresh_token_rejected_for_sessions(self, auth_adapter):
        """A refresh token (type=refresh) is NOT a valid access token for other endpoints."""
        refresh_token = _create_jwt(auth_adapter, "refresh")
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                "/api/sessions",
                headers={"Authorization": f"Bearer {refresh_token}"},
            )
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_raw_api_key_still_works(self, auth_adapter):
        """Raw API key as Bearer token still authorizes (backward compat)."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([], 0)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200

    @pytest.mark.asyncio
    async def test_no_key_no_auth_required(self, adapter):
        """When no API key is set, _check_auth returns None for all requests."""
        app = _create_app(session_routes=True, adapter=adapter)
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([], 0)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get("/api/sessions")  # no auth header
                assert resp.status == 200

    @pytest.mark.asyncio
    async def test_wrong_jwt_secret_rejected(self, auth_adapter):
        """A token signed with a different secret is rejected."""
        import jwt as pyjwt
        now = int(time.time())
        payload = {"sub": "api_client", "iat": now, "exp": now + 3600,
                   "jti": "hack", "type": "access"}
        # Sign with wrong secret
        fake_secret = b"wrong-secret-bytes"
        bad_token = pyjwt.encode(payload, fake_secret, algorithm="HS256")

        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                "/api/sessions",
                headers={"Authorization": f"Bearer {bad_token}"},
            )
            assert resp.status == 401


# ===================================================================
# SESSIONS — GET /api/sessions
# ===================================================================

class TestListSessions:
    @pytest.mark.asyncio
    async def test_list_sessions_returns_paginated(self, auth_adapter):
        """GET /api/sessions returns sessions array, total, limit, offset."""
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([SAMPLE_SESSION], 1)
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert "sessions" in data
                assert isinstance(data["sessions"], list)
                assert data["total"] == 1
                assert data["limit"] == 20  # default
                assert data["offset"] == 0

    @pytest.mark.asyncio
    async def test_list_sessions_pagination_params(self, auth_adapter):
        """GET /api/sessions?limit=5&offset=10 passes correct params to db."""
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([], 0)
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions?limit=5&offset=10",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                mock_db.list_sessions.assert_called_once_with(limit=5, offset=10, source=None)

    @pytest.mark.asyncio
    async def test_list_sessions_source_filter(self, auth_adapter):
        """GET /api/sessions?source=telegram filters by source."""
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([SAMPLE_SESSION], 1)
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions?source=telegram",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                mock_db.list_sessions.assert_called_once_with(limit=20, offset=0, source="telegram")

    @pytest.mark.asyncio
    async def test_list_sessions_limit_capped_at_100(self, auth_adapter):
        """GET /api/sessions?limit=999 caps at 100."""
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([], 0)
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions?limit=999",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                mock_db.list_sessions.assert_called_once_with(limit=100, offset=0, source=None)

    @pytest.mark.asyncio
    async def test_list_sessions_auth_required(self, auth_adapter):
        """GET /api/sessions without auth returns 401."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/sessions")
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_list_sessions_db_unavailable(self, auth_adapter):
        """When SessionDB is None, returns empty result."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=None):
                resp = await cli.get(
                    "/api/sessions",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["sessions"] == []
                assert data["total"] == 0


# ===================================================================
# SESSIONS — GET /api/sessions/search
# ===================================================================

class TestSearchSessions:
    @pytest.mark.asyncio
    async def test_search_with_query(self, auth_adapter):
        """GET /api/sessions/search?q=docker returns results."""
        mock_db = MagicMock()
        mock_db.search_messages.return_value = [
            {"id": 1, "session_id": "abc", "snippet": "docker build", "role": "user"}
        ]
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions/search?q=docker",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert "results" in data
                assert data["total"] == 1
                assert data["results"][0]["snippet"] == "docker build"

    @pytest.mark.asyncio
    async def test_search_without_q_returns_400(self, auth_adapter):
        """GET /api/sessions/search without q= returns 400."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                "/api/sessions/search",
                headers={"Authorization": f"Bearer {API_KEY}"},
            )
            assert resp.status == 400
            data = await resp.json()
            assert "q" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_search_empty_q_returns_400(self, auth_adapter):
        """GET /api/sessions/search?q= returns 400."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get(
                "/api/sessions/search?q=",
                headers={"Authorization": f"Bearer {API_KEY}"},
            )
            assert resp.status == 400

    @pytest.mark.asyncio
    async def test_search_with_source_filter(self, auth_adapter):
        """GET /api/sessions/search?q=test&source=cli applies source_filter."""
        mock_db = MagicMock()
        mock_db.search_messages.return_value = []
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions/search?q=test&source=cli",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                mock_db.search_messages.assert_called_once()
                call_kwargs = mock_db.search_messages.call_args[1]
                assert call_kwargs["source_filter"] == ["cli"]

    @pytest.mark.asyncio
    async def test_search_db_unavailable(self, auth_adapter):
        """When SessionDB is None, search returns empty results."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=None):
                resp = await cli.get(
                    "/api/sessions/search?q=test",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["results"] == []
                assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_search_auth_required(self, auth_adapter):
        """GET /api/sessions/search without auth returns 401."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/sessions/search?q=test")
            assert resp.status == 401


# ===================================================================
# SESSIONS — GET /api/sessions/{session_id}
# ===================================================================

class TestGetSession:
    @pytest.mark.asyncio
    async def test_get_session_returns_session_and_messages(self, auth_adapter):
        """GET /api/sessions/{id} returns session dict + messages list."""
        mock_db = MagicMock()
        mock_db.get_session.return_value = SAMPLE_SESSION
        mock_db.get_messages_as_conversation.return_value = SAMPLE_MESSAGES
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                session_id = SAMPLE_SESSION["id"]
                resp = await cli.get(
                    f"/api/sessions/{session_id}",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert "session" in data
                assert "messages" in data
                assert data["session"]["id"] == session_id
                assert data["messages"] == SAMPLE_MESSAGES

    @pytest.mark.asyncio
    async def test_get_session_not_found_returns_404(self, auth_adapter):
        """GET /api/sessions/{id} returns 404 when session doesn't exist."""
        mock_db = MagicMock()
        mock_db.get_session.return_value = None
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions/nonexistent",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 404
                data = await resp.json()
                assert "not found" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_get_session_auth_required(self, auth_adapter):
        """GET /api/sessions/{id} without auth returns 401."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/sessions/some-id")
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_get_session_db_unavailable(self, auth_adapter):
        """When SessionDB is None, returns 503."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=None):
                resp = await cli.get(
                    "/api/sessions/some-id",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 503


# ===================================================================
# SESSIONS — DELETE /api/sessions/{session_id}
# ===================================================================

class TestDeleteSession:
    @pytest.mark.asyncio
    async def test_delete_session_returns_204(self, auth_adapter):
        """DELETE /api/sessions/{id} returns 204 No Content."""
        mock_db = MagicMock()
        mock_db.get_session.return_value = SAMPLE_SESSION
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                session_id = SAMPLE_SESSION["id"]
                resp = await cli.delete(
                    f"/api/sessions/{session_id}",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 204
                mock_db.delete_session.assert_called_once_with(session_id)

    @pytest.mark.asyncio
    async def test_delete_session_not_found_returns_404(self, auth_adapter):
        """DELETE /api/sessions/{id} returns 404 when session doesn't exist."""
        mock_db = MagicMock()
        mock_db.get_session.return_value = None
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.delete(
                    "/api/sessions/nonexistent",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 404

    @pytest.mark.asyncio
    async def test_delete_session_auth_required(self, auth_adapter):
        """DELETE /api/sessions/{id} without auth returns 401."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.delete("/api/sessions/some-id")
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_delete_session_db_unavailable(self, auth_adapter):
        """When SessionDB is None, returns 503."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=None):
                resp = await cli.delete(
                    "/api/sessions/some-id",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 503


# ===================================================================
# SESSIONS — GET /api/sessions/{session_id}/export
# ===================================================================

class TestExportSession:
    @pytest.mark.asyncio
    async def test_export_returns_jsonl_with_content_disposition(self, auth_adapter):
        """GET /api/sessions/{id}/export returns JSONL + Content-Disposition header."""
        import sqlite3
        mock_db = MagicMock()
        mock_db.get_session.return_value = SAMPLE_SESSION
        mock_rows = [
            (1, SAMPLE_SESSION["id"], "user", "Hello", None, None, "terminal", 1700000000.0, None, None, None, None),
            (2, SAMPLE_SESSION["id"], "assistant", "Hi!", None, None, None, 1700000001.0, None, None, None, None),
        ]
        # Mock the db description for column names
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = mock_rows
        mock_db.get_messages.return_value = mock_rows  # unused; we patch get_messages
        mock_db._conn.description = [
            ("id",), ("session_id",), ("role",), ("content",), ("tool_call_id",),
            ("tool_calls",), ("tool_name",), ("timestamp",), ("token_count",),
            ("finish_reason",), ("reasoning",), ("codex_reasoning_items",),
        ]

        def fake_get_messages(sid):
            return mock_rows

        mock_db.get_messages = fake_get_messages

        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                session_id = SAMPLE_SESSION["id"]
                resp = await cli.get(
                    f"/api/sessions/{session_id}/export",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                cd = resp.headers.get("Content-Disposition", "")
                assert "attachment" in cd
                assert f"session-{session_id}.jsonl" in cd
                body = await resp.text()
                # Each line should be valid JSON
                lines = [l for l in body.splitlines() if l]
                assert len(lines) == 2
                for line in lines:
                    parsed = json.loads(line)
                    assert "role" in parsed

    @pytest.mark.asyncio
    async def test_export_not_found_returns_404(self, auth_adapter):
        """GET /api/sessions/{id}/export returns 404 if session doesn't exist."""
        mock_db = MagicMock()
        mock_db.get_session.return_value = None
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions/nonexistent/export",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 404

    @pytest.mark.asyncio
    async def test_export_auth_required(self, auth_adapter):
        """GET /api/sessions/{id}/export without auth returns 401."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/sessions/some-id/export")
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_export_db_unavailable(self, auth_adapter):
        """When SessionDB is None, returns 503."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=None):
                resp = await cli.get(
                    "/api/sessions/some-id/export",
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 503


# ===================================================================
# SESSIONS — PATCH /api/sessions/{session_id} (rename)
# ===================================================================

class TestRenameSession:
    @pytest.mark.asyncio
    async def test_rename_session_with_title(self, auth_adapter):
        """PATCH /api/sessions/{id} with title renames the session."""
        updated_session = {**SAMPLE_SESSION, "title": "New Title"}
        mock_db = MagicMock()
        mock_db.get_session.return_value = SAMPLE_SESSION  # first check — exists
        mock_set_title = MagicMock()
        mock_db.set_session_title = mock_set_title
        # Second get_session returns updated session
        mock_db.get_session = MagicMock(side_effect=[
            SAMPLE_SESSION,  # existence check
            updated_session,  # after rename
        ])

        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                session_id = SAMPLE_SESSION["id"]
                resp = await cli.patch(
                    f"/api/sessions/{session_id}",
                    json={"title": "New Title"},
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert "session" in data
                mock_set_title.assert_called_once_with(session_id, "New Title")

    @pytest.mark.asyncio
    async def test_rename_session_title_conflict_409(self, auth_adapter):
        """PATCH /api/sessions/{id} with a duplicate title returns 409."""
        import sqlite3
        mock_db = MagicMock()
        mock_db.get_session.return_value = SAMPLE_SESSION

        def raise_unique_error(sid, title):
            raise sqlite3.IntegrityError("UNIQUE constraint failed: sessions.title")

        mock_db.set_session_title = raise_unique_error

        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.patch(
                    f"/api/sessions/{SAMPLE_SESSION['id']}",
                    json={"title": "Duplicate Title"},
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 409
                data = await resp.json()
                assert "title_conflict" in data["error"].get("code", "").lower() or \
                       "already" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_rename_session_missing_title(self, auth_adapter):
        """PATCH /api/sessions/{id} with empty title returns 400."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.patch(
                f"/api/sessions/{SAMPLE_SESSION['id']}",
                json={},
                headers={"Authorization": f"Bearer {API_KEY}"},
            )
            assert resp.status == 400
            data = await resp.json()
            assert "title" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_rename_session_not_found(self, auth_adapter):
        """PATCH /api/sessions/{id} for non-existent session returns 404."""
        mock_db = MagicMock()
        mock_db.get_session.return_value = None
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.patch(
                    "/api/sessions/nonexistent",
                    json={"title": "New Name"},
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 404

    @pytest.mark.asyncio
    async def test_rename_session_auth_required(self, auth_adapter):
        """PATCH /api/sessions/{id} without auth returns 401."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.patch(
                f"/api/sessions/{SAMPLE_SESSION['id']}",
                json={"title": "New"},
            )
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_rename_session_db_unavailable(self, auth_adapter):
        """When SessionDB is None, returns 503."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=None):
                resp = await cli.patch(
                    "/api/sessions/some-id",
                    json={"title": "New"},
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                assert resp.status == 503

    @pytest.mark.asyncio
    async def test_rename_session_invalid_json(self, auth_adapter):
        """PATCH /api/sessions/{id} with non-JSON body returns 400."""
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.patch(
                "/api/sessions/some-id",
                data="not json",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {API_KEY}",
                },
            )
            assert resp.status == 400


# ===================================================================
# JWT Token Integration — full flow
# ===================================================================

class TestJWTIntegration:
    @pytest.mark.asyncio
    async def test_full_auth_flow(self, auth_adapter):
        """Complete flow: get token → use access token → refresh → use new token → revoke."""
        # Step 1: Get initial tokens
        token_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(token_app)) as cli:
            resp = await cli.post("/api/auth/token", json={"api_key": API_KEY})
            assert resp.status == 200
            tokens = await resp.json()
            access_token = tokens["access_token"]
            refresh_token = tokens["refresh_token"]

        # Step 2: Use access token to list sessions (auth must pass)
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([SAMPLE_SESSION], 1)
        sessions_app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(sessions_app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    "/api/sessions",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["total"] == 1

        # Step 3: Refresh
        refresh_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(refresh_app)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": refresh_token})
            assert resp.status == 200
            new_tokens = await resp.json()
            new_access = new_tokens["access_token"]
            new_refresh = new_tokens["refresh_token"]

        # Step 4: Use new access token
        mock_db2 = MagicMock()
        mock_db2.list_sessions.return_value = ([], 0)
        sessions_app2 = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(sessions_app2)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db2):
                resp = await cli.get(
                    "/api/sessions",
                    headers={"Authorization": f"Bearer {new_access}"},
                )
                assert resp.status == 200

        # Step 5: Revoke
        revoke_app = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(revoke_app)) as cli:
            resp = await cli.post(
                "/api/auth/revoke",
                json={"refresh_token": new_refresh},
                headers={"Authorization": f"Bearer {new_access}"},
            )
            assert resp.status == 200
            assert (await resp.json())["revoked"] is True

        # Step 6: Revoked refresh token no longer works
        refresh_app2 = _create_app(auth_jwt_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(refresh_app2)) as cli:
            resp = await cli.post("/api/auth/refresh", json={"refresh_token": new_refresh})
            assert resp.status == 401

    @pytest.mark.asyncio
    async def test_token_query_param_auth(self, auth_adapter):
        """JWT access token passed as ?token= should also work for _check_auth."""
        access_token = _create_jwt(auth_adapter, "access")
        mock_db = MagicMock()
        mock_db.list_sessions.return_value = ([], 0)
        app = _create_app(session_routes=True, adapter=auth_adapter)
        async with TestClient(TestServer(app)) as cli:
            with patch.object(auth_adapter, "_ensure_session_db", return_value=mock_db):
                resp = await cli.get(
                    f"/api/sessions?token={access_token}",
                )
                assert resp.status == 200
