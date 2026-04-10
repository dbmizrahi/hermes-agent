# Reviewer Feedback: Integration Plan

**Reviewer:** Lead System Reviewer
**Date:** 2026-04-10
**Plan Reviewed:** `docs/api-ui/INTEGRATION_PLAN.md`
**Source Reviewed:** `gateway/platforms/api_server.py` (3370 lines)

---

## Critical

### C1. CORS Middleware Blocks All PATCH Requests

**Location:** `api_server.py` line 208, `INTEGRATION_PLAN.md` Section 9 (Decision #3)

The CORS middleware declares only these allowed methods:
```python
_CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
}
```

But the API server registers **five PATCH routes**: session rename (`/api/sessions/{id}`), config update (`/api/config`), memory mutation (`/api/memory`), tool toggle (`/api/tools/{name}`), toolset toggle (`/api/tools/toolsets/{name}`), MCP update (`/api/mcp/{name}`), and platform update (`/api/gateway/platforms/{name}`).

Every PATCH request from the browser will trigger a CORS preflight (OPTIONS) that returns 403 because PATCH is not in the allowed methods list. The entire Phase 2 page migration will fail on any write operation.

**Fix:** Add `PATCH` to `_CORS_HEADERS["Access-Control-Allow-Methods"]`.

### C2. WebSocket Endpoint Does NOT Accept JWT Tokens

**Location:** `api_server.py` lines 2096-2102, `INTEGRATION_PLAN.md` Section 3.3 / Phase 1 Step 5

The `/ws/agent` handler authenticates by comparing the `token` query parameter directly against `self._api_key`:
```python
token = request.query.get("token", "")
if self._api_key and token != self._api_key:
    # reject
```

It does NOT attempt JWT decode. The plan says "Add token authentication to WS connections" but the backend only accepts raw API keys for WebSocket. The frontend cannot use its Bearer access tokens for WebSocket connections -- it would need to store and send the raw API key separately, which defeats the purpose of JWT rotation.

**Fix options:** (a) Extend `_handle_ws_agent` to accept JWT tokens the same way `_check_auth` does, or (b) document that the frontend must pass the raw API key for WS connections (security risk if the key leaks in browser dev tools network tab).

### C3. SQLite `check_same_thread=False` Creates Data Corruption Risk Under Concurrency

**Location:** `api_server.py` lines 79-81

The `ResponseStore` opens a single SQLite connection with `check_same_thread=False`:
```python
self._conn = sqlite3.connect(db_path, check_same_thread=False)
```

This connection is shared across all aiohttp request handlers running in the async event loop. While aiohttp is single-threaded, the `ResponseStore` is also accessed from background executor threads (e.g., `_ws_run_agent`, `_run_agent` callbacks that call `_create_agent` which calls `_ensure_session_db`). Concurrent writes from multiple async handlers (e.g., two PATCH requests arriving simultaneously) will cause `sqlite3.OperationalError: database is locked` or silent corruption.

This affects all endpoints using the shared connection: auth token storage, response store, and any operation that touches the ResponseStore tables.

**Fix:** Use a connection pool or at minimum wrap all write operations in a threading lock. Consider WAL mode (already enabled) + a per-operation connect/disconnect pattern.

### C4. No Endpoint for Creating Chat Sessions

**Location:** `INTEGRATION_PLAN.md` Section 6.2, line 299

The plan acknowledges: "POST /api/chat/session -- No direct. Use POST /v1/chat/completions with new session_id, or create session via SessionDB indirectly."

This is not viable. The `POST /v1/chat/completions` endpoint generates a random `session_id` internally (`str(uuid.uuid4())`) and only returns it in the `X-Hermes-Session-Id` response header. The frontend has no way to:
1. Pre-create a session with a user-specified title
2. Know the session_id before sending the first message
3. List sessions with their associated message history without first having the session_id

The Chat page workflow (create session -> send messages -> view history) is broken without a session creation endpoint.

**Fix:** Either (a) add `POST /api/sessions` to explicitly create sessions, or (b) ensure the chat completions response body includes the session_id in JSON (not just as a header), and the frontend extracts it from there.

---

## Warning

### W1. SSE Chat Requires Two-Step Round Trip

**Location:** `INTEGRATION_PLAN.md` Section 9 (Decision #2), Section 6.2

The plan proposes using `POST /v1/runs` + SSE (`GET /v1/runs/{run_id}/events`) for chat instead of WebSocket. This requires:
1. POST request to start a run (returns `run_id` with HTTP 202)
2. GET request to subscribe to the SSE stream
3. Handle the race condition where the SSE subscriber connects before the run registers (the API has a 20-retry loop with 50ms sleep, but this is not documented in the plan)

Compared to a single WebSocket connection that handles both sending and receiving, this doubles the number of HTTP connections per chat message and introduces a timing dependency. The plan should document the reconnection logic needed when the SSE subscriber fails to connect within the 1-second window.

### W2. Pagination Adapter Not Specified

**Location:** `INTEGRATION_PLAN.md` Section 6.1, line 272

The frontend expects `{page, page_size, total_pages}` but the API returns `{limit, offset, total}`. The plan notes this discrepancy but provides no adapter strategy. The frontend's pagination UI components likely depend on `total_pages` for rendering page numbers. Converting `offset/limit/total` to `page/page_size/total_pages` requires:
- `page = Math.floor(offset / limit) + 1`
- `page_size = limit`
- `total_pages = Math.ceil(total / limit)`

Without this adapter in the API client layer, pagination UI will break.

### W3. Memory API Response Shape Inconsistency

**Location:** `api_server.py` line 807

`GET /api/memory` returns a flat object: `{memory: {...}, user: {...}}` at the root level -- NOT wrapped in any key. The plan says "Response shape: `{memory: {entries, char_count, char_limit, usage_pct}, user: {...}}`" which is correct, but the API client adapter needs to handle that this response has no wrapper key at all (unlike sessions which returns `{sessions: [...]}`).

Additionally, `PATCH /api/memory` returns `{success, target, entries, char_count, char_limit, usage_pct}` -- a completely different shape. The frontend memory page needs to handle two different response shapes from the same logical endpoint.

### W4. `DELETE /api/memory/entry` Reuses the PATCH Handler

**Location:** `api_server.py` line 3268

Both `PATCH /api/memory` and `DELETE /api/memory/entry` route to `_handle_patch_memory`. This works because the handler reads `action` from the JSON body, but it's semantically confusing and means DELETE requests must have a JSON body (non-standard). Any middleware that strips bodies from DELETE requests will break this endpoint.

### W5. Rate Limiting Missing on Auth Endpoints

**Location:** `api_server.py` lines 533-580

`POST /api/auth/token` accepts any `api_key` value and performs a string comparison. There is no rate limiting, backoff, or lockout mechanism. An attacker can brute-force the API key at full network speed. Since this endpoint is unauthenticated by design, there is no protection.

For a single-user local tool this is low risk, but if `cors_origins` includes `*` (per the plan's potential production deployment), this becomes a serious vulnerability.

### W6. JWT Secret Derivation Uses Known Salt

**Location:** `api_server.py` lines 360-368

```python
hashlib.pbkdf2_hmac("sha256", api_key.encode("utf-8"), b"hermes-jwt-salt-v1", iterations=100_000)
```

The salt is hardcoded. Anyone with access to the source code can derive the JWT secret from a stolen API key. While PBKDF2 with 100k iterations provides some protection, the known salt means an attacker can precompute a rainbow table for common API key patterns. Not critical for local use, but worth noting for any multi-user or network-exposed deployment.

### W7. `_handle_list_sessions` Returns No `total_pages`

**Location:** `api_server.py` line 2324

The session list response includes `total` but not `total_pages`. The frontend pagination components likely need `total_pages` to render page number controls. The plan should explicitly note that `total_pages` must be computed client-side.

### W8. WebSocket Protocol Is One-Message-Per-Connection

**Location:** `api_server.py` lines 2111-2127

The `_handle_ws_agent` handler reads exactly ONE initial message from the WebSocket, runs the agent, streams the response, then closes the connection. The client can send an `interrupt` message during the run, but after the run completes, the connection is dead. The frontend must open a new WebSocket connection for every chat message.

The plan's Step 5 says "Update to work with GET /ws/agent endpoint" but doesn't document this request/response lifecycle. The frontend WebSocket manager needs to implement a connection-per-message pattern, not a persistent connection pattern.

---

## Suggestion

### S1. Add `X-Hermes-Session-Id` to Chat Completions Response Body

Currently the session_id is only in the `X-Hermes-Session-Id` response header (line 1495). For browser fetch, reading custom headers requires the server to expose them via `Access-Control-Expose-Headers`. Add the session_id to the JSON response body as well, or ensure the CORS middleware exposes this header.

### S2. Consider Adding `Access-Control-Expose-Headers` for Session ID and Auth

If the frontend needs to read `X-Hermes-Session-Id` from response headers, the CORS middleware must include:
```python
"Access-Control-Expose-Headers": "X-Hermes-Session-Id",
```
Currently this is missing from `_CORS_HEADERS`.

### S3. Provide a Session Creation Convenience Endpoint

Adding `POST /api/sessions` with body `{title?, model?}` that creates a session in SessionDB and returns `{session_id, ...}` would solve C4 and make the Chat page flow much cleaner. This is a ~15-line addition to `api_server.py`.

### S4. Document the SSE Event Type Contract

The plan lists event types in Step 4 (`tool.started`, `tool.completed`, `reasoning.available`, `message.delta`, `run.completed`, `run.failed`) but the actual `_make_run_event_callback` (lines 1059-1098) only emits `tool.started`, `tool.completed`, `reasoning.available`, and `message.delta` (via the separate `_text_cb`). The `run.completed` and `run.failed` events are emitted by `_run_and_close` (lines 1243-1260) not by the callback. The plan should clarify that `message.delta` comes from a different callback path than the other events.

### S5. Add a Health Check That Includes Gateway Status

The `GET /health` endpoint returns `{"status": "ok", "platform": "hermes-agent"}` but does not indicate whether the gateway is running, if SessionDB is available, or if the API key is configured. For a dashboard health widget, adding optional diagnostic fields (when auth is provided) would be useful.

### S6. Consider Adding `PATCH` to the `_CORS_HEADERS` Allowed Methods Header List

Related to C1 but as a forward-looking note: even after adding PATCH to `Access-Control-Allow-Methods`, the `Access-Control-Allow-Headers` list should also explicitly include any custom headers the frontend sends (e.g., `X-Hermes-Session-Id`). Currently it only lists `Authorization, Content-Type, Idempotency-Key`.

### S7. Standardize Error Response Shapes

The API uses three different error response patterns:
1. OpenAI style: `{"error": {"message": ..., "type": ..., "code": ...}}` (most endpoints)
2. Auth token errors: `{"error": {"message": ..., "code": ...}}` (no `type` field)
3. 501 No API Key: `{"error": {"message": ..., "type": ..., "code": ...}}`

The frontend error handler needs to handle all three. The plan should specify a unified error type that normalizes these.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 4 | PATCH blocked by CORS, WS rejects JWT, SQLite concurrency, no session creation endpoint |
| Warning | 8 | SSE complexity, pagination gap, response shape inconsistency, DELETE-with-body anti-pattern, no auth rate limiting, known JWT salt, missing total_pages, WS one-shot lifecycle |
| Suggestion | 7 | Expose session header, CORS expose headers, session creation endpoint, SSE contract clarity, enhanced health check, PATCH CORS headers, error shape standardization |

The plan is well-structured and correctly identifies most endpoint mismatches. However, the four Critical issues must be resolved before Phase 2 can succeed. The most urgent fix is adding `PATCH` to the CORS allowed methods -- without it, every write operation from the browser will fail.
