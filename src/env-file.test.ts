import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, applyEnvFile } from './env-file.js';

describe('parseEnv', () => {
  it('parses key=value lines', () => {
    const out = parseEnv('A=1\nB=hello');
    expect(out).toEqual({ A: '1', B: 'hello' });
  });
  it('ignores blank lines and # comments', () => {
    const out = parseEnv('# comment\n\nA=1\n   # indented comment\nB=2');
    expect(out).toEqual({ A: '1', B: '2' });
  });
  it('strips surrounding single or double quotes', () => {
    const out = parseEnv(`A="quoted"\nB='single'\nC=bare`);
    expect(out).toEqual({ A: 'quoted', B: 'single', C: 'bare' });
  });
  it('keeps = signs inside the value', () => {
    const out = parseEnv('URL=http://x?a=1&b=2');
    expect(out).toEqual({ URL: 'http://x?a=1&b=2' });
  });
  it('trims whitespace around key and value', () => {
    const out = parseEnv('  A  =  1  ');
    expect(out).toEqual({ A: '1' });
  });
  it('ignores malformed lines with no =', () => {
    const out = parseEnv('NOEQUALS\nA=1');
    expect(out).toEqual({ A: '1' });
  });
});

describe('applyEnvFile', () => {
  let dir: string;
  let envPath: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-'));
    envPath = join(dir, '.env');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    // restore env keys we may have touched
    delete process.env.SW_TEST_NEW;
    delete process.env.SW_TEST_EXISTING;
    if (saved.SW_TEST_EXISTING !== undefined) process.env.SW_TEST_EXISTING = saved.SW_TEST_EXISTING;
  });

  it('sets vars from file when not already in env', () => {
    writeFileSync(envPath, 'SW_TEST_NEW=fromfile');
    applyEnvFile(envPath);
    expect(process.env.SW_TEST_NEW).toBe('fromfile');
  });

  it('does NOT override an existing real env var', () => {
    process.env.SW_TEST_EXISTING = 'fromenv';
    writeFileSync(envPath, 'SW_TEST_EXISTING=fromfile');
    applyEnvFile(envPath);
    expect(process.env.SW_TEST_EXISTING).toBe('fromenv');
  });

  it('is a no-op when the file does not exist', () => {
    expect(() => applyEnvFile(join(dir, 'nope.env'))).not.toThrow();
  });
});
