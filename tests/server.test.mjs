import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString() }); }
      });
    }).on('error', reject);
  });
}

describe('Jart-URA Server Integration', () => {
  const TEST_DIR = path.join(os.tmpdir(), `jart-ura-server-test-${Date.now()}`);
  const CONFIG_PATH = path.join(TEST_DIR, 'models.json');
  let server;

  beforeAll(() => {
    fs.mkdirSync(path.join(TEST_DIR, 'pids'), { recursive: true });
    const MOCK_BIN = path.join(process.cwd(), 'tests', 'helpers', 'mock-llama-server.js');

    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      port_range: [19800, 19900],
      models: [
        {
          name: 'test-local',
          port: 19801,
          source: 'local',
          engine: 'metal',
          model_path: 'models/test.gguf',
          context: 4096,
          gpu_layers: 0,
          threads: 2,
        },
        {
          name: 'test-api',
          port: 19802,
          source: 'api',
          provider: 'openai',
          api_model: 'gpt-4o',
          api_key_env: 'TEST_API_KEY',
          base_url: 'http://localhost:19803',
        },
      ],
      engines: {
        metal: { bin: MOCK_BIN, default_args: [] },
      },
      server: {
        host: '0.0.0.0',
        port: 19800,
        log_dir: 'logs/',
        pid_dir: path.join(TEST_DIR, 'pids'),
      },
    }, null, 2));

    process.env.JART_URA_CONFIG = CONFIG_PATH;
    process.env.JART_URA_PID_DIR = path.join(TEST_DIR, 'pids');
    process.env.TEST_API_KEY = 'sk-test123';

    delete require.cache[require.resolve('../server.js')];
    server = require('../server.js');
    server.start();
  });

  afterAll(() => {
    server?.shutdown();
    try { fs.rmSync(TEST_DIR, { recursive: true }); } catch { /* empty */ }
  });

  it('health endpoint returns model status', async () => {
    await new Promise((r) => setTimeout(r, 200));
    const health = await httpGet(19800, '/health').catch(() => ({ status: 0, data: {} }));
    expect(health.status).toBe(200);
    expect(health.data.models.total).toBe(2);
  });

  it('models endpoint returns model list', async () => {
    const models = await httpGet(19800, '/v1/models').catch(() => ({ status: 0, data: {} }));
    expect(models.status).toBe(200);
    expect(models.data.data).toHaveLength(2);

    const names = models.data.data.map((m) => m.name);
    expect(names).toContain('test-local');
    expect(names).toContain('test-api');
  });
});
