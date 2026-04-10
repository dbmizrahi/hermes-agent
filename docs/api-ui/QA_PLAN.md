# QA Plan: Hermes Agent Web Integration

**Date:** 2026-04-10
**Scope:** MCC Frontend → Hermes Agent API (port 8642)
**References:** `docs/api-ui/INTEGRATION_PLAN.md`, `docs/api-ui/REVIEWER_FEEDBACK.md`

---

## Test Execution Order

Tests are organized into 5 suites. Execute in order:

1. **Suite A — Critical Pre-flight Checks** (must pass before any UI testing)
2. **Suite B — Critical Bug Verification** (verify reviewer findings are fixed)
3. **Suite C — Authentication & Security**
4. **Suite D — Integration & End-to-End Flows**
5. **Suite E — UI/UX Validation**
6. **Suite F — Regression**
7. **Suite G — Edge Cases & Error Handling**

---

## Suite A: Critical Pre-flight Checks

*These must pass before any browser-based testing begins. They verify the backend is ready for frontend integration.*

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| A1 | API Server Running | `curl http://localhost:8642/health` | `{"status": "ok", "platform": "hermes-agent"}` | ☐ |
| A2 | CORS Headers Include PATCH | `curl -X OPTIONS http://localhost:8642/api/sessions/test -H "Origin: http://localhost:8080" -H "Access-Control-Request-Method: PATCH" -v` | Response includes `Access-Control-Allow-Methods` containing `PATCH`; status 200 | ☐ |
| A3 | CORS Headers Include X-Hermes-Session-Id in Expose | Inspect `_CORS_HEADERS` in `api_server.py` | `Access-Control-Expose-Headers` includes `X-Hermes-Session-Id` | ☐ |
| A4 | Vite Dev Server Proxy | `grep -r "8642" vite.config.ts` | Proxy target is `http://localhost:8642` | ☐ |
| A5 | API Key Configured | `grep "api_server" ~/.hermes/config.yaml` | `key` field is set and non-empty | ☐ |

---

## Suite B: Critical Bug Verification

*Tests to verify each Critical issue from REVIEWER_FEEDBACK.md has been resolved.*

### B1 — C1: CORS PATCH Requests

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| B1.1 | PATCH /api/sessions/{id} from browser | Frontend sends `PATCH /api/sessions/{id}` with `{title: "New Name"}` | HTTP 200, session renamed, no CORS error in browser console | ☐ |
| B1.2 | PATCH /api/config from browser | Frontend sends `PATCH /api/config` with dot-notation body | HTTP 200, config updated, no CORS error | ☐ |
| B1.3 | PATCH /api/memory from browser | Frontend sends `PATCH /api/memory` with `{action: "add", content: "test"}` | HTTP 200, memory entry added, no CORS error | ☐ |
| B1.4 | PATCH /api/tools/{name} from browser | Frontend sends `PATCH /api/tools/{name}` with `{enabled: false}` | HTTP 200, tool disabled, no CORS error | ☐ |
| B1.5 | PATCH /api/mcp/{name} from browser | Frontend sends `PATCH /api/mcp/{name}` with updated config | HTTP 200, MCP server updated, no CORS error | ☐ |
| B1.6 | PATCH /api/gateway/platforms/{name} from browser | Frontend sends `PATCH /api/gateway/platforms/{name}` | HTTP 200, platform updated, no CORS error | ☐ |

### B2 — C2: WebSocket JWT Authentication

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| B2.1 | WS accepts JWT token | Connect `ws://localhost:8642/ws/agent?token=<JWT_ACCESS_TOKEN>` | Connection established (101 Switching Protocols), no auth rejection | ☐ |
| B2.2 | WS rejects invalid JWT | Connect `ws://localhost:8642/ws/agent?token=invalid.jwt.token` | Connection rejected (401 or close frame with error) | ☐ |
| B2.3 | WS rejects expired JWT | Connect with an expired JWT token | Connection rejected, frontend redirects to login | ☐ |
| B2.4 | WS still accepts raw API key (backward compat) | Connect `ws://localhost:8642/ws/agent?token=<RAW_API_KEY>` | Connection established (if backward compat is kept) | ☐ |

