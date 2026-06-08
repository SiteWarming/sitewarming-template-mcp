import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerClient } from './worker-client';

const cfg = {
  WORKER_API_URL: 'http://localhost:8787',
  TEMPLATE_MCP_API_KEY: 'k',
  ASTRO_REPO_PATH: '/tmp/astro',
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('WorkerClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('getRequest sends the MCP key header and returns data', async () => {
    const f = mockFetch(200, { data: { request: { id: 'r1', design_spec_md: '# x', organization_id: 'o1', status: 'approved', submission_mode: 'advanced' } } });
    const client = new WorkerClient(cfg, f);
    const req = await client.getRequest('r1');
    expect(req.organization_id).toBe('o1');
    const [, init] = f.mock.calls[0];
    expect(init.headers['X-Template-MCP-Key']).toBe('k');
  });

  it('templateExists returns false on 404', async () => {
    const f = mockFetch(404, { error: 'not_found' });
    const client = new WorkerClient(cfg, f);
    expect(await client.templateExists('acme-1')).toBe(false);
  });

  it('templateExists returns true on 200', async () => {
    const f = mockFetch(200, { data: { template: { id: 'acme-1' } } });
    const client = new WorkerClient(cfg, f);
    expect(await client.templateExists('acme-1')).toBe(true);
  });

  it('createTemplate throws on non-2xx with the worker message', async () => {
    const f = mockFetch(409, { error: 'conflict', message: "Template 'acme-1' already exists." });
    const client = new WorkerClient(cfg, f);
    await expect(
      client.createTemplate({ id: 'acme-1', name: 'n', description: 'd', thumbnail_url: 't', owner_org_id: 'o1' }),
    ).rejects.toThrow(/already exists/);
  });

  it('markDelivered posts assigned_template_id', async () => {
    const f = mockFetch(200, { data: { id: 'r1', status: 'delivered' } });
    const client = new WorkerClient(cfg, f);
    const out = await client.markDelivered('r1', 'acme-1');
    expect(out.status).toBe('delivered');
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/api/admin/custom-template-requests/r1/mark-delivered');
    expect(JSON.parse(init.body).assigned_template_id).toBe('acme-1');
  });
});
