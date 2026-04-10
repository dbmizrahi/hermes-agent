# Integration Plan & Architecture Design

## MCC Frontend → Hermes Agent API Integration

**Date:** 2026-04-10
**Target API:** `gateway/platforms/api_server.py` (port 8642)
**Source Frontend:** `web/` (React 18 + Vite + Tailwind + ShadCN)
**Current Backend:** MCC on port 8082 (to be bypassed)

---

## 1. Executive Summary

The `web/` frontend currently expects an MCC backend (port 8082) with MongoDB. This backend must be bypassed in favor of the Hermes Agent API (port 8642), which exposes an `aiohttp` server with JWT authentication, session management, memory, skills, cron, tools, MCP, gateway/platform management, and real-time communication via SSE and WebSocket.

**Key Finding:** The current frontend uses a wrapper response format (`{status: "ok" | "error", data?: T, error?: {...}}`) and paginated responses (`{items: T[], total, page, page_size, total_pages}`). The Hermes API returns raw JSON responses directly (e.g., `{sessions: [...], total, limit, offset}`), NOT wrapped in a `status/data` envelope. The `api.ts` client helpers must be rewritten.

**Key Finding:** Several frontend pages reference API endpoints that do NOT exist on the Hermes API server. These pages need either backend extensions or UI adaptation.

---

## 2. Complete API Endpoint Inventory

### 2.1 Hermes API Server Endpoints (port 8642)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/token` | No | Exchange API key for JWT (access + refresh) |
| POST | `/api/auth/refresh` | No | Refresh token rotation |
| POST | `/api/auth/revoke` | Yes | Revoke refresh token |
| GET | `/health` | No | Health check |
| GET | `/v1/models` | Yes | List models (returns hermes-agent) |
| POST | `/v1/chat/completions` | Yes | OpenAI-compatible chat (streaming + non-streaming) |
| POST | `/v1/responses` | Yes | OpenAI Responses API format |
| GET | `/v1/responses/{id}` | Yes | Retrieve stored response |
| DELETE | `/v1/responses/{id}` | Yes | Delete stored response |
| POST | `/v1/runs` | Yes | Start async agent run, returns run_id |
| GET | `/v1/runs/{run_id}/events` | Yes | SSE stream of agent lifecycle events |
| GET | `/api/sessions` | Yes | List sessions (paginated: limit, offset, source) |
| GET | `/api/sessions/search` | Yes | Search sessions (?q=, ?limit=, ?source=) |
| GET | `/api/sessions/{id}` | Yes | Get session + messages |
| DELETE | `/api/sessions/{id}` | Yes | Delete session |
| GET | `/api/sessions/{id}/export` | Yes | Export session as NDJSON |
| PATCH | `/api/sessions/{id}` | Yes | Rename session (body: {title}) |
| GET | `/api/config` | Yes | Get redacted config |
| PATCH | `/api/config` | Yes | Update config (dot-notation) |
| GET | `/api/memory` | Yes | Get memory + user entries |
| PATCH | `/api/memory` | Yes | Add/replace/remove memory entries |
| DELETE | `/api/memory/entry` | Yes | Remove memory entry |
| GET | `/api/skills` | Yes | List skills (?category=) |
| GET | `/api/skills/{name}` | Yes | Get skill details |
| POST | `/api/skills/install` | Yes | Install skill from hub |
| POST | `/api/skills/check` | Yes | Check for skill updates |
| POST | `/api/skills/update` | Yes | Update skills |
| DELETE | `/api/skills/{name}` | Yes | Delete skill |
| GET | `/api/jobs` | Yes | List cron jobs (?include_disabled=) |
| POST | `/api/jobs` | Yes | Create cron job |
| GET | `/api/jobs/{id}` | Yes | Get cron job |
| PATCH | `/api/jobs/{id}` | Yes | Update cron job |
| DELETE | `/api/jobs/{id}` | Yes | Delete cron job |
| POST | `/api/jobs/{id}/pause` | Yes | Pause job |
| POST | `/api/jobs/{id}/resume` | Yes | Resume job |
| POST | `/api/jobs/{id}/run` | Yes | Trigger job |
| GET | `/api/jobs/output` | Yes | List all run outputs |
| GET | `/api/jobs/{id}/history` | Yes | Job run history |
| GET | `/api/jobs/{id}/output/{run_id}` | Yes | Get run output |
| GET | `/api/gateway/status` | Yes | Gateway status + platform info |
| GET | `/api/gateway/platforms` | Yes | List platforms |
| POST | `/api/gateway/platforms` | Yes | Add platform |
| POST | `/api/gateway/platforms/{name}/connect` | Yes | Connect platform |
| POST | `/api/gateway/platforms/{name}/disconnect` | Yes | Disconnect platform |
| PATCH | `/api/gateway/platforms/{name}` | Yes | Update platform config |
| DELETE | `/api/gateway/platforms/{name}` | Yes | Remove platform |
| GET | `/api/tools` | Yes | List tools (?toolset=, ?enabled=) |
| PATCH | `/api/tools/{name}` | Yes | Enable/disable tool |
| GET | `/api/tools/toolsets` | Yes | List toolsets |
| PATCH | `/api/tools/toolsets/{name}` | Yes | Enable/disable toolset |
| GET | `/api/mcp` | Yes | List MCP servers |
| POST | `/api/mcp` | Yes | Add MCP server |
| POST | `/api/mcp/{name}/reload` | Yes | Reload MCP server |
| PATCH | `/api/mcp/{name}` | Yes | Update MCP server |
| DELETE | `/api/mcp/{name}` | Yes | Delete MCP server |
| GET | `/ws/agent` | API key | WebSocket agent communication |