### B3 — C3: SQLite Concurrency Under Load

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| B3.1 | Concurrent PATCH requests | Send 5 simultaneous `PATCH /api/sessions/{id}` requests | All succeed (HTTP 200), no `database is locked` errors | ☐ |
| B3.2 | Concurrent auth + session ops | Login (POST /api/auth/token) while simultaneously listing sessions (GET /api/sessions) | Both succeed, no errors | ☐ |
| B3.3 | Concurrent memory writes | Send 3 simultaneous `PATCH /api/memory` with different entries | All succeed, all entries present on subsequent GET | ☐ |
| B3.4 | API server stability after concurrency | After all concurrent tests, `curl http://localhost:8642/health` | Returns healthy, no crashed handlers | ☐ |

### B4 — C4: Session Creation Endpoint

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| B4.1 | POST /api/sessions exists | `curl -X POST http://localhost:8642/api/sessions -H "Authorization: Bearer ***" -H "Content-Type: application/json" -d '{"title": "Test Session"}'` | HTTP 200/201, returns `{session_id: "..."}` or session object | ☐ |
| B4.2 | Chat page creates session | In UI: click "New Chat" or equivalent | Session created, session_id available, can send messages into it | ☐ |
| B4.3 | Session appears in list | After B4.2, navigate to Sessions page | New session is visible in the list with correct title | ☐ |
| B4.4 | Session created via chat completions | Send message via `POST /v1/chat/completions` with `X-Hermes-Session-Id` header | Response includes session_id in JSON body (or `Access-Control-Expose-Headers` includes `X-Hermes-Session-Id`) | ☐ |

---

## Suite C: Authentication & Security

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| C1 | Login with valid API key | Enter API key in login/settings UI | Returns access_token + refresh_token, stored in localStorage, redirected to dashboard | ☐ |
| C2 | Login with invalid API key | Enter wrong API key | HTTP 401, error message shown, no tokens stored | ☐ |
| C3 | Authenticated API call | After login, call any protected endpoint (e.g., GET /api/sessions) | HTTP 200, Authorization: Bearer header attached | ☐ |
| C4 | Unauthenticated API call | Call protected endpoint without token | HTTP 401, redirect to login screen | ☐ |
| C5 | Token refresh on expiry | Wait for access token to expire (or manually set expired token), then make API call | Client detects 401, calls POST /api/auth/refresh, retries original request with new token | ☐ |
| C6 | Refresh token rotation | After refresh, verify both access_token and refresh_token are new values | Both tokens differ from pre-refresh values | ☐ |
| C7 | Token revocation (logout) | Call logout/revoke | refresh_token invalidated, localStorage cleared, redirected to login | ☐ |
| C8 | Revoked token cannot refresh | After logout, attempt POST /api/auth/refresh with old refresh_token | HTTP 401 | ☐ |
| C9 | Interceptor attaches Bearer header | Inspect network tab for any API call after login | `Authorization: Bearer <token>` present | ☐ |
| C10 | Login page renders on unauthenticated access | Open app with no tokens in localStorage | Login/settings screen shown, not dashboard | ☐ |
| C11 | JWT secret derivation works | Verify `POST /api/auth/token` with valid key returns decodable JWT | JWT payload contains expected claims, signature valid | ☐ |

---

## Suite D: Integration & End-to-End Flows

### D1: Full Chat Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D1.1 | Login → Create Session → Send Message → Receive Response | 1. Login with API key<br>2. Create new chat session<br>3. Type message and send<br>4. Wait for response | Streaming response appears in chat UI, session saved, no errors | ☐ |
| D1.2 | Multi-turn conversation | After D1.1, send a follow-up message referencing the first message | Context maintained, response references prior message | ☐ |
| D1.3 | Switch sessions | Navigate to a different existing session, then back | Message history loads correctly for each session | ☐ |

