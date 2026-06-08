// Pure helpers: slug validation, page-shim generation, registry patching.
// No I/O here — fs-ops.ts owns the disk.

const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const RESERVED = new Set(['default']);

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && !RESERVED.has(slug);
}

// Fixed page-shim pattern — mirrors src/pages/vatsalorg-1.astro.
export function buildPageShim(slug: string): string {
  return `---
// Custom template page shim — ${slug} (org_private).
// Visibility / ownership is enforced by the worker; astro just renders.
import { fetchPageBundle } from '../lib/page-bundle';
import Layout from '../templates/${slug}/Layout.astro';
const bundle = await fetchPageBundle(Astro);
---
<Layout {...bundle} />
`;
}

// Insert "'<slug>': '/<slug>'," into the TEMPLATE_ROUTES map. Idempotent.
// Throws if the map's closing "};" cannot be located.
export function patchRegistrySource(source: string, slug: string): string {
  const line = `  '${slug}': '/${slug}',`;
  if (source.includes(`'${slug}':`)) return source; // already present
  const mapStart = source.indexOf('TEMPLATE_ROUTES');
  if (mapStart === -1) throw new Error('TEMPLATE_ROUTES map not found in registry source');
  const closeIdx = source.indexOf('};', mapStart);
  if (closeIdx === -1) throw new Error('Could not find end of TEMPLATE_ROUTES map');
  return source.slice(0, closeIdx) + line + '\n' + source.slice(closeIdx);
}
