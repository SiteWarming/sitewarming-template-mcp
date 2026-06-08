// Reads + validates required env. Throws a clear error on startup if missing.
import { z } from 'zod';

export const ConfigSchema = z.object({
  WORKER_API_URL: z.string().url(),
  TEMPLATE_MCP_API_KEY: z.string().min(1),
  ASTRO_REPO_PATH: z.string().min(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    WORKER_API_URL: env.WORKER_API_URL,
    TEMPLATE_MCP_API_KEY: env.TEMPLATE_MCP_API_KEY,
    ASTRO_REPO_PATH: env.ASTRO_REPO_PATH,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid MCP config: ${msg}`);
  }
  return parsed.data;
}
