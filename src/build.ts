// Runs the astro build in the template repo. Uses `build:original`
// (plain `astro build`, no fix-routes/env steps) to validate that the
// generated template compiles. Returns ok + captured output on failure.
import { spawn } from 'node:child_process';

export interface BuildResult {
  ok: boolean;
  output: string;
}

export function runAstroBuild(repoPath: string): Promise<BuildResult> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build:original'], {
      cwd: repoPath,
      shell: false,
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
    child.on('error', (err) => resolve({ ok: false, output: String(err) }));
  });
}
