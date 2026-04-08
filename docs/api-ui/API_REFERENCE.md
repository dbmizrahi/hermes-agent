# Hermes Agent API Reference

**Base URL:** `http://localhost:8642`
**Scheme:** HTTP / HTTPS (when behind reverse proxy)

---

## Contents

- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Error Format](#error-format)
- [Rate Limiting](#rate-limiting)
- [1. Authentication API](#1-authentication-api)
- [2. WebSocket](#2-websocket)
- [3. Sessions](#3-sessions)
- [4. Config](#4-config)
- [5. Memory](#5-memory)
- [6. Skills](#6-skills)
- [7. Cron Jobs + History](#7-cron-jobs--history)
- [8. Gateway && Platforms](#8-gateway--platforms)
- [9. Tools && MCP](#9-tools--mcp)
- [10. OpenAI Compatibility](#10-openai-compatibility)

---

## Quick Start

```bash
# Health check (no auth)
curl http://localhost:8642/health
# => {"status":"ok","platform":"hermes-agent"}

# Get your config (raw API key auth)
curl -H "Authorization: Bearer YOUR_KEY" http://localhost:8642/api/config

# Or exchange your key for a JWT first
curl -X POST http://localhost:8642/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key":"YOUR_KEY"}'
# => {"access_token":"...","refresh_token":"...","expires_in":3600,"token_type":"Bearer"}

# Use the JWT
curl -H "Authorization: Bearer JWT_ACCESS_TOKEN" http://localhost:8642/api/config
```

---

## Authentication

Hermes Agent supports two authentication modes:

### 1. Raw API Key (Legacy / Simple)
Pass your configured API key directly as a Bearer token. The key is set via `API_SERVER_KEY` env var or `platforms.api_server.extra.key` in `config.yaml`.

```
Authorization: Bearer YOUR_RAW_API_KEY
```

### 2. JWT Bearer Token (Recommended)
Exchange your API key for a short-lived JWT access token (1 hour) + long-lived refresh token (30 days).

**JWT Decoding:** Tokens are signed with HS256 using a PBKDF2-derived secret:
```
secret = pbkdf2_hmac("sha256", api_key.encode("utf-8"), b"hermes-jwt-salt-v1", 100000)
```

**Token Payload:**
```json
{
  "sub": "api_client",
  "iat": 1700000000,
  "exp": 1700003600,
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "type": "access"
}
```

### How Auth Works on Every Request

| Condition | Method |
|---|---|
| Token starts with `Bearer ` and decodes as a valid JWT with `"type":"access"` | Allow |
| Token starts with `Bearer ` and matches the raw API key exactly | Allow |
| Token starts with `Bearer ` but is neither valid JWT nor raw key | **401** |
| No API key is configured on the server | **No auth required** (all requests allowed) |

**Authentication methods (order of precedence):**
1. `Authorization: Bearer <token>` header
2. `?token=<token>` query parameter (WebSocket only)

Most `/api/*` endpoints require authentication when an API key is configured. `/health` and `/v1/models` do not (except `/v1/models` which requires auth on this server). OpenAI-compatible endpoints (`/v1/*`) also require auth.

---

## Error Format

All error responses use an OpenAI-compatible envelope:

```json
{
  "error": {
    "message": "Human-readable error description",
    "type": "error_type",
    "param": "parameter_name_or_null",
    "code": "machine_readable_code"
  }
}
```

| `type` values | Description |
|---|---|
| `invalid_request_error` | Malformed request, missing params |
| `not_found_error` | Resource does not exist |
| `server_error` | Internal server error |
| `connection_error` | Failed to connect to external service |
| `install_error` | Skill installation failure |

| Common `code` values | Description |
|---|---|
| `invalid_api_key` | Wrong or missing API key |
| `no_api_key` | No API key configured (server-side) |
| `session_not_found` | Session ID does not exist |
| `title_conflict` | Duplicate session title |
| `db_unavailable` | SessionDB not initialised |
| `entry_not_found` | Memory entry not found |
| `ambiguous_match` | Memory `old_text` matches multiple entries |
| `memory_limit_exceeded` | Memory char limit exceeded |
| `security_scan_rejected` | Memory content blocked |
| `body_too_large` | POST body exceeds 1 MB |
| `name_conflict` | Duplicate resource name |
| `already_connected` | Platform already active |
| `already_disconnected` | Platform already inactive |
| `token_revoked` | Refresh token was revoked |
| `invalid_token` | JWT is malformed or expired |

---

## Rate Limiting

Hermes Agent does **not** enforce built-in HTTP rate limits. However:

- The `/v1/chat/completions` endpoint supports **Idempotency-Key** headers to deduplicate retried requests (5-minute TTL, max 1000 entries).
- Agent iterations are controlled via `max_iterations` (default 90) — this limits the number of tool-calling loops per request, not the number of HTTP requests.
- The underlying LLM provider (OpenRouter, Anthropic, etc.) will impose its own rate limits.
- Request bodies are capped at **1 MB** (`MAX_REQUEST_BYTES`).

---

## 1. Authentication API

### POST /api/auth/token — Exchange API Key for JWT Tokens

Exchanges a raw API key for a short-lived access token and a long-lived refresh token.

**Authentication:** Not required (this is the token exchange endpoint).

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `api_key` | string | Yes | The server's configured API key |

```json
{
  "api_key": "my-secret-key"
}
```

**Response — 200 OK:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | `{"error":{"message":"Invalid JSON","type":"invalid_request_error"}}` |
| 401 | `{"error":{"message":"Invalid API key","type":"invalid_request_error","code":"invalid_api_key"}}` |
| 501 | `{"error":{"message":"No API key configured","type":"server_error","code":"no_api_key"}}` |

---

### POST /api/auth/refresh — Rotate Refresh Token

Exchanges a valid refresh token for a new access/refresh pair. The old refresh token is revoked (rotation).

**Authentication:** Not required (refresh token is self-validating).

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `refresh_token` | string | Yes | A valid, non-revoked refresh JWT |

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsI..."
}
```

**Response — 200 OK:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | `{"error":{"message":"Invalid JSON","type":"invalid_request_error"}}` |
| 401 | `{"error":{"message":"Invalid or expired refresh token","code":"invalid_token"}}` |
| 401 | `{"error":{"message":"Not a refresh token","code":"invalid_token"}}` |
| 401 | `{"error":{"message":"Refresh token revoked or expired","code":"token_revoked"}}` |
| 501 | `{"error":{"message":"No API key configured","type":"server_error","code":"no_api_key"}}` |

---

### POST /api/auth/revoke — Revoke a Refresh Token

Marks a refresh token as permanently invalidated. Idempotent — calling with an already-invalid token is a no-op.

**Authentication:** Required (Bearer token or raw API key).

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `refresh_token` | string | Yes | The refresh token to revoke |

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsI..."
}
```

**Response — 200 OK:**

```json
{
  "revoked": true
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | `{"error":{"message":"Invalid JSON","type":"invalid_request_error"}}` |
| 401 | Standard auth failure |
| 501 | No API key configured |

---

## 2. WebSocket

### GET /ws/agent — Real-Time Agent Communication

Opens a persistent WebSocket connection to send a single user message and stream back real-time agent output (delta text, tool progress, completion events).

**Authentication:** Required. Pass via `?token=YOUR_API_KEY` query parameter. Only raw API key is supported (no JWT on WebSocket).

**Query Parameters:** None (authentication via `?token=`).

**Connection Flow:**

1. Client opens WebSocket connection.
2. Server validates `token` query parameter.
3. Client sends a single JSON text message:
   ```json
   {
     "type": "message",
     "content": "What is the weather today?",
     "session_id": "optional-existing-uuid",
     "tool_events": true
   }
   ```
4. Server streams events as JSON objects until completion.
5. Connection closes (or client can send `{"type":"interrupt"}` to stop).

**Client -> Server Messages:**

| Type | Fields | Description |
|---|---|---|
| `message` | `content` (string, required), `session_id` (string, optional), `tool_events` (bool, optional, default false) | Submit a user message to the agent |
| `interrupt` | — | Request the agent to interrupt its current run |

**Server -> Client Events (JSON objects):**

| `type` | Fields | Description |
|---|---|---|
| `delta` | `content` (string) | A fragment of the assistant's streaming text response |
| `tool_progress` | `name` (string), `preview` (string), `emoji` (string) | A tool is being executed (only if `tool_events: true`) |
| `done` | `session_id` (string), `usage` (object: `input_tokens`, `output_tokens`, `total_tokens`) | Agent has finished |
| `error` | `message` (string) | An error occurred |

**Example Event Stream:**

```json
{"type":"delta","content":"The current weather"}
{"type":"delta","content":" is sunny "}
{"type":"delta","content":"and 72°F."}
{"type":"done","session_id":"abc-123","usage":{"input_tokens":1240,"output_tokens":85,"total_tokens":1325}}
```

**Errors (sent as WebSocket message, connection closed after):**

| Message | Cause |
|---|---|
| `{"type":"error","message":"Invalid API key"}` | Token doesn't match configured key |
| `{"type":"error","message":"Invalid JSON"}` | Client sent non-JSON text frame |
| `{"type":"error","message":"Expected {type: message, content: ...}"}` | Malformed message payload |
| `{"type":"error","message":"..."}` | Unexpected server error |

---

## 3. Sessions

### GET /api/sessions — List Sessions

Returns a paginated list of conversation sessions.

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `20` | Max sessions to return (max 100) |
| `offset` | integer | `0` | Pagination offset |
| `source` | string | — | Filter by source (`cli`, `gateway`, `api_server`, etc.) |

**Response — 200 OK:**

```json
{
  "sessions": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "source": "cli",
      "model": "hermes-3-llama-3.1-8b",
      "title": "My Test Session",
      "started_at": 1700000000.0,
      "ended_at": null,
      "message_count": 4,
      "tool_call_count": 1,
      "user_id": null
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |

---

### GET /api/sessions/search — Full-Text Search Sessions

Search across session messages using SQLite FTS5.

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes | Search query |
| `limit` | integer | `10` | Max results (max 50) |
| `source` | string | — | Filter by source |

**Response — 200 OK:**

```json
{
  "results": [
    {
      "session_id": "...",
      "message": "...",
      "role": "user",
      "source": "cli"
    }
  ],
  "total": 3
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | `{"error":{"message":"Missing query parameter 'q'","type":"invalid_request_error"}}` |
| 401 | Standard auth failure |

---

### GET /api/sessions/{session_id} — Get Single Session

Returns a session's metadata and full message history.

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `session_id` | UUID | The session identifier |

**Response — 200 OK:**

```json
{
  "session": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "source": "cli",
    "model": "hermes-3-llama-3.1-8b",
    "title": "My Test Session",
    "started_at": 1700000000.0,
    "ended_at": null,
    "message_count": 4,
    "tool_call_count": 1,
    "user_id": null
  },
  "messages": [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there!"}
  ]
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | `{"error":{"message":"Session not found","type":"not_found_error","code":"session_not_found"}}` |
| 503 | `{"error":{"message":"Database unavailable","code":"db_unavailable"}}` |

---

### DELETE /api/sessions/{session_id} — Delete Session

Permanently deletes a session and all its messages.

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `session_id` | UUID | The session to delete |

**Response — 204 No Content**

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | `{"error":{"message":"Session not found","type":"not_found_error","code":"session_not_found"}}` |
| 503 | `{"error":{"message":"Database unavailable"}}` |

---

### GET /api/sessions/{session_id}/export — Export Session as JSONL

Downloads the raw message data for a session as newline-delimited JSON (JSONL).

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `session_id` | UUID | The session to export |

**Response — 200 OK:**

```text
Content-Type: application/x-ndjson
Content-Disposition: attachment; filename="session-a1b2c3d4.jsonl"

{"id":"1","role":"user","content":"Hello",...}
{"id":"2","role":"assistant","content":"Hi!",...}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | Session not found |
| 503 | Database unavailable |

---

### PATCH /api/sessions/{session_id} — Rename Session

Updates a session's title.

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `session_id` | UUID | The session to rename |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | New title for the session |

```json
{
  "title": "My Updated Session Title"
}
```

**Response — 200 OK:**

```json
{
  "session": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "title": "My Updated Session Title",
    "model": "...",
    "...": "..."
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Missing `title` field |
| 401 | Standard auth failure |
| 404 | Session not found |
| 409 | `{"error":{"message":"Title already in use","code":"title_conflict"}}` |
| 503 | Database unavailable |

---

## 4. Config

### GET /api/config — Read Configuration

Returns the current `config.yaml` with all secret fields redacted as `***`.

**Authentication:** Required.

**Response — 200 OK:**

```json
{
  "config": {
    "model": "gpt-4",
    "name": "test-agent",
    "api_key": "***",
    "token": "***",
    "password": "***",
    "memory_mode": "hybrid"
  }
}
```

If no `config.yaml` exists, returns `{"config": {}}`.

**Redacted key patterns (case-insensitive):**
`key`, `api_key`, `token`, `password`, `secret`, `webhook_url`, `bot_token`, `access_token`, `refresh_token`

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 500 | `{"error":{"message":"Failed to read config: ...","type":"server_error"}}` |

---

### PATCH /api/config — Update Configuration

Applies partial updates to `config.yaml` with dot-notation support. Only supplied keys are modified; the rest of the config is preserved.

**Authentication:** Required.

**Request Body:**

Accepts either flat dot-notation keys or nested objects.

```json
{
  "model.default": "claude-sonnet-4-20250514",
  "memory_mode": "hybrid"
}
```

Or:

```json
{
  "model": {
    "default": "claude-sonnet-4-20250514"
  },
  "memory_mode": "hybrid"
}
```

**Response — 200 OK:**

Returns the full merged config (with secrets redacted).

```json
{
  "config": {
    "model": {
      "default": "claude-sonnet-4-20250514"
    },
    "memory_mode": "hybrid",
    "api_key": "***",
    "name": "test-agent"
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Invalid JSON, non-object body, or invalid config values |
| 401 | Standard auth failure |
| 500 | Failed to write config file |

---

## 5. Memory

### GET /api/memory — Read Memory Entries

Returns all memory and user memory entries with character usage stats.

**Authentication:** Required.

**Response — 200 OK:**

```json
{
  "memory": {
    "entries": [
      "User prefers dark mode",
      "Project uses Python 3.12"
    ],
    "char_count": 52,
    "char_limit": 2200,
    "usage_pct": 2.4
  },
  "user": {
    "entries": [
      "Name: Alice"
    ],
    "char_count": 11,
    "char_limit": 1375,
    "usage_pct": 0.8
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |

---

### PATCH /api/memory — Add, Replace, or Remove Memory Entries

Manages individual memory entries. Entries are delimited by `§` in the underlying `MEMORY.md` / `USER.md` files.

**Authentication:** Required.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | string | Yes | `"memory"` (MEMORY.md) or `"user"` (USER.md) |
| `action` | string | Yes | `"add"`, `"replace"`, or `"remove"` |
| `content` | string | For `add` / `replace` | New or replacement entry text |
| `old_text` | string | For `replace` / `remove` | Substring to identify the existing entry |

**Example — Add:**

```json
{
  "target": "memory",
  "action": "add",
  "content": "Team standups are at 10 AM EST on weekdays"
}
```

**Example — Replace:**

```json
{
  "target": "memory",
  "action": "replace",
  "old_text": "Python 3.12",
  "content": "Upgraded to Python 3.13"
}
```

**Example — Remove:**

```json
{
  "target": "user",
  "action": "remove",
  "old_text": "Name: Alice"
}
```

**Response — 200 OK:**

```json
{
  "success": true,
  "target": "memory",
  "entries": ["Project uses Python 3.13", "Team standups at 10 AM"],
  "char_count": 48,
  "char_limit": 2200
}
```

**Character Limits:** `memory` = 2200 chars, `user` = 1375 chars.

**Security Scan:** Content is scanned for threats (injection, exfiltration patterns). Rejected content returns 422.

**Errors:**

| Status | Response |
|---|---|
| 400 | Missing `old_text` for replace/remove, or invalid action/target |
| 401 | Standard auth failure |
| 413 | `{"error":{"message":"Adding this entry would exceed the 2200 char limit","code":"memory_limit_exceeded"}}` |
| 400 | `{"error":{"message":"No entry found matching 'old_text'","code":"entry_not_found"}}` |
| 400 | `{"error":{"message":"'old_text' matches multiple entries","code":"ambiguous_match"}}` |
| 422 | `{"error":{"message":"Content rejected by security scan","code":"security_scan_rejected"}}` |

---

## 6. Skills

### GET /api/skills — List Installed Skills

Lists all skills installed in `~/.hermes/skills/`. Parses `SKILL.md` frontmatter for metadata.

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `category` | string | Filter by category |

**Response — 200 OK:**

```json
{
  "skills": [
    {
      "name": "coder",
      "category": "development",
      "description": "Coding helper",
      "version": "1.0",
      "path": "/home/user/.hermes/skills/coder",
      "has_references": false,
      "has_scripts": false,
      "has_templates": false
    }
  ],
  "total": 1
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |

---

### GET /api/skills/{name} — Get Skill Details

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `name` | string | Skill name (matches directory name or frontmatter `name` field) |

**Response — 200 OK:** Same schema as a single skill object from the list endpoint.

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | `{"error":{"message":"Skill not found","type":"not_found_error"}}` |

---

### POST /api/skills/install — Install a Skill

Installs a skill from the Skills Hub registry.

**Authentication:** Required.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `skill` | string | Yes | Skill identifier from hub |
| `force` | boolean | No | Force reinstall even if already present (default: `false`) |

```json
{
  "skill": "web-research",
  "force": false
}
```

**Response — 200 OK:**

```json
{
  "success": true,
  "skill_id": "web-research",
  "installed_path": "/home/user/.hermes/skills/web-research"
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Missing `skill` field |
| 401 | Standard auth failure |
| 422 | `{"error":{"message":"...","type":"install_error"}}` |

---

### DELETE /api/skills/{name} — Remove a Skill

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `name` | string | Skill name to uninstall |

**Response — 204 No Content**

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | `{"error":{"message":"Skill not found","type":"not_found_error"}}` |

---

### POST /api/skills/check — Check for Skill Updates

Checks all installed skills against the hub for available updates.

**Authentication:** Required.

**Request Body:** `{}` (empty or omitted)

```json
{}
```

**Response — 200 OK:**

```json
{
  "updates_available": ["coder"],
  "up_to_date": ["web-research"],
  "total_installed": 2
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |

---

### POST /api/skills/update — Update Skills

Updates installed skills to their latest versions from the hub.

**Authentication:** Required.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `skills` | array of strings | No | List of skill IDs to update. Omit to update all. |

```json
{
  "skills": ["coder", "web-research"]
}
```

**Response — 200 OK:**

```json
{
  "updated": ["coder"],
  "failed": [],
  "skipped": []
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |

---

## 7. Cron Jobs + History

### GET /api/jobs — List Cron Jobs

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `include_disabled` | boolean | `false` | Include disabled jobs in results |

**Response — 200 OK:**

```json
{
  "jobs": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "daily-briefing",
      "schedule": "0 8 * * *",
      "prompt": "Generate a daily news briefing...",
      "deliver": "local",
      "enabled": true,
      "repeat": null,
      "skills": []
    }
  ]
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 501 | `{"error":"Cron module not available"}` |
| 500 | `{"error":"..."}` |

---

### POST /api/jobs — Create Cron Job

**Authentication:** Required.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Job name (max 200 chars) |
| `schedule` | string | Yes | Cron expression (e.g. `"0 8 * * *"`) |
| `prompt` | string | Yes | Prompt to send to the agent (max 5000 chars) |
| `deliver` | string | No | Delivery target (`"local"`, `"discord"`, etc.). Default: `"local"` |
| `skills` | array | No | Skills to activate for this job |
| `repeat` | integer | No | Number of times to repeat the run |

```json
{
  "name": "weekly-report",
  "schedule": "0 9 * * 1",
  "prompt": "Summarize this week's activity",
  "deliver": "local",
  "skills": ["web-research"]
}
```

**Response — 200 OK:**

```json
{
  "job": {
    "id": "a1b2c3d4e5f6",
    "name": "weekly-report",
    "schedule": "0 9 * * 1",
    "...": "..."
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Missing/invalid name, schedule, or field length exceeded |
| 401 | Standard auth failure |
| 501 | Cron module not available |
| 500 | Internal error |

---

### GET /api/jobs/{job_id} — Get Single Job

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `job_id` | string | 12-char hex ID (`[a-f0-9]{12}`) |

**Response — 200 OK:**

```json
{
  "job": {
    "id": "a1b2c3d4e5f6",
    "name": "daily-briefing",
    "...": "..."
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Invalid job ID format |
| 401 | Standard auth failure |
| 404 | Job not found |
| 501 | Cron module not available |

---

### PATCH /api/jobs/{job_id} — Update Cron Job

Only whitelisted fields can be updated: `name`, `schedule`, `prompt`, `deliver`, `skills`, `skill`, `repeat`, `enabled`.

**Authentication:** Required.

**Path Variables:** `job_id` (12-char hex)

**Request Body:** Any combination of whitelisted fields.

```json
{
  "prompt": "Updated prompt text",
  "enabled": false
}
```

**Response — 200 OK:**

```json
{
  "job": {
    "id": "a1b2c3d4e5f6",
    "prompt": "Updated prompt text",
    "enabled": false,
    "...": "..."
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | No valid fields, or field length exceeded |
| 401 | Standard auth failure |
| 404 | Job not found |
| 501 | Cron module not available |

---

### DELETE /api/jobs/{job_id} — Delete Cron Job

**Authentication:** Required.

**Path Variables:** `job_id`

**Response — 200 OK:**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Invalid job ID format |
| 401 | Standard auth failure |
| 404 | Job not found |

---

### POST /api/jobs/{job_id}/pause — Pause a Job

**Authentication:** Required.

**Path Variables:** `job_id`

**Response — 200 OK:** `{ "job": { ... } }`

**Errors:** 400, 401, 404, 501

---

### POST /api/jobs/{job_id}/resume — Resume a Paused Job

**Authentication:** Required.

**Path Variables:** `job_id`

**Response — 200 OK:** `{ "job": { ... } }`

**Errors:** 400, 401, 404, 501

---

### POST /api/jobs/{job_id}/run — Trigger Immediate Execution

Manually trigger a job run outside its schedule.

**Authentication:** Required.

**Path Variables:** `job_id`

**Response — 200 OK:** `{ "job": { ... } }`

**Errors:** 400, 401, 404, 501

---

### GET /api/jobs/{job_id}/history — List Run Outputs

Lists all output files generated by a cron job's runs, sorted newest first.

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `job_id` | string | 12-char hex ID |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `20` | Max runs to return (max 100) |
| `offset` | integer | `0` | Pagination offset |

**Response — 200 OK:**

```json
{
  "job_id": "a1b2c3d4e5f6",
  "job_name": "daily-briefing",
  "runs": [
    {
      "run_id": "20260401_083000",
      "started_at": "2026-04-01 08:30:00",
      "size_bytes": 4521,
      "status": "success"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Invalid job ID format |
| 401 | Standard auth failure |
| 404 | Job not found |

---

### GET /api/jobs/{job_id}/output/{run_id} — Get Run Output Content

Returns the markdown output of a specific cron job run.

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `job_id` | string | 12-char hex ID |
| `run_id` | string | Timestamp format `YYYYMMDD_HHMMSS` |

**Response — 200 OK:**

```text
Content-Type: text/markdown

# Daily Briefing — April 1, 2026

...
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Invalid job ID or run ID format |
| 401 | Standard auth failure |
| 404 | `{"error":{"message":"Run output not found","type":"not_found_error"}}` |

---

### GET /api/jobs/output — List All Run Outputs (Cross-Job)

Lists run outputs across all cron jobs in a single paginated endpoint.

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `20` | Max results (max 100) |
| `offset` | integer | `0` | Pagination offset |
| `job_id` | string | — | Filter to a single job |

**Response — 200 OK:**

```json
{
  "runs": [
    {
      "run_id": "20260401_083000",
      "job_id": "a1b2c3d4e5f6",
      "job_name": "daily-briefing",
      "started_at": "2026-04-01 08:30:00",
      "size_bytes": 4521
    }
  ],
  "total": 15,
  "limit": 20,
  "offset": 0
}
```

---

## 8. Gateway && Platforms

### GET /api/gateway/status — Gateway Status

Returns overall gateway health, connected platforms, version, and active session count.

**Authentication:** Required.

**Response — 200 OK:**

```json
{
  "status": "running",
  "uptime_seconds": 86400,
  "version": "0.4.0",
  "model": "claude-sonnet-4-20250514",
  "active_sessions": 3,
  "platforms": [
    {
      "name": "discord-bot",
      "type": "discord",
      "connected": true,
      "connected_since": 1700000000.0,
      "error": null
    }
  ]
}
```

**Errors:** 401 (auth failure)

---

### GET /api/gateway/platforms — List Platforms

Lists all configured gateway platforms with their connection status and redacted config.

**Authentication:** Required.

**Response — 200 OK:**

```json
{
  "platforms": [
    {
      "name": "discord-bot",
      "type": "discord",
      "connected": true,
      "config": {
        "bot_token": "***",
        "channel_id": "123456789"
      }
    }
  ]
}
```

**Errors:** 401 (auth failure)

---

### POST /api/gateway/platforms — Add Platform

Adds a new platform to config.yaml. Optionally connects it immediately.

**Authentication:** Required.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique platform name |
| `type` | string | Yes | Platform type (`discord`, `slack`, `signal`, `matrix`, `telegram`, `homeassistant`, `mattermost`, `api_server`, `web_research`, etc.) |
| `config` | object | No | Platform-specific configuration (secret fields redacted in response) |
| `connect` | boolean | No | Whether to connect immediately (default: `true`) |

```json
{
  "name": "slack-bot",
  "type": "slack",
  "config": {
    "bot_token": "xoxb-...",
    "signing_secret": "..."
  },
  "connect": true
}
```

**Response — 200 OK:**

```json
{
  "name": "slack-bot",
  "type": "slack",
  "connected": true,
  "config": {
    "bot_token": "***",
    "signing_secret": "***"
  }
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Missing `name` or `type` |
| 401 | Standard auth failure |
| 409 | `{"error":{"message":"Platform name already exists","code":"name_conflict"}}` |
| 502 | `{"error":{"message":"Config saved but connection failed: ...","code":"connect_failed"}}` |

---

### PATCH /api/gateway/platforms/{name} — Update Platform Config

Updates a platform's configuration in `config.yaml`.

**Authentication:** Required.

**Path Variables:**

| Variable | Type | Description |
|---|---|---|
| `name` | string | Platform name |

**Request Body:** Fields to update (merged into existing config).

```json
{
  "channel_id": "new-channel-id"
}
```

**Response — 200 OK:**

```json
{
  "name": "discord-bot",
  "config": {
    "channel_id": "new-channel-id",
    "bot_token": "***"
  }
}
```

**Errors:** 401, 404 (platform not found)

---

### DELETE /api/gateway/platforms/{name} — Remove Platform

Removes a platform from config.yaml and disconnects it from the running gateway.

**Authentication:** Required.

**Path Variables:** `name`

**Response — 200 OK:**

```json
{
  "name": "discord-bot",
  "removed": true
}
```

**Errors:** 401, 404

---

### POST /api/gateway/platforms/{name}/connect — Connect Platform

Connects a configured but disconnected platform.

**Authentication:** Required.

**Path Variables:** `name`

**Response — 200 OK:**

```json
{
  "name": "discord-bot",
  "connected": true
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | Platform not found |
| 409 | `{"error":{"message":"Platform already connected","code":"already_connected"}}` |
| 502 | `{"error":{"message":"Failed to connect platform 'discord-bot'","type":"connection_error"}}` |
| 503 | Gateway runner not available |

---

### POST /api/gateway/platforms/{name}/disconnect — Disconnect Platform

Gracefully disconnects a running platform adapter.

**Authentication:** Required.

**Path Variables:** `name`

**Response — 200 OK:**

```json
{
  "name": "discord-bot",
  "connected": false
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | Platform not found |
| 409 | `{"error":{"message":"Platform already disconnected","code":"already_disconnected"}}` |
| 503 | Gateway runner not available |

---

## 9. Tools && MCP

### GET /api/tools — List All Tools

Lists every registered tool with its toolset, enabled status, and required env vars.

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `toolset` | string | Filter by toolset name |
| `enabled` | string | `"true"` or `"false"` to filter by status |

**Response — 200 OK:**

```json
{
  "tools": [
    {
      "name": "read_file",
      "toolset": "files",
      "description": "Read a text file with line numbers",
      "enabled": true,
      "requires_env": []
    },
    {
      "name": "web_search",
      "toolset": "web",
      "description": "Search the web via Tavily",
      "enabled": true,
      "requires_env": ["TAVILY_API_KEY"]
    }
  ],
  "total": 45,
  "enabled_count": 30
}
```

**Errors:** 401

---

### PATCH /api/tools/{name} — Enable/Disable a Tool

Toggles a tool's enabled status by updating `platform_toolsets.api_server.<name>` in config.yaml.

**Authentication:** Required.

**Path Variables:** `name` (tool name)

**Request Body:**

```json
{
  "enabled": false
}
```

**Response — 200 OK:**

```json
{
  "name": "web_search",
  "enabled": false
}
```

**Errors:** 400 (missing `enabled`), 401

---

### GET /api/tools/toolsets — List Toolsets

Lists all available toolsets with their tool memberships and enabled status.

**Authentication:** Required.

**Response — 200 OK:**

```json
{
  "toolsets": [
    {
      "name": "files",
      "description": "File system operations",
      "tools": ["read_file", "write_file", "patch", "search_files"],
      "enabled": true,
      "tool_count": 4,
      "enabled_tool_count": 4
    },
    {
      "name": "web",
      "description": "Web search and extraction",
      "tools": ["web_search", "web_extract"],
      "enabled": true,
      "tool_count": 2,
      "enabled_tool_count": 2
    }
  ]
}
```

**Errors:** 401

---

### PATCH /api/tools/toolsets/{name} — Enable/Disable a Toolset

Toggles a toolset's enabled status. All tools in the toolset are controlled together.

**Authentication:** Required.

**Path Variables:** `name` (toolset name)

**Request Body:**

```json
{
  "enabled": false
}
```

**Response — 200 OK:**

```json
{
  "name": "web",
  "enabled": false
}
```

**Errors:** 400, 401

---

### GET /api/mcp — List MCP Servers

Lists all configured Model Context Protocol (MCP) servers from `config.yaml`.

**Authentication:** Required.

**Response — 200 OK:**

```json
{
  "servers": [
    {
      "name": "filesystem-mcp",
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/home/user/projects"],
      "url": null,
      "enabled": true,
      "tools_filter": null,
      "connected": false
    },
    {
      "name": "github-mcp",
      "type": "http",
      "command": null,
      "args": [],
      "url": "https://api.github.com/mcp",
      "enabled": true,
      "tools_filter": [],
      "connected": false
    }
  ]
}
```

**Errors:** 401

---

### POST /api/mcp — Add MCP Server

**Authentication:** Required.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `reload` | boolean | `false` | Immediately reconnect the MCP server after adding |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique server name |
| `command` | string | For stdio | Executable command |
| `args` | array | For stdio | Command arguments |
| `url` | string | For http | HTTP endpoint URL |
| `enabled` | boolean | No | Default: `true` |
| `tools_filter` | array | No | Limit which tools to expose |

```json
{
  "name": "filesystem-mcp",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-filesystem", "/home/user"],
  "enabled": true
}
```

**Response — 201 Created:**

```json
{
  "name": "filesystem-mcp",
  "connected": false,
  "reload_error": null
}
```

With `?reload=true`:

```json
{
  "name": "filesystem-mcp",
  "connected": true,
  "tool_count": 6
}
```

**Errors:**

| Status | Response |
|---|---|
| 400 | Missing `name` |
| 401 | Standard auth failure |
| 409 | `{"error":{"message":"MCP server name already exists","code":"name_conflict"}}` |

---

### PATCH /api/mcp/{name} — Update MCP Server

Updates an existing MCP server's configuration.

**Authentication:** Required.

**Path Variables:** `name`

**Request Body:** Fields to merge into existing config.

```json
{
  "enabled": false
}
```

**Response — 200 OK:**

```json
{
  "name": "filesystem-mcp",
  "config": {
    "command": "npx",
    "args": ["..."],
    "enabled": false
  }
}
```

**Errors:** 401, 404

---

### DELETE /api/mcp/{name} — Remove MCP Server

**Authentication:** Required.

**Path Variables:** `name`

**Response — 200 OK:**

```json
{
  "name": "filesystem-mcp",
  "removed": true
}
```

**Errors:** 401, 404

---

### POST /api/mcp/{name}/reload — Reload MCP Server Connection

Disconnects and reconnects an MCP server, re-discovering available tools.

**Authentication:** Required.

**Path Variables:** `name`

**Response — 200 OK:**

```json
{
  "name": "filesystem-mcp",
  "connected": true,
  "tool_count": 6
}
```

**Errors:**

| Status | Response |
|---|---|
| 401 | Standard auth failure |
| 404 | MCP server not found |
| 502 | `{"error":{"message":"Reload failed: ...","type":"connection_error"}}` |

---

## 10. OpenAI Compatibility

Hermes Agent provides an OpenAI-compatible API surface at `/v1/` so that any OpenAI-compatible frontend (Open WebUI, LobeChat, LibreChat, AnythingLLM, ChatBox, etc.) can connect by pointing at `http://localhost:8642/v1`.

### Overview of Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/v1/chat/completions` | POST | Required | OpenAI Chat Completions format. Supports `stream: true` for SSE. Accepts `X-Hermes-Session-Id` header for session continuity. |
| `/v1/responses` | POST | Required | OpenAI Responses API format. Stateful via `previous_response_id` or `conversation` name. |
| `/v1/responses/{response_id}` | GET | Required | Retrieve a stored response object. |
| `/v1/responses/{response_id}` | DELETE | Required | Delete a stored response object. |
| `/v1/models` | GET | Required | Lists `hermes-agent` as the available model. |

### Key Behavior

- **Model name:** Always returns `hermes-agent` in `/v1/models`. The `model` field in requests is accepted but ignored — the server routes to whatever model is configured in its runtime config.
- **Session continuity:** Pass `X-Hermes-Session-Id` with a known UUID to continue an existing conversation (history loaded from `state.db` instead of request body).
- **Streaming:** `/v1/chat/completions` supports full SSE streaming. Client disconnect interrupts the agent.
- **Idempotency:** Both `/v1/chat/completions` and `/v1/responses` accept `Idempotency-Key` headers.
- **Responses API statefulness:** Responses are stored in SQLite (max 100 entries, LRU eviction). `previous_response_id` chains multi-turn conversations.
- **Truncation:** Supports `"truncation": "auto"` in `/v1/responses` to automatically trim history > 100 messages.

### cURL Example

```bash
curl -X POST http://localhost:8642/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "hermes-agent",
    "messages": [
      {"role": "user", "content": "Hello, what can you do?"}
    ],
    "stream": false
  }'
```

### Full OpenAI Documentation

For complete parameter specifications, response schemas, and advanced features (function calling, vision, etc.), refer to:

- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI Models API](https://platform.openai.com/docs/api-reference/models)
- [OpenAI SSE Streaming Guide](https://platform.openai.com/docs/guides/streaming)

Note that Hermes Agent implements a subset of these APIs focused on the core chat/responses workflows. Not all openai-specific parameters (e.g., `temperature`, `top_p`, `tools`, `tool_choice`) are fully forwarded — check the agent's behavior for your use case.

---

## Appendix: Platform Types

The following platform types are supported in the gateway:

| Type | Description |
|---|---|
| `discord` | Discord bot via discord.py |
| `slack` | Slack bolt app |
| `signal` | Signal bot via signal-cli |
| `matrix` | Matrix homeserver bot |
| `telegram` | Telegram bot |
| `homeassistant` | Home Assistant integration |
| `mattermost` | Mattermost bot |
| `api_server` | This OpenAI-compatible HTTP API |
| `web_research` | Headless web research environment |

## Appendix: Toolsets Reference

| Toolset | Description |
|---|---|
| `files` | File system I/O (read, write, patch, search, list) |
| `web` | Web search and content extraction |
| `terminal` | Terminal command execution with sandboxing |
| `browser` | Browser automation and screenshot capture |
| `memory` | Long-term memory read/write |
| `skills` | Skill viewing and management |
| `sessions` | Session search and listing |
| `vision` | Image analysis and vision models |
| `mcp` | Model Context Protocol server connections |
| `communication` | Messaging tools (clarify, send_message, TTS) |

---

*Generated from hermes-agent source. Last updated: April 2026.*
