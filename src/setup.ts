/**
 * Interactive setup wizard for sitewarming-template-mcp.
 * Run via: npm run setup  (node dist/setup.js)
 *
 * Prompts for the three required config values, validates each one,
 * checks worker reachability, writes .env, and optionally writes .mcp.json.
 */
import * as readline from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEnv } from './env-file.js';
import { ConfigSchema } from './config.js';

const ETX = ''; // Ctrl-C
const BACKSPACE_CHARS = new Set(['', '\b']);

// ---------------------------------------------------------------------------
// Prompter
// ---------------------------------------------------------------------------

/**
 * Line-oriented prompter built on readline's `'line'` event with a queue.
 * Both `rl.question` (callback) and `readline/promises` only reliably resolve
 * the FIRST question against piped stdin — the next await never settles. A
 * persistent `'line'` listener feeding a queue/waiter pair avoids that and
 * works identically for interactive TTYs and piped/non-TTY stdin.
 */
class Prompter {
  private rl: readline.Interface;
  private queue: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private closed = false;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl.on('line', (line) => {
      const w = this.waiters.shift();
      if (w) w(line);
      else this.queue.push(line);
    });
    this.rl.on('close', () => {
      this.closed = true;
      let w: ((line: string) => void) | undefined;
      while ((w = this.waiters.shift())) w('');
    });
  }

  ask(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    return new Promise<string>((resolve) => {
      if (this.queue.length) resolve(this.queue.shift() as string);
      else if (this.closed) resolve('');
      else this.waiters.push(resolve);
    });
  }

  /**
   * Secret prompt. On a TTY, mute echo and render `*` per typed char. On
   * non-TTY input masking is irrelevant, so read a plain line.
   */
  askSecret(prompt: string): Promise<string> {
    const input = process.stdin;
    if (!input.isTTY) return this.ask(prompt);

    return new Promise<string>((resolve) => {
      process.stdout.write(prompt);
      const chars: string[] = [];
      this.rl.pause(); // keep readline from also consuming keystrokes
      input.setRawMode(true);
      input.resume();
      input.setEncoding('utf8');

      const finish = (value: string) => {
        input.setRawMode(false);
        input.removeListener('data', onData);
        process.stdout.write('\n');
        this.rl.resume();
        resolve(value);
      };

      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === '\n' || ch === '\r') {
            finish(chars.join(''));
            return;
          } else if (ch === ETX) {
            input.setRawMode(false);
            process.stdout.write('\n');
            process.exit(130);
          } else if (BACKSPACE_CHARS.has(ch)) {
            if (chars.length > 0) {
              chars.pop();
              process.stdout.write('\b \b');
            }
          } else {
            chars.push(ch);
            process.stdout.write('*');
          }
        }
      };

      input.on('data', onData);
    });
  }

  close(): void {
    this.rl.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve repo root (this file lives in dist/ at runtime). */
function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..');
}