### D2: Session Management Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D2.1 | List sessions | Navigate to Sessions page | Paginated list displays, shows session titles | ☐ |
| D2.2 | Search sessions | Enter search query in session search | Filtered results returned matching query | ☐ |
| D2.3 | Rename session | Edit session title | PATCH succeeds, title updated in UI and on refresh | ☐ |
| D2.4 | Delete session | Delete a session | Session removed from list, subsequent GET returns 404 | ☐ |
| D2.5 | Export session | Export session as NDJSON | File downloaded with correct NDJSON format | ☐ |

### D3: Memory Management Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D3.1 | View memory | Navigate to Memory page | Shows `{memory: {...}, user: {...}}` with entries, char_count, char_limit, usage_pct | ☐ |
| D3.2 | Add memory entry | Add new memory entry via UI | Entry appears in memory list, char_count increases | ☐ |
| D3.3 | Replace memory entry | Edit existing entry (replace action) | Old text replaced, new text shown | ☐ |
| D3.4 | Remove memory entry | Delete a memory entry | Entry removed, char_count decreases | ☐ |

### D4: Skills Management Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D4.1 | List skills | Navigate to Skills page | Skills displayed with categories | ☐ |
| D4.2 | Install skill from hub | Install a skill via the hub | Skill appears in installed list | ☐ |
| D4.3 | Delete skill | Delete an installed skill | Skill no longer in list | ☐ |
| D4.4 | Update skills | Run skill update check | Available updates shown, update succeeds | ☐ |

### D5: Cron Jobs Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D5.1 | List jobs | Navigate to Cron page | Jobs displayed with status (active/paused) | ☐ |
| D5.2 | Create job | Create a new cron job with schedule and prompt | Job appears in list | ☐ |
| D5.3 | Pause/Resume job | Toggle job pause state | Status updates correctly | ☐ |
| D5.4 | Trigger job manually | Click "Run Now" on a job | Job executes, output available | ☐ |
| D5.5 | Delete job | Delete a cron job | Job removed from list | ☐ |
| D5.6 | View job history/output | View run history and output for a completed job | History and output displayed | ☐ |

### D6: Gateway & Platforms Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D6.1 | View gateway status | Navigate to Gateway page | Status info displayed (platform, uptime, etc.) | ☐ |
| D6.2 | List platforms/channels | Navigate to Channels page | Platforms listed | ☐ |
| D6.3 | Add platform | Add a new platform (e.g., Telegram) | Platform appears in list | ☐ |
| D6.4 | Connect platform | Test connection to a platform | Connection status shown | ☐ |
| D6.5 | Disconnect platform | Disconnect a connected platform | Status reflects disconnected state | ☐ |
| D6.6 | Remove platform | Delete a platform | Platform no longer in list | ☐ |

### D7: MCP Servers Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D7.1 | List MCP servers | Navigate to MCP page | Servers listed | ☐ |
| D7.2 | Add MCP server | Add a new MCP server configuration | Server appears, status healthy | ☐ |
| D7.3 | Reload MCP server | Reload an MCP server | Server reloaded without error | ☐ |
| D7.4 | Delete MCP server | Remove an MCP server | Server no longer in list | ☐ |

### D8: Tools Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D8.1 | List tools | Navigate to Tools page | Tools listed with enabled/disabled status | ☐ |
| D8.2 | Toggle tool | Enable/disable a tool | Status updates, persists on refresh | ☐ |
| D8.3 | List toolsets | View toolsets | Toolsets displayed | ☐ |
| D8.4 | Toggle toolset | Enable/disable a toolset | All tools in toolset updated | ☐ |

### D9: Dashboard Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| D9.1 | Health check | Dashboard loads | Health status shows "ok" from GET /health | ☐ |
| D9.2 | Session statistics | Dashboard shows session stats | Stats populated from GET /api/sessions | ☐ |
| D9.3 | Gateway status widget | Dashboard shows gateway info | Info from GET /api/gateway/status displayed | ☐ |