### 2.2 Frontend Expected Endpoints (current `web/` code)

| Page | Expected Endpoint | Maps To | Status |
|------|------------------|---------|--------|
| Dashboard | `GET /api/health` | `GET /health` | Renamed path |
| Dashboard | `GET /api/hermes/agents` | **NOT EXISTS** | Needs extension |
| Agents | `GET /api/hermes/agents` | **NOT EXISTS** | Needs extension |
| Agents | `POST /api/hermes/agent/spawn` | **NOT EXISTS** | Needs extension |
| Agents | `POST /api/hermes/agent/{id}/{action}` | **NOT EXISTS** | Needs extension |
| Agent Detail | `GET /api/hermes/agent/{id}` | **NOT EXISTS** | Needs extension |
| Agent Detail | `POST /api/hermes/agent/{id}/send-message` | `POST /v1/runs` | Re-map |
| Agent Detail | `GET /api/hermes/agent/{id}/response/{sessionId}` | **NOT EXISTS** | Use SSE |
| Terminal | `POST /api/hermes/terminal/session` | `GET /ws/agent` | Re-map |
| Terminal | `WS /ws/terminal/{sessionId}` | `GET /ws/agent` | Re-map |
| Files | `GET /api/files/tree` | **NOT EXISTS** | Needs extension |
| Files | `GET /api/files/read` | **NOT EXISTS** | Needs extension |
| Files | `POST /api/files/write` | **NOT EXISTS** | Needs extension |
| Files | `POST /api/files/search` | **NOT EXISTS** | Needs extension |
| Chat | `GET /api/chat/sessions` | `GET /api/sessions` | Re-map |
| Chat | `POST /api/chat/session` | **NOT EXISTS** | Create via sessions |
| Chat | `POST /api/chat/session/{id}/delete` | `DELETE /api/sessions/{id}` | Re-map |
| Chat | `GET /api/chat/session/{id}/messages` | `GET /api/sessions/{id}` | Re-map |
| Chat | `WS /ws/chat/session/{id}` | `GET /ws/agent` | Re-map |
| Memory | `GET /api/hermes/memory/{target}` | `GET /api/memory` | Re-map |
| Memory | `POST /api/hermes/memory` | `PATCH /api/memory` | Re-map |
| Memory | `PUT /api/hermes/memory` | `PATCH /api/memory` | Re-map |
| Memory | `DELETE /api/hermes/memory` | `DELETE /api/memory/entry` | Re-map |
| Skills | `GET /api/hermes/skills` | `GET /api/skills` | Renamed path |
| Skills | `POST /api/hermes/skills` | `POST /api/skills/install` | Different semantics |
| Skills | `DELETE /api/hermes/skills/{name}` | `DELETE /api/skills/{name}` | Renamed path |
| Sessions | `GET /api/hermes/sessions` | `GET /api/sessions` | Renamed path |
| Sessions | `GET /api/hermes/sessions/search` | `GET /api/sessions/search` | Renamed path |
| Sessions | `GET /api/hermes/sessions/{id}` | `GET /api/sessions/{id}` | Renamed path |
| Cron | `GET /api/hermes/cron` | `GET /api/jobs` | Renamed path |
| Cron | `POST /api/hermes/cron` | `POST /api/jobs` | Renamed path |
| Cron | `POST /api/hermes/cron/{id}/{action}` | `POST /api/jobs/{id}/{action}` | Renamed path |
| Cron | `DELETE /api/hermes/cron/{id}` | `DELETE /api/jobs/{id}` | Renamed path |
| Gateway | `GET /api/gateway/status` | `GET /api/gateway/status` | Direct match |
| Gateway | `GET /api/gateway/metrics` | **NOT EXISTS** | Partial via status |
| Gateway | `POST /api/gateway/reload` | **NOT EXISTS** | Needs extension |
| Gateway | `POST /api/gateway/restart` | **NOT EXISTS** | Needs extension |
| Channels | `GET /api/channels` | `GET /api/gateway/platforms` | Re-map |
| Channels | `POST /api/channels` | `POST /api/gateway/platforms` | Re-map |
| Channels | `POST /api/channels/{id}/test` | `POST /api/gateway/platforms/{name}/connect` | Re-map |
| Channels | `DELETE /api/channels/{id}` | `DELETE /api/gateway/platforms/{name}` | Re-map |
| Models | `GET /api/models/providers` | **NOT EXISTS** | Needs extension |
| Models | `GET /api/models` | `GET /v1/models` | Partial (only hermes-agent) |
| Models | `GET /api/models/cost` | **NOT EXISTS** | Needs extension |
| Models | `PUT /api/models/default` | `PATCH /api/config` | Via config |
| MCP | `GET /api/mcp/servers` | `GET /api/mcp` | Renamed path |
| MCP | `POST /api/mcp/servers` | `POST /api/mcp` | Renamed path |
| MCP | `POST /api/mcp/servers/{id}/{action}` | `POST /api/mcp/{name}/reload` | Renamed |
| MCP | `DELETE /api/mcp/servers/{id}` | `DELETE /api/mcp/{name}` | Renamed path |
| ACP | `GET /api/acp/topology` | **NOT EXISTS** | Needs extension |
| ACP | `GET /api/acp/queues` | **NOT EXISTS** | Needs extension |
| Env | `GET /api/env` | **NOT EXISTS** | Needs extension |
| Env | `POST /api/env` | **NOT EXISTS** | Needs extension |
| Env | `DELETE /api/env/{key}` | **NOT EXISTS** | Needs extension |
| Env | `POST /api/env/{key}/rotate` | **NOT EXISTS** | Needs extension |
| Network | `GET /api/network/hosts` | **NOT EXISTS** | Needs extension |
| Network | `GET /api/network/services` | **NOT EXISTS** | Needs extension |
| Virtual Office | `GET /api/virtual-office/workspaces` | **NOT EXISTS** | Needs extension |
| Virtual Office | `GET /api/virtual-office/{id}/agents` | **NOT EXISTS** | Needs extension |
| Virtual Office | `WS /ws/virtual-office/{id}` | **NOT EXISTS** | Needs extension |
| Task Board | `GET /api/tasks/boards` | **NOT EXISTS** | Needs extension |
| Task Board | `POST /api/tasks/boards` | **NOT EXISTS** | Needs extension |
| Task Board | `GET /api/tasks/boards/{id}/tasks` | **NOT EXISTS** | Needs extension |
| Task Board | `POST /api/tasks/boards/{id}/tasks` | **NOT EXISTS** | Needs extension |
| Task Board | `POST /api/tasks/boards/{id}/tasks/{id}/move` | **NOT EXISTS** | Needs extension |
| Teams | `GET /api/teams` | **NOT EXISTS** | Needs extension |
| Teams | `POST /api/teams` | **NOT EXISTS** | Needs extension |
| Teams | `GET /api/teams/{id}/metrics` | **NOT EXISTS** | Needs extension |
| Teams | `POST /api/teams/{id}/assign` | **NOT EXISTS** | Needs extension |
| Teams | `DELETE /api/teams/{id}/assign/{id}` | **NOT EXISTS** | Needs extension |
| Logs | `WS /ws/logs` | **NOT EXISTS** | Needs extension |

