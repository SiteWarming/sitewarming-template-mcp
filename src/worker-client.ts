// Typed wrappers over the four worker admin endpoints the MCP uses.
// All requests carry the X-Template-MCP-Key header.
import type { Config } from './config.js';

export interface CustomTemplateRequest {
  id: string;
  design_spec_md: string | null;
  organization_id: string;
  status: string;
  submission_mode: string;
  reference_urls?: string[] | null;
}

export interface CreateTemplateInput {
  id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  owner_org_id: string;
}

type FetchFn = typeof fetch;

export class WorkerClient {
  constructor(private cfg: Config, private fetchFn: FetchFn = fetch) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Template-MCP-Key': this.cfg.TEMPLATE_MCP_API_KEY,
    };
  }

  private url(path: string): string {
    return `${this.cfg.WORKER_API_URL}${path}`;
  }

  private async parseOrThrow(res: Response, context: string): Promise<any> {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body as any)?.message || (body as any)?.error || res.statusText;
      throw new Error(`${context} failed (${res.status}): ${msg}`);
    }
    return body;
  }

  async getRequest(id: string): Promise<CustomTemplateRequest> {
    const res = await this.fetchFn(this.url(`/api/admin/custom-template-requests/${id}`), {
      method: 'GET',
      headers: this.headers(),
    });
    const body = await this.parseOrThrow(res, 'getRequest');
    return body.data.request as CustomTemplateRequest;
  }

  async getTemplate(slug: string): Promise<any | null> {
    const res = await this.fetchFn(this.url(`/api/admin/astro-templates/${slug}`), {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    const body = await this.parseOrThrow(res, 'getTemplate');
    return body.data?.template ?? body.data ?? null;
  }

  async templateExists(slug: string): Promise<boolean> {
    const res = await this.fetchFn(this.url(`/api/admin/astro-templates/${slug}`), {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return false;
    await this.parseOrThrow(res, 'templateExists');
    return true;
  }

  async createTemplate(input: CreateTemplateInput): Promise<any> {
    const res = await this.fetchFn(this.url('/api/admin/astro-templates'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        id: input.id,
        name: input.name,
        description: input.description,
        thumbnail_url: input.thumbnail_url,
        astro_entry_path: `/${input.id}`,
        visibility: 'org_private',
        owner_org_id: input.owner_org_id,
        status: 'beta',
      }),
    });
    const body = await this.parseOrThrow(res, 'createTemplate');
    return body.data;
  }

  async markDelivered(requestId: string, assignedTemplateId: string): Promise<any> {
    const res = await this.fetchFn(
      this.url(`/api/admin/custom-template-requests/${requestId}/mark-delivered`),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ assigned_template_id: assignedTemplateId }),
      },
    );
    const body = await this.parseOrThrow(res, 'markDelivered');
    return body.data;
  }
}
