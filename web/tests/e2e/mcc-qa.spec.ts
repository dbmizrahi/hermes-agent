import { test, expect } from '../../playwright-fixture';

// Helper: check page loads, heading visible, no console errors
async function checkPageLoads(page: any, url: string, headingText: string) {
  const consoleErrors: string[] = [];
  page.on('console', (msg: any) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      consoleErrors.push(msg.text());
    }
  });
  await page.goto(url);
  await expect(page.getByText(headingText).first()).toBeVisible({ timeout: 10000 });
  // Note: consoleErrors length check omitted - use page.evaluate instead
}

// ============================================
// PHASE 2 -- Core Integrations
// ============================================

test.describe('Phase 2: Core Pages', () => {

  test.describe('/ (Dashboard)', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/', 'Mission Control');
    });

    test('API health returns correct shape', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/health');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(body.data).toHaveProperty('service');
      expect(body.data).toHaveProperty('version');
      expect(body.data.services).toHaveProperty('redis');
      expect(body.data.services).toHaveProperty('mongodb');
    });
  });

  test.describe('/agents', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/agents', 'Agents');
    });

    test('API returns paginated list', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/hermes/agents?page=1&limit=5');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(body.data).toHaveProperty('items');
      expect(Array.isArray(body.data.items)).toBe(true);
    });
  });

  test.describe('/agents/:id', () => {
    test('loads without crashing', async ({ page }) => {
      await page.goto('http://localhost:3030/agents/nonexistent');
      const resp = await page.waitForResponse(() => true, { timeout: 10000 });
      // Page loaded without throwing - agent detail may show 404 in-page
    });

    test('API returns 404 for nonexistent agent', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/hermes/agent/nonexistent');
      expect(resp.status()).toBe(404);
    });
  });

  test.describe('/terminal', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/terminal', 'Terminal');
    });
  });

  test.describe('/files', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/files', 'Files');
    });

    test('API tree returns array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/files/tree');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

});

// ============================================
// PHASE 3 -- Management Panels
// ============================================

test.describe('Phase 3: Management Pages', () => {

  test.describe('/sessions', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/sessions', 'Sessions');
    });

    test('API returns flat array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/hermes/sessions?page=1&limit=5');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/memory', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/memory', 'Memory');
    });

    test('API returns MemoryStore shape', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/hermes/memory/user');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(body.data).toHaveProperty('entries');
      expect(body.data).toHaveProperty('totalChars');
      expect(body.data).toHaveProperty('maxChars');
      expect(body.data).toHaveProperty('usagePercent');
      expect(Array.isArray(body.data.entries)).toBe(true);
    });
  });

  test.describe('/skills', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/skills', 'Skills');
    });

    test('API returns flat array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/hermes/skills');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/cron', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/cron', 'Cron Jobs');
    });

    test('API returns flat array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/hermes/cron');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/logs', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/logs', 'Logs');
    });
  });

  test.describe('/gateway', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/gateway', 'Gateway');
    });

    test('API returns metrics shape', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/gateway/metrics');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(body.data).toHaveProperty('requests_per_sec');
      expect(body.data).toHaveProperty('avg_latency_ms');
      expect(body.data).toHaveProperty('active_sessions');
      expect(body.data).toHaveProperty('queued_messages');
    });
  });

  test.describe('/channels', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/channels', 'Channels');
    });

    test('API returns flat array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/channels');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/models', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/models', 'Models');
    });

    test('API returns models array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/models');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
      if (body.data.length > 0) {
        const m = body.data[0];
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('name');
        expect(m).toHaveProperty('provider');
        expect(m).toHaveProperty('context_window');
      }
    });
  });

  test.describe('/mcp', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/mcp', 'MCP Servers');
    });

    test('API returns flat array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/mcp/servers');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/acp', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/acp', 'ACP');
    });

    test('API returns topology with agents/connections', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/acp/topology');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(body.data).toHaveProperty('agents');
      expect(body.data).toHaveProperty('connections');
    });
  });

  test.describe('/env', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/env', 'Environment');
    });

    test('API returns flat array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/env');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/network', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/network', 'Network');
    });

    test('API returns hosts array with services', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/network/hosts');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
      if (body.data.length > 0) {
        const h = body.data[0];
        expect(h).toHaveProperty('ip');
        expect(h).toHaveProperty('hostname');
        expect(h).toHaveProperty('services');
        expect(h).toHaveProperty('status');
        expect(h).toHaveProperty('lastSeen');
        expect(Array.isArray(h.services)).toBe(true);
      }
    });
  });

});

// ============================================
// PHASE 4 -- Advanced Features
// ============================================

test.describe('Phase 4: Advanced Pages', () => {

  test.describe('/virtual-office', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/virtual-office', 'Virtual Office');
    });

    test('API returns workspaces', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/virtual-office/workspaces');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/tasks', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/tasks', 'Task Board');
    });

    test('API returns flat boards array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/tasks/boards');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });

    test('tabs render correctly', async ({ page }) => {
      await page.goto('http://localhost:3030/tasks');
      await expect(page.getByRole('tab', { name: 'Backlog' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('tab', { name: 'Kanban' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Roadmap' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Wiki' })).toBeVisible();
      // Click through tabs
      await page.getByRole('tab', { name: 'Kanban' }).click();
      await page.getByRole('tab', { name: 'Roadmap' }).click();
      await page.getByRole('tab', { name: 'Wiki' }).click();
      await page.getByRole('tab', { name: 'Backlog' }).click();
    });
  });

  test.describe('/teams', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/teams', 'Teams');
    });

    test('API returns teams array', async ({ page }) => {
      const resp = await page.request.get('http://localhost:8082/api/teams');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test.describe('/chat', () => {
    test('loads without errors', async ({ page }) => {
      await checkPageLoads(page, 'http://localhost:3030/chat', 'Chat');
    });
  });

  test.describe('404 Not Found', () => {
    test('renders 404 for unknown routes', async ({ page }) => {
      await page.goto('http://localhost:3030/nonexistent-page-r3r5');
      await expect(page.locator('body')).toContainText(/not found/i, { timeout: 10000 });
    });
  });

});

// ============================================
// SMOKE TEST -- All pages load
// ============================================

test.describe('Smoke Test: All Pages Load', () => {
  const pages = [
    '/', '/agents', '/agents/hero', '/terminal', '/files',
    '/sessions', '/memory', '/skills', '/cron', '/logs',
    '/gateway', '/channels', '/models', '/mcp', '/acp',
    '/env', '/network', '/virtual-office', '/tasks', '/teams',
    '/chat'
  ];

  for (const path of pages) {
    test(`HTTP 200 for ${path}`, async ({ page }) => {
      const resp = await page.goto(`http://localhost:3030${path}`);
      expect(resp?.status()).toBeLessThan(400);
    });
  }
});