---

## 3. Authentication Flow

### 3.1 Current State
The frontend has NO authentication mechanism. It sends unauthenticated requests to the MCC backend.

### 3.2 Target State — JWT-Based Auth
The Hermes API server supports JWT authentication:

1. **Token Exchange** (`POST /api/auth/token`):
   - Body: `{ "api_key": "<configured_api_key>" }`
   - Response: `{ "access_token": "...", "refresh_token": "...", "expires_in": 3600, "token_type": "Bearer" }`
   - Access tokens expire in 1 hour; refresh tokens expire in 30 days

2. **Token Refresh** (`POST /api/auth/refresh`):
   - Body: `{ "refresh_token": "..." }`
   - Response: New access + refresh token pair (rotation)

3. **Token Revocation** (`POST /api/auth/revoke`):
   - Requires valid access token in Authorization header
   - Body: `{ "refresh_token": "..." }`

### 3.3 Implementation

```
src/api/auth.ts
├── login(apiKey: string) → { access, refresh }
├── refresh(refreshToken: string) → { access, refresh }
├── revoke(refreshToken: string) → void
├── getToken() → string | null
├── setTokens(access, refresh) → void
├── clearTokens() → void
└── isAuthenticated() → boolean
```

Storage: Use `localStorage` for tokens (acceptable for single-user local tool; upgrade to httpOnly cookies if multi-user deployment).

