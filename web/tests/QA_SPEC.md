# MCC QA Subagent — Comprehensive Playwright Test Suite

## Objective
Walk through ALL 23 pages at `http://mcc.home` and verify:
1. Page loads without JavaScript errors
2. Page renders with expected layout/structure
3. API endpoints respond correctly (HTTP 200, correct data shapes)
4. Interactive elements are functional (buttons, forms, tabs)
5. No broken links or missing resources
6. Responsive rendering at desktop width (1280px)

## Test Organization
- One test file per domain/phase
- Each page has its own test within the file
- Tests are independent (no shared state)

## Pages to Test (23 total)
1. `/` — Dashboard
2. `/agents` — Agent Pool
3. `/agents/:id` — Agent Detail
4. `/terminal` — Terminal
5. `/files` — File Browser
6. `/chat` — Chat
7. `/memory` — Memory
8. `/skills` — Skills
9. `/sessions` — Sessions
10. `/cron` — Cron Jobs
11. `/logs` — Log Monitoring
12. `/gateway` — Gateway
13. `/channels` — Channels
14. `/models` — Models
15. `/mcp` — MCP Servers
16. `/acp` — Agent Communication Protocol
17. `/env` — Environment Variables
18. `/network` — Network Discovery
19. `/virtual-office` — Virtual Office
20. `/tasks` — Task Board
21. `/teams` — Team Management
22. `*` — Not Found

## API Endpoints to Verify
For each page, verify the primary API endpoint(s) return correct shape:
- `GET /api/health` → {status: "ok", data: {service, version, services: {redis, mongodb}}}
- `GET /api/hermes/agents` → {status: "ok", data: {items: [...], total, page, ...}}
- `GET/api/hermes/sessions` → {status: "ok", data: [...]}  (array, not object)
- `GET /api/network/hosts` → {status: "ok", data: [{id, hostname, ip, status, services, lastSeen}]}
- etc.

## Test Patterns
Each page test follows this structure:
1. `test.describe('[Page Name]', ...)` — page-level test group
2. `test('loads without errors', ...)` — verifies page loads, no console errors
3. `test('renders core UI elements', ...)` — verifies headings, tables, lists render
4. `test('API endpoint returns expected shape', ...)` — verifies API response shape
5. `test('interactive elements work', ...)` — tests tabs, buttons, dialogs if present

## Execution
```bash
cd /home/david/mission-control-center/web
npx playwright test --reporter=list
```

## Pass Criteria
- All 23 page load tests pass
- No uncaught JavaScript errors in browser console
- All API endpoint shape tests pass
- At minimum: page renders with expected heading and no error states blocking content
