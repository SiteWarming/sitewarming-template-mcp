// Minimal .env loader — no external dependency. Parses KEY=VALUE lines,
// supports # comments, blank lines, and surrounding quotes. Real process.env
// values always win (file only fills the gaps).
import { existsSync, readFileSync } from 'node:fs';

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Apply a .env file into process.env without clobbering existing values.
// Missing file = silent no-op (env vars may be supplied another way).
export function applyEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