The API client interceptors will:
- Attach `Authorization: Bearer <access_token>` to every request
- On 401, attempt token refresh, retry the original request
- On refresh failure, redirect to login screen

### 3.4 API Key Configuration
The API key is configured in `~/.hermes/config.yaml` under `platforms.api_server.key`. The frontend needs an `.env` variable `VITE_HERMES_API_KEY` for initial login, or a settings page to input it.

---

## 4. Response Format Incompatibility

### 4.1 Current Frontend Format (MCC)
```typescript
interface ApiResponse<T> {
  status: 'ok' | 'error';
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
```

### 4.2 Hermes API Format
The Hermes API returns raw JSON directly:
- Success: `{ sessions: [...], total: 20, limit: 20, offset: 0 }`
- Error: `{ error: { message: "...", type: "...", code: "..." } }` (OpenAI-style)

### 4.3 Solution
Rewrite `src/config/api.ts` to handle the Hermes response format directly. The wrapper pattern must be removed. Error handling must check for `response.error` object instead of `response.status === 'error'`.

---

## 5. Proposed Frontend Folder Structure

```
web/src/
├── api/                          # NEW: API service layer
│   ├── client.ts                 # Base HTTP client with auth interceptors
│   ├── auth.ts                   # Auth service (login, refresh, token management)
│   ├── sessions.ts               # Sessions API (list, get, delete, search, rename, export)
│   ├── memory.ts                 # Memory API (get, add, replace, remove)
│   ├── skills.ts                 # Skills API (list, get, install, update, delete)
│   ├── jobs.ts                   # Cron jobs API (CRUD, pause, resume, run, history, output)
│   ├── gateway.ts                # Gateway API (status, platforms CRUD)
│   ├── tools.ts                  # Tools API (list, enable/disable, toolsets)
│   ├── mcp.ts                    # MCP servers API (CRUD, reload)
│   ├── runs.ts                   # Agent runs API (start run, SSE events)
│   ├── config.ts                 # Config API (get, patch)
│   └── chat.ts                   # Chat completions API (OpenAI-compatible)
├── config/
│   └── api.ts                    # EXISTING: rewrite to use new client
├── hooks/
│   ├── useAuth.ts                # NEW: auth state hook
│   ├── use-toast.ts              # EXISTING
│   └── use-mobile.tsx            # EXISTING
├── lib/
│   ├── websocket.ts              # EXISTING: update for auth + new endpoints
│   ├── sse.ts                    # NEW: SSE event stream manager for /v1/runs/{id}/events
│   └── utils.ts                  # EXISTING
├── types/
│   └── index.ts                  # EXISTING: update to match Hermes API types
├── pages/                        # EXISTING: update page components
├── components/                   # EXISTING: UI components (no changes needed)
└── App.tsx                       # EXISTING: add auth guard
```

