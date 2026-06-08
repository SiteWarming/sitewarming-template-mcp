// The six MCP tools. Each returns a structured text result. State between
// tools (last slug, last build status) is held in a tiny in-process session
// so register_and_deliver can refuse if no passing build was seen.
import { z } from 'zod';
import type { Config } from './config.js';
import { WorkerClient } from './worker-client.js';
import { FsOps, type TemplateFileName } from './fs-ops.js';
import { runAstroBuild } from './build.js';
import { isValidSlug } from './slug.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: any) => Promise<string>;
}

interface Session {
  lastBuildOkForSlug: string | null;
}

export function buildTools(cfg: Config): ToolDef[] {
  const client = new WorkerClient(cfg);
  const fs = new FsOps(cfg.ASTRO_REPO_PATH);
  const session: Session = { lastBuildOkForSlug: null };

  return [
    {
      name: 'get_request',
      description:
        'Fetch a custom template request by ID. Returns its design_spec_md, organization_id, status, and reference URLs. Errors unless submission_mode is "advanced".',
      inputSchema: z.object({ request_id: z.string().min(1) }),
      handler: async ({ request_id }) => {
        const req = await client.getRequest(request_id);
        if (req.submission_mode !== 'advanced') {
          throw new Error(`Request ${request_id} is submission_mode="${req.submission_mode}". Only "advanced" (with design_spec_md) is supported.`);
        }
        if (!req.design_spec_md) {
          throw new Error(`Request ${request_id} has no design_spec_md.`);
        }
        return JSON.stringify(
          {
            request_id: req.id,
            status: req.status,
            organization_id: req.organization_id,
            reference_urls: req.reference_urls ?? [],
            design_spec_md: req.design_spec_md,
            note: 'Author Layout.astro, BlogList.astro, BlogPost.astro from this design.md. Then call scaffold_template, write_template_file x3, patch_registry, build_check, register_and_deliver.',
          },
          null,
          2,
        );
      },
    },
    {
      name: 'scaffold_template',
      description:
        'Validate the slug, check it is not already registered, create src/templates/<slug>/ + the page shim, and return the three target file paths plus the default template files as reference scaffolding to adapt.',
      inputSchema: z.object({ slug: z.string().min(1) }),
      handler: async ({ slug }) => {
        if (!isValidSlug(slug)) throw new Error(`Invalid slug "${slug}". Use lowercase letters/digits/dashes/underscores; "default" is reserved.`);
        if (await client.templateExists(slug)) throw new Error(`Template "${slug}" already exists in the registry. Choose another slug.`);
        const out = fs.scaffold(slug);
        return JSON.stringify({ slug, targetPaths: out.targetPaths, reference: out.reference }, null, 2);
      },
    },
    {
      name: 'write_template_file',
      description: 'Write authored content to src/templates/<slug>/<file>.astro. file must be Layout, BlogList, or BlogPost.',
      inputSchema: z.object({
        slug: z.string().min(1),
        file: z.enum(['Layout', 'BlogList', 'BlogPost']),
        content: z.string().min(1),
      }),
      handler: async ({ slug, file, content }) => {
        fs.writeTemplateFile(slug, file as TemplateFileName, content);
        session.lastBuildOkForSlug = null; // any write invalidates a prior build
        return `Wrote src/templates/${slug}/${file}.astro (${content.length} bytes).`;
      },
    },
    {
      name: 'patch_registry',
      description: 'Insert the "<slug>": "/<slug>" route line into src/lib/template-registry.ts. Idempotent.',
      inputSchema: z.object({ slug: z.string().min(1) }),
      handler: async ({ slug }) => {
        fs.patchRegistry(slug);
        session.lastBuildOkForSlug = null;
        return `Patched template-registry.ts with route for "${slug}".`;
      },
    },
    {
      name: 'build_check',
      description: 'Run the astro build in the template repo to verify the generated template compiles. Must pass before register_and_deliver.',
      inputSchema: z.object({ slug: z.string().min(1) }),
      handler: async ({ slug }) => {
        const result = await runAstroBuild(cfg.ASTRO_REPO_PATH);
        session.lastBuildOkForSlug = result.ok ? slug : null;
        if (!result.ok) {
          return `BUILD FAILED. Fix the generated files and re-run. Output tail:\n${result.output.slice(-4000)}`;
        }
        return `BUILD OK for "${slug}". You may now register_and_deliver.`;
      },
    },
    {
      name: 'register_and_deliver',
      description:
        'Register the template in the worker DB as org_private (owned by the request org) and mark the request delivered. Requires a passing build_check for this slug.',
      inputSchema: z.object({
        slug: z.string().min(1),
        request_id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        thumbnail_url: z.string().min(1),
      }),
      handler: async ({ slug, request_id, name, description, thumbnail_url }) => {
        if (session.lastBuildOkForSlug !== slug) {
          throw new Error(`No passing build_check recorded for "${slug}". Run build_check first (and after any file change).`);
        }
        const req = await client.getRequest(request_id);
        if (req.status !== 'approved') {
          throw new Error(`Request ${request_id} is "${req.status}". mark-delivered requires status "approved".`);
        }
        // Idempotent recovery: if a prior run created the row but failed to
        // deliver, reuse the existing template as long as it is org_private
        // and owned by this request's org. Otherwise create it fresh.
        let created: any;
        const existing = await client.getTemplate(slug);
        if (existing) {
          if (existing.visibility !== 'org_private' || existing.owner_org_id !== req.organization_id) {
            throw new Error(`Template "${slug}" already exists but is not org_private/owned by org ${req.organization_id}. Pick a different slug.`);
          }
          created = existing;
        } else {
          created = await client.createTemplate({
            id: slug,
            name,
            description,
            thumbnail_url,
            owner_org_id: req.organization_id,
          });
        }
        const delivered = await client.markDelivered(request_id, slug);
        return JSON.stringify({ created, delivered, message: `Template "${slug}" registered + delivered to org ${req.organization_id}. Commit + deploy the astro repo to publish.` }, null, 2);
      },
    },
  ];
}
