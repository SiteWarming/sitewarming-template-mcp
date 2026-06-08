/**
 * Interactive setup wizard for sitewarming-template-mcp.
 * Run via: npm run setup  (node dist/setup.js)
 *
 * Prompts for the three required config values, validates each one,
 * checks worker reachability, writes .env, and optionally writes .mcp.json.
 */
import * as readline from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEnv } from './env-file.js';
import { ConfigSchema } from './config.js';

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

/**
 * Prompt with a ANSI-erase-line masking trick so typed chars are overwritten.
 * Falls back gracefully if the TTY tricks don't work — but it should work on
 * any normal terminal that supports ANSI escape codes.
 */
async function askSecret(rl: readline.Interface, prompt: string): Promise<string> {
  const output = (rl as unknown as { output: NodeJS.WriteStream }).output;
  const input  = (rl as unknown as { input: NodeJS.ReadStream }).input;

  const onData = () => {
    // Erase line and reprint the prompt so typed chars appear to vanish.
    output.write('\x1b[2K\x1b[200D' + prompt);
  };

  output.write(prompt);
  input.on('data', onData);
  const answer = await rl.question('');
  input.removeListener('data', onData);
  output.write('\n');
  return answer;
}

/** Ask a plain question with an optional inline default hint. */
async function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return rl.question(prompt);
}

// ---------------------------------------------------------------------------
// Per-field prompt loops
// ---------------------------------------------------------------------------

async function promptWorkerUrl(rl: readline.Interface, existing: string): Promise<string> {
  const defaultVal = existing || 'http://localhost:8787';
  while (true) {
    const raw = await ask(rl, `WORKER_API_URL [${defaultVal}]: `);
    const value = raw.trim() || defaultVal;
    const result = ConfigSchema.shape.WORKER_API_URL.safeParse(value);
    if (result.success) return result.data;
    const msg = result.error.issues.map((i) => i.message).join('; ');
    console.log(`  Invalid URL: ${msg}`);
  }
}

async function promptApiKey(rl: readline.Interface, existing: string): Promise<string> {
  const hasExisting = Boolean(existing);
  const hint = hasExisting ? ' (Enter to keep current): ' : ': ';
  while (true) {
    const raw = await askSecret(rl, `TEMPLATE_MCP_API_KEY${hint}`);
    const value = raw.trim() || (hasExisting ? existing : '');
    const result = ConfigSchema.shape.TEMPLATE_MCP_API_KEY.safeParse(value);
    if (result.success) return result.data;
    const msg = result.error.issues.map((i) => i.message).join('; ');
    console.log(`  Invalid key: ${msg}`);
  }
}

async function promptAstroPath(rl: readline.Interface, repoRoot: string, existing: string): Promise<string> {
  // Guess sibling dir as default when no current value.
  const siblingGuess = join(repoRoot, '..', 'astro-warming-template');
  const defaultVal = existing || (existsSync(siblingGuess) ? siblingGuess : '');
  const hint = defaultVal ? ` [${defaultVal}]` : '';

  while (true) {
    const raw = await ask(rl, `ASTRO_REPO_PATH${hint}: `);
    const value = raw.trim() || defaultVal;

    if (!value) {
      console.log('  Path is required.');
      continue;
    }

    // Validate: directory must exist.
    if (!existsSync(value)) {
      console.log(`  Path does not exist: ${value}`);
      continue;
    }

    // Validate: src/templates subdir must exist.
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
    if (res.status === 200) {
      return { ok: true };
    }
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

/**
 * Run the reachability check and handle the save/retry/abort prompt loop.
 * Returns true if we should proceed to write, false if user chose abort.
 */
async function reachabilityLoop(
  rl: readline.Interface,
  workerUrl: string,
  apiKey: string,
): Promise<boolean> {
  while (true) {
    const result = await checkReachability(workerUrl, apiKey);

    if (result.ok) {
      console.log('✓ Worker reachable, key accepted.');
      return true;
    }

    // Determine a friendlier message.
    if (result.reason.startsWith('HTTP 401') || result.reason.startsWith('HTTP 403')) {
      console.log(`✗ Worker rejected the key (${result.reason}).`);
    } else if (result.reason.startsWith('HTTP')) {
      console.log(`✗ Worker returned an unexpected status (${result.reason}).`);
    } else {
      console.log(`✗ Could not reach the worker at ${workerUrl}: ${result.reason}`);
    }

    const choice = (await ask(rl, 'Save anyway? (y/N) / retry (r) / abort (a): ')).trim().toLowerCase();
    if (choice === 'y') return true;
    if (choice === 'r') continue; // re-run check
    // 'a' or anything else → abort
    return false;
  }
}

// ---------------------------------------------------------------------------
// .env writer
// ---------------------------------------------------------------------------

function quoteIfNeeded(value: string): string {
  return value.includes(' ') ? `"${value}"` : value;
}

function writeEnvFile(
  envPath: string,
  workerUrl: string,
  apiKey: string,
  astroPath: string,
): void {
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

  const serverEntry = {
    command: 'node',
    args: [entryPoint],
  };

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

  // Merge: preserve existing mcpServers entries.
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
  const envPath  = join(repoRoot, '.env');

  // Load existing values to surface as defaults.
  const existing = loadExistingEnv(envPath);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // --- Collect the three config values ---
  const workerUrl = await promptWorkerUrl(rl, existing.WORKER_API_URL ?? '');
  const apiKey    = await promptApiKey(rl, existing.TEMPLATE_MCP_API_KEY ?? '');
  const astroPath = await promptAstroPath(rl, repoRoot, existing.ASTRO_REPO_PATH ?? '');

  // --- Reachability check ---
  console.log('\nChecking worker reachability…');
  const proceed = await reachabilityLoop(rl, workerUrl, apiKey);
  if (!proceed) {
    console.log('Aborted — .env not written.');
    rl.close();
    process.exit(1);
  }

  // --- Write .env ---
  console.log('');
  writeEnvFile(envPath, workerUrl, apiKey, astroPath);

  // --- Offer .mcp.json ---
  const mcpChoice = (await ask(rl, '\nRegister with Claude Code by writing .mcp.json in this repo? (Y/n): '))
    .trim()
    .toLowerCase();

  if (mcpChoice !== 'n') {
    writeMcpJson(repoRoot);
  }

  rl.close();
  console.log('\nSetup complete. Restart Claude Code (or run /mcp) to pick up the server.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