---

## Suite E: UI/UX Validation

### E1: Response Format Handling (No Wrapper Object)

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| E1.1 | Sessions list renders | API returns `{sessions: [...], total, limit, offset}` directly | Page renders sessions correctly — NO attempt to unwrap `.data` property | ☐ |
| E1.2 | Skills list renders | API returns `{skills: [...]}` directly | Page renders skills — no `.data.skills` access | ☐ |
| E1.3 | Memory page handles flat response | API returns `{memory: {...}, user: {...}}` at root | Page reads `memory` and `user` keys directly, not nested | ☐ |
| E1.4 | Cron jobs list renders | API returns `{jobs: [...]}` directly | Page renders jobs correctly | ☐ |
| E1.5 | Gateway status renders | API returns gateway object directly | Status fields displayed correctly | ☐ |
| E1.6 | Error responses handled | API returns `{error: {message, type, code}}` | Error displayed to user — no attempt to check `.status === 'error'` | ☐ |

### E2: Pagination Adapter

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| E2.1 | Page number calculation | API returns `{offset: 40, limit: 20, total: 100}` | Frontend computes page=3, page_size=20, total_pages=5 | ☐ |
| E2.2 | Page controls render | Navigate to paginated list with >1 page | Page number buttons, prev/next controls visible and functional | ☐ |
| E2.3 | Pagination navigation | Click "Next" page | offset updated, new page of results loaded | ☐ |
| E2.4 | Empty list handling | API returns `{sessions: [], total: 0}` | "No sessions" or equivalent empty state shown | ☐ |

### E3: SSE Event Streaming

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| E3.1 | SSE connection established | Start an agent run via POST /v1/runs | SSE connection to `/v1/runs/{run_id}/events` opens | ☐ |
| E3.2 | tool.started event | Run includes a tool call | `tool.started` event received and displayed in UI | ☐ |
| E3.3 | tool.completed event | Tool finishes execution | `tool.completed` event received with result | ☐ |
| E3.4 | message.delta event | Agent generates text | Streaming text displayed incrementally in chat | ☐ |
| E3.5 | reasoning.available event | Agent produces reasoning | Reasoning content displayed (collapsible or formatted) | ☐ |
| E3.6 | run.completed event | Run finishes | UI shows "complete" state, input re-enabled | ☐ |
| E3.7 | run.failed event | Run fails (e.g., API error) | Error displayed to user, input re-enabled | ☐ |
| E3.8 | SSE reconnection | Simulate network drop during run | SSE reconnects, events resume (within retry window) | ☐ |
| E3.9 | SSE race condition handling | Subscribe to events immediately after POST /v1/runs | No missed events; retry logic handles subscriber registration delay | ☐ |

### E4: WebSocket One-Shot Lifecycle

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| E4.1 | WS connection opens for message | Send message via WS | New connection opened, message sent | ☐ |
| E4.2 | WS streams response | Agent generates response | Response streamed over WS connection | ☐ |
| E4.3 | WS closes after run completes | Run finishes | Connection closed by server, frontend handles gracefully | ☐ |
| E4.4 | Second message opens new WS | Send follow-up message | New WS connection opened (not reusing closed one) | ☐ |
| E4.5 | WS interrupt works | Click "Stop" during generation | `interrupt` message sent, generation stops | ☐ |

