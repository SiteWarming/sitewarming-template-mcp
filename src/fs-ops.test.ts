import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsOps } from './fs-ops.js';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'astro-'));
  mkdirSync(join(repo, 'src', 'templates', 'default'), { recursive: true });
  mkdirSync(join(repo, 'src', 'pages'), { recursive: true });
  mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
  writeFileSync(join(repo, 'src', 'templates', 'default', 'Layout.astro'), 'DEFAULT LAYOUT');
  writeFileSync(join(repo, 'src', 'templates', 'default', 'BlogList.astro'), 'DEFAULT LIST');
  writeFileSync(join(repo, 'src', 'templates', 'default', 'BlogPost.astro'), 'DEFAULT POST');
  writeFileSync(
    join(repo, 'src', 'lib', 'template-registry.ts'),
    `const TEMPLATE_ROUTES: Record<string, string> = {\n  default:      '/',\n};`,
  );
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('FsOps', () => {
  it('scaffold creates the template dir + page shim and returns reference files', () => {
    const fs = new FsOps(repo);
    const out = fs.scaffold('acme-1');
    expect(existsSync(join(repo, 'src', 'templates', 'acme-1'))).toBe(true);
    expect(existsSync(join(repo, 'src', 'pages', 'acme-1.astro'))).toBe(true);
    expect(out.reference.Layout).toBe('DEFAULT LAYOUT');
    expect(out.targetPaths.Layout).toContain('templates/acme-1/Layout.astro');
  });

  it('writeTemplateFile writes only the three allowed names', () => {
    const fs = new FsOps(repo);
    fs.scaffold('acme-1');
    fs.writeTemplateFile('acme-1', 'Layout', 'NEW LAYOUT');
    expect(readFileSync(join(repo, 'src', 'templates', 'acme-1', 'Layout.astro'), 'utf8')).toBe('NEW LAYOUT');
    expect(() => fs.writeTemplateFile('acme-1', 'Evil' as any, 'x')).toThrow();
  });

  it('writeTemplateFile rejects a slug that escapes the templates dir', () => {
    const fs = new FsOps(repo);
    expect(() => fs.writeTemplateFile('../../etc', 'Layout', 'x')).toThrow();
  });

  it('patchRegistry adds the route line on disk', () => {
    const fs = new FsOps(repo);
    fs.patchRegistry('acme-1');
    const src = readFileSync(join(repo, 'src', 'lib', 'template-registry.ts'), 'utf8');
    expect(src).toContain("'acme-1': '/acme-1',");
  });
});
