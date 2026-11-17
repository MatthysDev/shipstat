import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { transformVexo } from '../bin/migrate.mjs';

const CLI = path.resolve(__dirname, '../bin/shipstat-dashboard.mjs');

describe('migrate vexo', () => {
  it('rewrites imports, requires and mocks', () => {
    const src = `import { vexo, customEvent } from 'vexo-analytics';\nconst v = require("vexo-analytics");\njest.mock('vexo-analytics');\nconst lazy = await import('vexo-analytics');`;
    const { source, changed } = transformVexo(src);
    expect(changed).toBe(4);
    expect(source).not.toContain('vexo-analytics');
    expect(source.match(/shipstat\/vexo/g)).toHaveLength(4);
  });

  it('swaps the key for the endpoint and keeps the code around it', () => {
    const src = `import { vexo } from 'vexo-analytics';\nif (!__DEV__) vexo('97fb4497-c895-479a-bf5e-b673f74e302c', { sessionReplay: false });`;
    const { source } = transformVexo(src, { endpoint: 'https://stats.example.com/events' });
    expect(source).toContain(`if (!__DEV__) vexo('https://stats.example.com/events', { sessionReplay: false });`);
  });

  it('leaves the key and says so without an endpoint', () => {
    const { source, notes } = transformVexo(`import { vexo } from 'vexo-analytics';\nvexo('abc');`);
    expect(source).toContain("vexo('abc')");
    expect(notes.some((n) => n.kind === 'todo')).toBe(true);
  });

  it('flags emails, replay calls and keys from variables', () => {
    const { notes } = transformVexo(`import { vexo, identifyDevice, VexoMask } from 'vexo-analytics';\nvexo(KEY);\nidentifyDevice(user.email);`);
    expect(notes.map((n) => n.text).join(' ')).toMatch(/email[\s\S]*replay|replay[\s\S]*email/);
    expect(notes.some((n) => /variable/.test(n.text))).toBe(true);
  });

  it('does not touch files without vexo-analytics, nor other strings', () => {
    const src = `const label = 'vexo-analytics is great';\nimport x from 'not-vexo-analytics';`;
    expect(transformVexo(src).changed).toBe(0);
  });

  it('is a dry run unless --write', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipstat-migrate-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'node_modules/vexo-analytics'), { recursive: true });
    const file = path.join(dir, 'src/a.ts');
    fs.writeFileSync(file, `import { customEvent } from 'vexo-analytics';\n`);
    fs.writeFileSync(path.join(dir, 'node_modules/vexo-analytics/index.js'), `require('vexo-analytics');\n`);
    execFileSync('node', [CLI, 'migrate', 'vexo', dir]);
    expect(fs.readFileSync(file, 'utf8')).toContain("'vexo-analytics'");
    execFileSync('node', [CLI, 'migrate', 'vexo', dir, '--write']);
    expect(fs.readFileSync(file, 'utf8')).toContain("'shipstat/vexo'");
    expect(fs.readFileSync(path.join(dir, 'node_modules/vexo-analytics/index.js'), 'utf8')).toContain("'vexo-analytics'");
  });
});