---

## 6. API Mapping Detail

### 6.1 Direct Renames (path change only)

| Frontend Call | Hermes Endpoint | Notes |
|---|---|---|
| `GET /api/hermes/sessions` | `GET /api/sessions` | Paginated differently (limit/offset vs page) |
| `GET /api/hermes/sessions/search` | `GET /api/sessions/search` | Param `q` instead of `query` |
| `GET /api/hermes/sessions/{id}` | `GET /api/sessions/{id}` | Response: `{session, messages}` |
| `GET /api/hermes/skills` | `GET /api/skills` | Response: `{skills, total}` |
| `DELETE /api/hermes/skills/{name}` | `DELETE /api/skills/{name}` | Direct |
| `GET /api/hermes/cron` | `GET /api/jobs` | Response: `{jobs}` |
| `POST /api/hermes/cron` | `POST /api/jobs` | Fields: name, schedule, prompt, deliver |
| `POST /api/hermes/cron/{id}/pause` | `POST /api/jobs/{id}/pause` | Direct |
| `POST /api/hermes/cron/{id}/resume` | `POST /api/jobs/{id}/resume` | Direct |
| `POST /api/hermes/cron/{id}/run` | `POST /api/jobs/{id}/run` | Direct |
| `DELETE /api/hermes/cron/{id}` | `DELETE /api/jobs/{id}` | Direct |
| `GET /api/gateway/status` | `GET /api/gateway/status` | Direct match |
| `GET /api/channels` | `GET /api/gateway/platforms` | Response: `{platforms}` |
| `POST /api/channels` | `POST /api/gateway/platforms` | Fields: name, type, config |
| `DELETE /api/channels/{id}` | `DELETE /api/gateway/platforms/{name}` | Use name, not id |
| `GET /api/mcp/servers` | `GET /api/mcp` | Response: `{servers}` |
| `POST /api/mcp/servers` | `POST /api/mcp` | Fields: name, command, args, url, etc. |
| `DELETE /api/mcp/servers/{id}` | `DELETE /api/mcp/{name}` | Use name, not id |
| `GET /api/health` | `GET /health` | Direct |

### 6.2 Re-mapped Endpoints (different semantics)

| Frontend Call | Hermes Endpoint | Adaptation Required |
|---|---|---|
| `POST /api/hermes/agent/{id}/send-message` | `POST /v1/runs` | Send input, get run_id, subscribe to SSE |
| `GET /api/hermes/agent/{id}/response/{sessionId}` | `GET /v1/runs/{run_id}/events` | Use SSE stream instead of polling |
| `GET /api/chat/sessions` | `GET /api/sessions` | Transform response format |
| `POST /api/chat/session` | No direct | Use `POST /v1/chat/completions` with new session_id, or create session via SessionDB indirectly |
| `GET /api/chat/session/{id}/messages` | `GET /api/sessions/{id}` | Response: `{session, messages}` |
| `DELETE /api/chat/session/{id}/delete` | `DELETE /api/sessions/{id}` | Direct |
| `WS /ws/chat/session/{id}` | `GET /ws/agent` | Different protocol — use SSE runs instead |
| `GET /api/hermes/memory/{target}` | `GET /api/memory` | Response: `{memory: {entries,...}, user: {entries,...}}` |
| `POST /api/hermes/memory` | `PATCH /api/memory` | Body: `{target, action: "add", content}` |
| `PUT /api/hermes/memory` | `PATCH /api/memory` | Body: `{target, action: "replace", content, old_text}` |
| `DELETE /api/hermes/memory` | `DELETE /api/memory/entry` | Body: `{target, action: "remove", old_text}` |
| `POST /api/models/default` | `PATCH /api/config` | Update `model` in config |
| `GET /api/models` | `GET /v1/models` | Only returns hermes-agent — limited utility |

