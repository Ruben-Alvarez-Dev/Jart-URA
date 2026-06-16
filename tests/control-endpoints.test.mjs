// End-to-end "circuit" test: boot the management server with a mock engine,
// then drive the full path over HTTP — list engines, scan disk, create a model
// from a real file, LOAD it (spawns the mock engine), see it running in the
// registry with a PID, read its logs, unload, and delete. No mocks of our own
// code: the real server.js router + config-store + control + process-manager.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

const TMP = path.join(os.tmpdir(), `jart-ura-e2e-${Date.now()}`);
const CONFIG = path.join(TMP, 'models.json');
const MODELS_DIR = path.join(TMP, 'models');
const FAKE_GGUF = path.join(MODELS_DIR, 'qwen-test-Q4_K_M.gguf');
const MGMT = 19920;

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: 'localhost', port: MGMT, path: urlPath, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, data: text }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let server;

describe('control endpoints (full circuit)', () => {
  beforeAll(async () => {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    fs.mkdirSync(path.join(TMP, 'pids'), { recursive: true });
    fs.writeFileSync(FAKE_GGUF, 'x'.repeat(4096));
    const MOCK_BIN = path.join(process.cwd(), 'tests', 'helpers', 'mock-llama-server.js');

    fs.writeFileSync(CONFIG, JSON.stringify({
      port_range: [19921, 19940],
      models: [],
      engines: { mock: { bin: MOCK_BIN, default_args: [] } },
      server: { host: '0.0.0.0', port: MGMT },
    }, null, 2));

    process.env.JART_URA_CONFIG = CONFIG;
    process.env.JART_URA_PID_DIR = path.join(TMP, 'pids');
    process.env.JART_URA_LOG_DIR = path.join(TMP, 'logs');

    delete require.cache[require.resolve('../server.js')];
    server = require('../server.js');
    server.start();
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(() => {
    server?.shutdown();
    try { fs.rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  });

  it('lists the configured engine', async () => {
    const r = await req('GET', '/v1/engines');
    expect(r.status).toBe(200);
    expect(r.data.engines.mock).toBeTruthy();
  });

  it('creates + lists a custom engine', async () => {
    const r = await req('POST', '/v1/engines', { name: 'coreml', bin: '/opt/llama-coreml', default_args: ['--no-mmap'], description: 'ANE engine' });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    const list = await req('GET', '/v1/engines');
    expect(list.data.engines.coreml.description).toBe('ANE engine');
  });

  it('scans a real disk path and finds the gguf', async () => {
    const set = await req('PUT', '/v1/disk/paths', { paths: [MODELS_DIR] });
    expect(set.data.ok).toBe(true);
    const scan = await req('GET', '/v1/disk/models?refresh=1');
    expect(scan.status).toBe(200);
    const names = scan.data.models.map((m) => m.name);
    expect(names).toContain('qwen-test-Q4_K_M.gguf');
  });

  it('creates a model from a disk file and LOADS it (real process)', async () => {
    const create = await req('POST', '/v1/models', { name: 'qtest', source: 'local', engine: 'mock', model_path: FAKE_GGUF, load: true });
    expect(create.status).toBe(200);
    expect(create.data.ok).toBe(true);
    expect(create.data.model.port).toBe(19921); // first free in range
    expect(create.data.load.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 150));
    const reg = await req('GET', '/v1/registry');
    const m = reg.data.unified.find((x) => x.name === 'qtest');
    expect(m).toBeTruthy();
    expect(m.status).toBe('running');
    expect(typeof m.pid).toBe('number');
    expect(m.engine).toBe('mock');
    expect(m.model_path).toBe(FAKE_GGUF);
  });

  it('reads the model logs', async () => {
    const r = await req('GET', '/v1/models/qtest/logs?tail=50');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.lines)).toBe(true);
    expect(r.data.lines.join('\n')).toMatch(/listening on/i);
  });

  it('unloads then reloads the model', async () => {
    const off = await req('POST', '/v1/models/qtest/unload');
    expect(off.data.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    let reg = await req('GET', '/v1/registry');
    expect(reg.data.unified.find((x) => x.name === 'qtest').status).toBe('stopped');

    const on = await req('POST', '/v1/models/qtest/load');
    expect(on.data.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    reg = await req('GET', '/v1/registry');
    expect(reg.data.unified.find((x) => x.name === 'qtest').status).toBe('running');
  });

  it('deletes the model (and stops it)', async () => {
    const del = await req('DELETE', '/v1/models/qtest');
    expect(del.data.ok).toBe(true);
    const reg = await req('GET', '/v1/registry');
    expect(reg.data.unified.find((x) => x.name === 'qtest')).toBeFalsy();
  });

  it('rejects an invalid model create with structured errors', async () => {
    const r = await req('POST', '/v1/models', { name: 'bad', source: 'local', engine: 'ghost', model_path: 'x.gguf' });
    expect(r.status).toBe(400);
    expect(r.data.ok).toBe(false);
    expect(r.data.errors.join(' ')).toMatch(/engine 'ghost'/);
  });
});
