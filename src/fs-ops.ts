// All disk access for the MCP. Every path is resolved and asserted to live
// inside the astro repo's src/ before any write.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { isValidSlug, buildPageShim, patchRegistrySource } from './slug.js';

const TEMPLATE_FILES = ['Layout', 'BlogList', 'BlogPost'] as const;
export type TemplateFileName = (typeof TEMPLATE_FILES)[number];

export interface ScaffoldResult {
  targetPaths: Record<TemplateFileName, string>;
  reference: Record<TemplateFileName, string>;
}

export class FsOps {
  constructor(private repoPath: string) {}

  private srcDir(): string {
    return join(this.repoPath, 'src');
  }

  // Resolve a path and assert it stays under src/. Throws on escape.
  private jail(p: string): string {
    const abs = resolve(p);
    const rel = relative(this.srcDir(), abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path escapes the astro src directory: ${p}`);
    }
    return abs;
  }

  private templateDir(slug: string): string {
    if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
    return this.jail(join(this.srcDir(), 'templates', slug));
  }

  scaffold(slug: string): ScaffoldResult {
    const dir = this.templateDir(slug);
    mkdirSync(dir, { recursive: true });

    const shimPath = this.jail(join(this.srcDir(), 'pages', `${slug}.astro`));
    writeFileSync(shimPath, buildPageShim(slug));

    const defaultDir = join(this.srcDir(), 'templates', 'default');
    const reference = {} as Record<TemplateFileName, string>;
    const targetPaths = {} as Record<TemplateFileName, string>;
    for (const name of TEMPLATE_FILES) {
      const refPath = join(defaultDir, `${name}.astro`);
      reference[name] = existsSync(refPath) ? readFileSync(refPath, 'utf8') : '';
      targetPaths[name] = join(dir, `${name}.astro`);
    }
    return { targetPaths, reference };
  }

  writeTemplateFile(slug: string, file: TemplateFileName, content: string): void {
    if (!TEMPLATE_FILES.includes(file)) {
      throw new Error(`file must be one of ${TEMPLATE_FILES.join(', ')}`);
    }
    const dir = this.templateDir(slug);
    const target = this.jail(join(dir, `${file}.astro`));
    writeFileSync(target, content);
  }

  patchRegistry(slug: string): void {
    if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
    const regPath = this.jail(join(this.srcDir(), 'lib', 'template-registry.ts'));
    const src = readFileSync(regPath, 'utf8');
    writeFileSync(regPath, patchRegistrySource(src, slug));
  }
}