### E5: Phase 1 Pages Hidden/Disabled

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| E5.1 | Agents page hidden | Check sidebar/navigation | Agents page not visible or shows "Coming Soon" | ☐ |
| E5.2 | Files page hidden | Check sidebar/navigation | Files page not visible or shows "Coming Soon" | ☐ |
| E5.3 | Terminal page hidden | Check sidebar/navigation | Terminal page not visible or shows "Coming Soon" | ☐ |
| E5.4 | ACP page hidden | Check sidebar/navigation | ACP page not visible or shows "Coming Soon" | ☐ |
| E5.5 | Env page hidden | Check sidebar/navigation | Env page not visible or shows "Coming Soon" | ☐ |
| E5.6 | Network page hidden | Check sidebar/navigation | Network page not visible or shows "Coming Soon" | ☐ |
| E5.7 | Virtual Office page hidden | Check sidebar/navigation | Virtual Office page not visible or shows "Coming Soon" | ☐ |
| E5.8 | Task Board page hidden | Check sidebar/navigation | Task Board page not visible or shows "Coming Soon" | ☐ |
| E5.9 | Teams page hidden | Check sidebar/navigation | Teams page not visible or shows "Coming Soon" | ☐ |
| E5.10 | Models page limited | Navigate to Models page | Shows limited model info (hermes-agent only), no provider/cost data | ☐ |
| E5.11 | Gateway page limited | Navigate to Gateway page | No metrics/reload/restart buttons visible | ☐ |

### E6: Browser Console Clean

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| E6.1 | No CORS errors | Navigate all visible pages | Zero CORS errors in browser console | ☐ |
| E6.2 | No 404s on API calls | Navigate all visible pages, trigger all actions | No 404 responses to API calls | ☐ |
| E6.3 | No unhandled Promise rejections | Interact with all pages | Zero unhandled rejections in console | ☐ |
| E6.4 | No RxJS subscription leaks | Navigate away from pages with subscriptions | No "possible memory leak" warnings | ☐ |

---

## Suite F: Regression

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| F1 | /health endpoint unchanged | `curl http://localhost:8642/health` | Returns `{"status": "ok", "platform": "hermes-agent"}` exactly as before | ☐ |
| F2 | /v1/models unchanged | `curl -H "Authorization: Bearer ***" http://localhost:8642/v1/models` | Returns model list with hermes-agent | ☐ |
| F3 | /v1/chat/completions unchanged | Send a chat completion request | Response format matches OpenAI spec, X-Hermes-Session-Id header present | ☐ |
| F4 | /v1/runs unchanged | Start an agent run | Returns run_id with HTTP 202, SSE events stream correctly | ☐ |
| F5 | /api/sessions list unchanged | `curl -H "Authorization: Bearer ***" "http://localhost:8642/api/sessions?limit=20&offset=0"` | Returns `{sessions, total, limit, offset}` — format unchanged | ☐ |
| F6 | /api/sessions/{id} unchanged | Get a specific session | Returns `{session, messages}` format | ☐ |
| F7 | /api/memory unchanged | GET /api/memory | Returns `{memory: {...}, user: {...}}` flat shape | ☐ |
| F8 | /api/skills unchanged | GET /api/skills | Returns `{skills, total}` | ☐ |
| F9 | /api/jobs unchanged | GET /api/jobs | Returns `{jobs}` | ☐ |
| F10 | /api/gateway/status unchanged | GET /api/gateway/status | Returns gateway status object | ☐ |
| F11 | /api/tools unchanged | GET /api/tools | Returns tools list | ☐ |
| F12 | /api/mcp unchanged | GET /api/mcp | Returns `{servers}` | ◐ |
| F13 | /api/auth/token unchanged | POST /api/auth/token with API key | Returns `{access_token, refresh_token, expires_in, token_type}` | ☐ |
| F14 | /api/auth/refresh unchanged | POST /api/auth/refresh with valid refresh_token | Returns new token pair (rotation) | ☐ |
| F15 | /api/config unchanged | GET /api/config | Returns redacted config | ☐ |
| F16 | Existing sessions preserved | List sessions after frontend changes | All pre-existing sessions still accessible | ☐ |
| F17 | Existing skills preserved | List skills after frontend changes | All pre-installed skills still present | ☐ |
| F18 | Existing cron jobs preserved | List jobs after frontend changes | All pre-existing jobs still scheduled | ☐ |
| F19 | Existing memory preserved | GET /api/memory after frontend changes | All pre-existing memory entries intact | ☐ |
| F20 | CLI still works | Run `hermes chat "hello"` from terminal | CLI functions normally, unaffected by web frontend changes | ☐ |
| F21 | Gateway platforms still work | If gateway is running, send message via connected platform | Message processed normally | ☐ |