/** Load existing .env values (if file exists) so we can surface them as defaults. */
function loadExistingEnv(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  try {
    return parseEnv(readFileSync(envPath, 'utf8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Per-field prompt loops
// ---------------------------------------------------------------------------

async function promptWorkerUrl(p: Prompter, existing: string): Promise<string> {
  const defaultVal = existing || 'http://localhost:8787';
  while (true) {
    const raw = await p.ask(`WORKER_API_URL [${defaultVal}]: `);
    const value = raw.trim() || defaultVal;
    const result = ConfigSchema.shape.WORKER_API_URL.safeParse(value);
    if (result.success) return result.data;
    const msg = result.error.issues.map((i) => i.message).join('; ');
    console.log(`  Invalid URL: ${msg}`);
  }
}

async function promptApiKey(p: Prompter, existing: string): Promise<string> {
  const hasExisting = Boolean(existing);
  const hint = hasExisting ? ' (Enter to keep current): ' : ': ';
  while (true) {
    const raw = await p.askSecret(`TEMPLATE_MCP_API_KEY${hint}`);
    const value = raw.trim() || (hasExisting ? existing : '');
    const result = ConfigSchema.shape.TEMPLATE_MCP_API_KEY.safeParse(value);
    if (result.success) return result.data;
    const msg = result.error.issues.map((i) => i.message).join('; ');
    console.log(`  Invalid key: ${msg}`);
  }
}

async function promptAstroPath(p: Prompter, repoRoot: string, existing: string): Promise<string> {
  // Guess sibling dir as default when no current value.
  const siblingGuess = join(repoRoot, '..', 'astro-warming-template');
  const defaultVal = existing || (existsSync(siblingGuess) ? siblingGuess : '');
  const hint = defaultVal ? ` [${defaultVal}]` : '';

  while (true) {
    const raw = await p.ask(`ASTRO_REPO_PATH${hint}: `);
    const value = raw.trim() || defaultVal;

    if (!value) {
      console.log('  Path is required.');
      continue;
    }
    if (!existsSync(value)) {
      console.log(`  Path does not exist: ${value}`);
      continue;
    }
    const templateDir = join(value, 'src', 'templates');
    if (!existsSync(templateDir)) {
      console.log(`  Missing expected subdirectory: ${templateDir}`);
      continue;
    }
    const result = ConfigSchema.shape.ASTRO_REPO_PATH.safeParse(value);
    if (result.success) return result.data;
    const msg = result.error.issues.map((i) => i.message).join('; ');
    console.log(`  Invalid path: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Worker reachability check
// ---------------------------------------------------------------------------

type ReachResult = { ok: true } | { ok: false; reason: string };

async function checkReachability(workerUrl: string, apiKey: string): Promise<ReachResult> {
  const url = `${workerUrl}/api/admin/astro-templates?limit=1`;
  try {
    const res = await fetch(url, { headers: { 'X-Template-MCP-Key': apiKey } });
    if (res.status === 200) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

/**
 * Run the reachability check + save/retry/abort prompt loop.
 * Returns true to proceed to write, false to abort.
 */
async function reachabilityLoop(p: Prompter, workerUrl: string, apiKey: string): Promise<boolean> {
  while (true) {
    const result = await checkReachability(workerUrl, apiKey);
    if (result.ok) {
      console.log('✓ Worker reachable, key accepted.');
      return true;
    }

    if (result.reason === 'HTTP 401' || result.reason === 'HTTP 403') {
      console.log(`✗ Worker rejected the key (${result.reason}).`);
    } else if (result.reason.startsWith('HTTP')) {
      console.log(`✗ Worker returned an unexpected status (${result.reason}).`);
    } else {
      console.log(`✗ Could not reach the worker at ${workerUrl}: ${result.reason}`);
    }

    const choice = (await p.ask('Save anyway? (y/N) / retry (r) / abort (a): ')).trim().toLowerCase();
    if (choice === 'y') return true;
    if (choice === 'r') continue;
    return false; // 'a' or anything else
  }
}

// ---------------------------------------------------------------------------
// .env writer
// ---------------------------------------------------------------------------

function quoteIfNeeded(value: string): string {
  return value.includes(' ') ? `"${value}"` : value;
}

function writeEnvFile(envPath: string, workerUrl: string, apiKey: string, astroPath: string): void {
  const lines = [
    `WORKER_API_URL=${quoteIfNeeded(workerUrl)}`,
    `TEMPLATE_MCP_API_KEY=${quoteIfNeeded(apiKey)}`,
    `ASTRO_REPO_PATH=${quoteIfNeeded(astroPath)}`,
  ];
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${envPath}`);
}

// ---------------------------------------------------------------------------
// .mcp.json writer / merger
// ---------------------------------------------------------------------------

function writeMcpJson(repoRoot: string): void {
  const mcpPath = join(repoRoot, '.mcp.json');
  const entryPoint = join(repoRoot, 'dist', 'index.js');
  const serverEntry = { command: 'node', args: [entryPoint] };

  let existing: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      existing = JSON.parse(readFileSync(mcpPath, 'utf8')) as Record<string, unknown>;
    } catch {
      console.log(
        `Warning: ${mcpPath} contains invalid JSON — not overwriting.\n` +
          `Add the following manually:\n` +
          JSON.stringify({ mcpServers: { 'sitewarming-template': serverEntry } }, null, 2),
      );
      return;
    }
  }

  const mcpServers = (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  mcpServers['sitewarming-template'] = serverEntry;
  existing.mcpServers = mcpServers;

  writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  console.log(`Wrote/updated ${mcpPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== SiteWarming Template MCP — Setup Wizard ===\n');

  const repoRoot = resolveRepoRoot();
  const envPath = join(repoRoot, '.env');
  const existing = loadExistingEnv(envPath);

  const p = new Prompter();
  try {
    const workerUrl = await promptWorkerUrl(p, existing.WORKER_API_URL ?? '');
    const apiKey = await promptApiKey(p, existing.TEMPLATE_MCP_API_KEY ?? '');
    const astroPath = await promptAstroPath(p, repoRoot, existing.ASTRO_REPO_PATH ?? '');

    console.log('\nChecking worker reachability…');
    const proceed = await reachabilityLoop(p, workerUrl, apiKey);
    if (!proceed) {
      console.log('Aborted — .env not written.');
      return;
    }

    console.log('');
    writeEnvFile(envPath, workerUrl, apiKey, astroPath);

    const mcpChoice = (
      await p.ask('\nRegister with Claude Code by writing .mcp.json in this repo? (Y/n): ')
    )
      .trim()
      .toLowerCase();
    if (mcpChoice !== 'n') writeMcpJson(repoRoot);

    console.log('\nSetup complete. Restart Claude Code (or run /mcp) to pick up the server.');
  } finally {
    p.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