### 6.3 Endpoints Requiring Backend Extensions

These frontend pages reference endpoints with NO equivalent in the Hermes API:

| Page | Missing Endpoints | Recommendation |
|---|---|---|
| **Agents** | `/api/hermes/agents`, `/api/hermes/agent/{id}`, spawn, pause, resume, restart, terminate | The Hermes API server does NOT manage a pool of agents. Each request creates a transient AIAgent. **Phase 1:** Hide or repurpose this page. **Phase 2:** Add agent pool management to api_server.py |
| **Agent Detail** | `/api/hermes/agent/{id}`, `/api/hermes/agent/{id}/{action}`, `/api/hermes/agent/{id}/send-message` | Same as Agents page |
| **Terminal** | `/api/hermes/terminal/session`, `WS /ws/terminal/{sessionId}` | Hermes API does not have terminal session management. **Phase 1:** Use `GET /ws/agent` for chat. **Phase 2:** Add terminal API endpoint |
| **Files** | `/api/files/tree`, `/api/files/read`, `/api/files/write`, `/api/files/search` | Hermes API does not expose file system. **Phase 1:** Hide this page. **Phase 2:** Add file API using existing tools (file_tools.py) |
| **Models** | `/api/models/providers`, `/api/models/cost` | Only `GET /v1/models` exists (returns hermes-agent). **Phase 1:** Show limited model info. **Phase 2:** Add model provider enumeration |
| **ACP** | `/api/acp/topology`, `/api/acp/queues` | ACP is a separate component (acp_adapter/). **Phase 1:** Hide page. **Phase 2:** Add ACP endpoints to api_server.py |
| **Env & Secrets** | `/api/env` CRUD | **Phase 1:** Hide page. **Phase 2:** Add env var management API |
| **Network** | `/api/network/hosts`, `/api/network/services` | **Phase 1:** Hide page. **Phase 2:** Add LAN discovery API |
| **Virtual Office** | `/api/virtual-office/workspaces`, `/api/virtual-office/{id}/agents` | **Phase 1:** Hide page. **Phase 2:** Implement workspace concept |
| **Task Board** | `/api/tasks/boards`, `/api/tasks/boards/{id}/tasks` | **Phase 1:** Hide page. **Phase 2:** Implement task management |
| **Teams** | `/api/teams`, `/api/teams/{id}/metrics`, `/api/teams/{id}/assign` | **Phase 1:** Hide page. **Phase 2:** Implement team management |
| **Logs** | `WS /ws/logs` | **Phase 1:** Remove real-time logs. **Phase 2:** Add log streaming endpoint |
| **Gateway** | `/api/gateway/metrics`, `/api/gateway/reload`, `/api/gateway/restart` | Gateway status exists; metrics/reload/restart do not. **Phase 1:** Show available data only |

---

## 7. Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

**Step 1: Update API Client (`src/config/api.ts`)**
- Remove `{status, data, error}` wrapper pattern
- Handle Hermes API response format directly
- Add Authorization header interceptor
- Add token refresh on 401
- Handle OpenAI-style error responses

**Step 2: Create Auth Service (`src/api/auth.ts`)**
- Implement login, refresh, revoke
- Token storage in localStorage
- Create `useAuth` hook
- Add login/settings UI component

**Step 3: Create Service Layer (`src/api/`)**
- `sessions.ts`: list, get, search, delete, rename, export
- `memory.ts`: get, add, replace, remove
- `skills.ts`: list, get, install, update, delete
- `jobs.ts`: list, create, update, delete, pause, resume, run, history, output
- `gateway.ts`: status, platforms (list, add, connect, disconnect, update, remove)
- `tools.ts`: list, enable/disable, toolsets
- `mcp.ts`: list, add, update, delete, reload
- `runs.ts`: start run, SSE event subscription
- `config.ts`: get, patch
- `chat.ts`: OpenAI-compatible chat completions