---

## Suite G: Edge Cases & Error Handling

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| G1 | API server down | Stop api_server.py, try to use frontend | Graceful error message, not a white screen | ☐ |
| G2 | Network timeout | Simulate slow network (throttle to 3G) | Loading indicators shown, eventual timeout with retry option | ☐ |
| G3 | Malformed API response | Intercept and modify response to have unexpected shape | Frontend catches error, shows fallback UI | ☐ |
| G4 | Empty sessions list | Delete all sessions, refresh | Empty state shown, "New Chat" still works | ☐ |
| G5 | Very long session title | Create session with 500-char title | Truncated in UI, no layout break | ☐ |
| G6 | Special characters in search | Search sessions with regex special chars (`*?+[]`) | No crash, safe search results | ☐ |
| G7 | Concurrent tab sessions | Open app in two browser tabs, login in both | Both tabs function, no token conflicts | ☐ |
| G8 | localStorage cleared mid-session | Clear localStorage while app is open | Next API call triggers 401 → redirect to login | ☐ |
| G9 | SSE stream for failed run | Run that triggers an LLM API error | `run.failed` event received, error displayed | ☐ |
| G10 | DELETE with JSON body (memory entry) | Delete memory entry via DELETE /api/memory/entry with JSON body | Request succeeds (no middleware stripping body) | ☐ |
| G11 | Rapid message sending | Send 3 messages in quick succession | Each message processed, no queue corruption or lost messages | ☐ |
| G12 | Pagination at boundaries | Navigate to first page (prev disabled), last page (next disabled) | Controls correctly disabled, no API errors | ☐ |
| G13 | Skill install failure | Attempt to install a non-existent skill | Error message shown, app doesn't crash | ☐ |
| G14 | Cron job with invalid schedule | Create job with invalid cron expression | Server returns error, UI shows validation message | ☐ |

---

## Pass/Fail Criteria

| Criteria | Threshold |
|----------|-----------|
| Suite A (Pre-flight) | 5/5 must pass before proceeding |
| Suite B (Critical Bugs) | 4/4 critical issues must be verified fixed (all sub-tests pass) |
| Suite C (Auth) | 10/11 must pass (C4 backward compat may be skipped if JWT-only approach chosen) |
| Suite D (Integration) | 35/37 must pass (minor cosmetic issues acceptable) |
| Suite E (UI/UX) | 25/27 must pass |
| Suite F (Regression) | 21/21 must pass (zero regression on existing API) |
| Suite G (Edge Cases) | 12/14 must pass |

**Overall Gate:** All Suite A + B must pass. At least 90% of remaining suites combined must pass for release.

---

## Test Environment

| Component | Value |
|-----------|-------|
| Backend | Hermes Agent API server on `localhost:8642` |
| Frontend | React 18 + Vite dev server on `localhost:8080` |
| Browser | Chrome latest (primary), Firefox latest (secondary) |
| Auth | API key from `~/.hermes/config.yaml` → `VITE_HERMES_API_KEY` |
| Config | `cors_origins` in config.yaml must include `http://localhost:8080` |

## Prerequisites

1. Hermes agent installed and configured (`~/.hermes/config.yaml` with valid API key)
2. `api_server.py` running: `python gateway/platforms/api_server.py`
3. Frontend dev server: `cd web && npm run dev`
4. CORS fix applied: `PATCH` added to `_CORS_HEADERS["Access-Control-Allow-Methods"]`
5. Session creation endpoint added: `POST /api/sessions` (or alternative from C4 fix)
6. WS JWT support added (or documented API-key-only fallback)
