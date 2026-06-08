import { describe, it, expect } from 'vitest';
import { isValidSlug, buildPageShim, patchRegistrySource } from './slug';

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('acme-1')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('org_private-2')).toBe(true);
  });
  it('rejects invalid slugs', () => {
    expect(isValidSlug('-bad')).toBe(false);
    expect(isValidSlug('Bad')).toBe(false);
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('default')).toBe(false); // reserved
  });
});

describe('buildPageShim', () => {
  it('produces a shim importing the slug Layout', () => {
    const shim = buildPageShim('acme-1');
    expect(shim).toContain("import Layout from '../templates/acme-1/Layout.astro'");
    expect(shim).toContain('fetchPageBundle(Astro)');
    expect(shim).toContain('<Layout {...bundle} />');
  });
});

describe('patchRegistrySource', () => {
  const SRC = `const TEMPLATE_ROUTES: Record<string, string> = {
  default:      '/',
  enterprise:   '/enterprise',
};`;
  it('inserts a route line before the closing brace', () => {
    const out = patchRegistrySource(SRC, 'acme-1');
    expect(out).toContain("'acme-1': '/acme-1',");
    expect(out.indexOf("'acme-1'")).toBeLessThan(out.lastIndexOf('};'));
  });
  it('is idempotent', () => {
    const once = patchRegistrySource(SRC, 'acme-1');
    const twice = patchRegistrySource(once, 'acme-1');
    expect(twice).toBe(once);
  });
  it('throws if the routes map is not found', () => {
    expect(() => patchRegistrySource('no map here', 'acme-1')).toThrow();
  });
});
