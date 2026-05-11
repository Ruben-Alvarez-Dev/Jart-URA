import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';

const MODULE_PATH = path.join(process.cwd(), 'src', 'process-manager.js');
const MOCK_BIN = path.join(process.cwd(), 'tests', 'helpers', 'mock-llama-server.js');
const PID_DIR = path.join(os.tmpdir(), `jart-ura-pids-${Date.now()}`);

function loadManager() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

describe('ProcessManager', () => {
  let pm;

  beforeAll(() => {
    fs.mkdirSync(PID_DIR, { recursive: true });
    process.env.JART_URA_PID_DIR = PID_DIR;
    pm = loadManager();
  });

  afterAll(() => {
    pm.stopAll();
    delete require.cache[require.resolve(MODULE_PATH)];
    try { fs.rmSync(PID_DIR, { recursive: true }); } catch { /* empty */ }
  });

  afterEach(() => {
    pm.stopAll();
  });

  it('starts a local model and it responds on the assigned port', async () => {
    const model = {
      name: 'test-model',
      port: 19501,
      source: 'local',
      engine: 'metal',
      model_path: '/fake/path',
      context: 4096,
      gpu_layers: 0,
      threads: 2,
    };
    const engineConfig = { bin: MOCK_BIN, default_args: [] };

    await pm.startModel(model, engineConfig, PID_DIR);

    const health = await httpGet(19501, '/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body).status).toBe('ok');
  });

  it('writes PID file', async () => {
    const model = {
      name: 'pid-test',
      port: 19502,
      source: 'local',
      engine: 'metal',
      model_path: '/fake/path',
      context: 4096,
      gpu_layers: 0,
      threads: 2,
    };
    const engineConfig = { bin: MOCK_BIN, default_args: [] };

    await pm.startModel(model, engineConfig, PID_DIR);

    const pidFile = path.join(PID_DIR, 'pid-test.pid');
    expect(fs.existsSync(pidFile)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    expect(pid).toBeGreaterThan(0);
  });

  it('stopAll kills all managed processes', async () => {
    const engineConfig = { bin: MOCK_BIN, default_args: [] };

    await pm.startModel({ name: 'a', port: 19503, source: 'local', engine: 'metal', model_path: '/f', context: 4096, gpu_layers: 0, threads: 2 }, engineConfig, PID_DIR);
    await pm.startModel({ name: 'b', port: 19504, source: 'local', engine: 'metal', model_path: '/f', context: 4096, gpu_layers: 0, threads: 2 }, engineConfig, PID_DIR);

    pm.stopAll();

    const healthA = await httpGet(19503, '/health').catch(() => ({ status: 0 }));
    const healthB = await httpGet(19504, '/health').catch(() => ({ status: 0 }));
    expect(healthA.status).toBe(0);
    expect(healthB.status).toBe(0);
  });

  it('stopModel kills a specific model', async () => {
    const engineConfig = { bin: MOCK_BIN, default_args: [] };

    await pm.startModel({ name: 'keep', port: 19505, source: 'local', engine: 'metal', model_path: '/f', context: 4096, gpu_layers: 0, threads: 2 }, engineConfig, PID_DIR);
    await pm.startModel({ name: 'kill', port: 19506, source: 'local', engine: 'metal', model_path: '/f', context: 4096, gpu_layers: 0, threads: 2 }, engineConfig, PID_DIR);

    pm.stopModel('kill');

    const healthKeep = await httpGet(19505, '/health').catch(() => ({ status: 0 }));
    const healthKill = await httpGet(19506, '/health').catch(() => ({ status: 0 }));
    expect(healthKeep.status).toBe(200);
    expect(healthKill.status).toBe(0);
  });

  it('restarts a crashed process', async () => {
    const model = {
      name: 'crash-test',
      port: 19507,
      source: 'local',
      engine: 'metal',
      model_path: '/fake/path',
      context: 4096,
      gpu_layers: 0,
      threads: 2,
    };
    const engineConfig = {
      bin: MOCK_BIN,
      default_args: ['--crash-after', '1'],
    };

    await pm.startModel(model, engineConfig, PID_DIR);

    // First health check: should work (crash-after 1 means crash after 1 request)
    let health = await httpGet(19507, '/health').catch(() => ({ status: 0 }));
    expect(health.status).toBe(200);

    // Second request triggers crash, wait for restart, then verify
    await httpGet(19507, '/health').catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    health = await httpGet(19507, '/health').catch(() => ({ status: 0 }));
    expect(health.status).toBe(200);
  });

  it('stops restarting after max retries', async () => {
    const model = {
      name: 'die-hard',
      port: 19508,
      source: 'local',
      engine: 'metal',
      model_path: '/fake/path',
      context: 4096,
      gpu_layers: 0,
      threads: 2,
    };
    const engineConfig = {
      bin: MOCK_BIN,
      default_args: ['--crash-immediate'],
    };

    await pm.startModel(model, engineConfig, PID_DIR, 1);
    await new Promise((r) => setTimeout(r, 200));
    const health = await httpGet(19508, '/health').catch(() => ({ status: 0 }));
    expect(health.status).toBe(0);
  });
});