**Step 4: Create SSE Manager (`src/lib/sse.ts`)**
- Manage SSE connections to `/v1/runs/{run_id}/events`
- Handle reconnection, event parsing
- Event types: `tool.started`, `tool.completed`, `reasoning.available`, `message.delta`, `run.completed`, `run.failed`

**Step 5: Update WebSocket Manager (`src/lib/websocket.ts`)**
- Update to work with `GET /ws/agent` endpoint
- Add token authentication to WS connections

**Step 6: Update Type Definitions (`src/types/index.ts`)**
- Align types with Hermes API response shapes
- Add new types: Session, Run, RunEvent, Platform, Tool, Toolset, MCPServer, CronJob, MemoryStore

### Phase 2: Page Migrations (Week 2)

**Step 7: Dashboard Page**
- `GET /health` for system health
- Replace agent summary with session statistics from `GET /api/sessions`
- Show gateway status from `GET /api/gateway/status`

**Step 8: Sessions Page**
- Map to `GET /api/sessions`, `GET /api/sessions/search`, `GET /api/sessions/{id}`
- Adapt response format: `{sessions, total, limit, offset}` instead of flat array
- Add session rename, delete, export

**Step 9: Memory Page**
- Map to `GET /api/memory`, `PATCH /api/memory`, `DELETE /api/memory/entry`
- Response shape: `{memory: {entries, char_count, char_limit, usage_pct}, user: {...}}`
- Map actions: add → `{action: "add"}`, replace → `{action: "replace"}`, remove → `{action: "remove"}`

**Step 10: Skills Page**
- Map to `GET /api/skills`, `DELETE /api/skills/{name}`
- Add skill install from hub: `POST /api/skills/install`
- Add skill update: `POST /api/skills/update`
- Remove "create skill" (use install from hub instead)

**Step 11: Cron Page**
- Map to `GET /api/jobs`, `POST /api/jobs`, `DELETE /api/jobs/{id}`
- Map actions: pause → `POST /api/jobs/{id}/pause`, resume → `POST /api/jobs/{id}/resume`, run → `POST /api/jobs/{id}/run`
- Add job history and output viewing

**Step 12: Gateway Page**
- Map to `GET /api/gateway/status`, `GET /api/gateway/platforms`
- Add platform management: connect, disconnect, add, update, remove
- Remove metrics/reload/restart buttons (not available)

**Step 13: Channels Page**
- Map to `GET /api/gateway/platforms`, `POST /api/gateway/platforms`
- Platform name used as channel ID
- Test connection → `POST /api/gateway/platforms/{name}/connect`

**Step 14: MCP Page**
- Map to `GET /api/mcp`, `POST /api/mcp`, `PATCH /api/mcp/{name}`, `DELETE /api/mcp/{name}`
- Reload → `POST /api/mcp/{name}/reload`

**Step 15: Chat Page**
- Sessions: `GET /api/sessions` with source filter
- Messages: `GET /api/sessions/{id}` returns `{session, messages}`
- Sending messages: Use `POST /v1/chat/completions` (streaming) or `POST /v1/runs` + SSE
- WebSocket: Replace with SSE event streams from runs API

### Phase 3: Conditional Pages (Week 3)

**Step 16: Hide/Disable Phase 1 pages**
- Agents, Agent Detail, Terminal, Files, Models, ACP, Env, Network, Virtual Office, Task Board, Teams
- Either remove from sidebar or show "Coming Soon" placeholder
- Update `AppSidebar.tsx` navigation groups

**Step 17: Update Vite Config**
- Change proxy target from `http://localhost:8082` to `http://localhost:8642`
- Update CORS configuration in api_server.py to allow `http://localhost:8080`

**Step 18: Environment Configuration**
- Add `VITE_HERMES_API_KEY` to `.env`
- Create `.env.example` with template
- Create settings page for API key management

### Phase 4: Testing & Polish (Week 4)

**Step 19: Integration Testing**
- Test all migrated pages against running Hermes API
- Verify auth flow (login, refresh, token expiry)
- Test SSE event streaming for chat/runs
- Verify error handling

**Step 20: Update Tests**
- Update Vitest tests for new API response formats
- Update Playwright E2E tests

---

## 8. Authentication Flow Diagram

```
Frontend                    Hermes API (8642)
   |                             |
   |-- POST /api/auth/token ---->|
   |   { api_key: "xxx" }        |
   |<-- { access, refresh } -----|
   |   Store in localStorage     |
   |                             |
   |-- GET /api/sessions ------->|
   |   Authorization: Bearer <access_token>
   |<-- { sessions: [...] } -----|
   |                             |
   |-- (access token expires)    |
   |-- POST /api/auth/refresh -->|
   |   { refresh_token }         |
   |<-- { new_access, new_refresh }|
   |   Update localStorage       |
   |                             |
   |-- GET /api/sessions ------->|
   |   Authorization: Bearer <new_access>
   |<-- { sessions: [...] } -----|
```

---

## 9. Key Technical Decisions

1. **Auth Storage**: localStorage for tokens (single-user local tool). If multi-user deployment needed, switch to httpOnly cookies + CSRF protection.

2. **Real-time Communication**: Use SSE (`/v1/runs/{id}/events`) for agent run events instead of WebSocket for chat. The WebSocket endpoint (`/ws/agent`) remains available for simple use cases but SSE is preferred for structured events.

3. **Response Format**: Rewrite the API client to handle raw Hermes responses directly. Do NOT add a wrapper layer on the server — keep the API server unchanged.

4. **Page Strategy**: Phase 1 hides pages that have no backend support. Phase 2 can add backend endpoints to `api_server.py` as needed.

5. **Chat Implementation**: The Chat page should use `POST /v1/chat/completions` with `stream: true` for real-time streaming, falling back to non-streaming for simplicity. Session continuity uses `X-Hermes-Session-Id` header.

6. **CORS Configuration**: The api_server.py must have `cors_origins` configured to include the Vite dev server URL (`http://localhost:8080`) and production URL.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No agent pool management | Agents page unusable | Hide in Phase 1, implement in Phase 2 |
| No file system API | Files page unusable | Hide in Phase 1, use tool-based API in Phase 2 |
| No terminal sessions | Terminal page unusable | Hide in Phase 1, use chat-based terminal in Phase 2 |
| WebSocket protocol mismatch | Chat WS won't work | Use SSE runs API instead |
| Response format mismatch | All API calls fail | Rewrite api.ts client first |
| Token expiry during use | API calls fail silently | Auto-refresh interceptor with retry |
| CORS blocking | Dev server can't reach API | Configure cors_origins in config.yaml |

---

## 11. Files to Create

```
web/src/api/client.ts          - Base HTTP client with auth
web/src/api/auth.ts            - Auth service
web/src/api/sessions.ts        - Sessions API
web/src/api/memory.ts          - Memory API
web/src/api/skills.ts          - Skills API
web/src/api/jobs.ts            - Cron jobs API
web/src/api/gateway.ts         - Gateway/platforms API
web/src/api/tools.ts           - Tools API
web/src/api/mcp.ts             - MCP servers API
web/src/api/runs.ts            - Agent runs API
web/src/api/config.ts          - Config API
web/src/api/chat.ts            - Chat completions API
web/src/lib/sse.ts             - SSE event stream manager
web/src/hooks/useAuth.ts       - Auth state hook
web/.env.example               - Environment template
```

## 12. Files to Modify

```
web/src/config/api.ts          - Rewrite for Hermes response format
web/src/lib/websocket.ts       - Update for auth + /ws/agent
web/src/types/index.ts         - Update type definitions
web/src/App.tsx                - Add auth guard
web/src/components/layout/AppSidebar.tsx - Hide unsupported pages
web/vite.config.ts             - Change proxy target to 8642
web/src/pages/*.tsx            - Update all page components (18 files)
```
