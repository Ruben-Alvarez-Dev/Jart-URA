import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MODULE_PATH = require.resolve('../src/api-proxy.js');

function requireProxy() {
  delete require.cache[MODULE_PATH];
  return require('../src/api-proxy.js');
}

function createMockApi(port, expectedPath, responseData, responseStatus) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const auth = req.headers['authorization'] || '';
        if (req.url === expectedPath || !expectedPath) {
          res.writeHead(responseStatus || 200, {
            'Content-Type': 'application/json',
            'X-Auth-Received': auth,
          });
          res.end(JSON.stringify({ ...responseData, echo_body: JSON.parse(body || '{}'), auth_received: auth }));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
    });
    server.listen(port, () => resolve(server));
  });
}

function request(port, method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'localhost', port, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('ApiProxy', () => {
  it('creates a proxy that forwards to the target API', async () => {
    const api = await createMockApi(19601, '/v1/chat/completions', { choices: [{ message: { content: 'ok' } }] });
    const ap = requireProxy();
    const server = ap.createProxy({ name: 'test-api', port: 19701, base_url: 'http://localhost:19601', api_model: 'gpt-4', api_key_env: 'TEST_KEY' });

    process.env.TEST_KEY = 'sk-test123';
    const res = await request(19701, 'POST', '/v1/chat/completions', { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(res.data.choices[0].message.content).toBe('ok');
    server.close();
    api.close();
  });

  it('injects API key from env', async () => {
    const api = await createMockApi(19602, '/v1/chat/completions', { ok: true });
    const ap = requireProxy();
    const server = ap.createProxy({ name: 'test-key', port: 19702, base_url: 'http://localhost:19602', api_model: 'gpt-4', api_key_env: 'MY_SECRET_KEY' });

    process.env.MY_SECRET_KEY = 'sk-hello-world';
    const res = await request(19702, 'POST', '/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });

    expect(res.headers['x-auth-received']).toContain('Bearer sk-hello-world');
    server.close();
    api.close();
  });

  it('forwards the request body to the API', async () => {
    const api = await createMockApi(19603, '/v1/chat/completions', { ok: true });
    const ap = requireProxy();
    const server = ap.createProxy({ name: 'test-body', port: 19703, base_url: 'http://localhost:19603', api_model: 'claude-4', api_key_env: 'TEST_KEY' });

    process.env.TEST_KEY = 'sk-body';
    const res = await request(19703, 'POST', '/v1/chat/completions', {
      model: 'claude-4', messages: [{ role: 'user', content: 'hello world' }], max_tokens: 100,
    });

    expect(res.data.echo_body.model).toBe('claude-4');
    expect(res.data.echo_body.messages[0].content).toBe('hello world');
    expect(res.data.echo_body.max_tokens).toBe(100);
    server.close();
    api.close();
  });

  it('handles missing API key gracefully', async () => {
    const api = await createMockApi(19604, '/v1/chat/completions', { ok: true });
    const ap = requireProxy();
    const server = ap.createProxy({ name: 'test-nokey', port: 19704, base_url: 'http://localhost:19604', api_model: 'gpt-4', api_key_env: 'NONEXISTENT_KEY' });

    delete process.env.NONEXISTENT_KEY;
    const res = await request(19704, 'POST', '/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(res.data.echo_body.messages[0].content).toBe('hi');
    server.close();
    api.close();
  });

  it('supports GET passthrough routes', async () => {
    const api = await createMockApi(19605, '/health', { status: 'ok' });
    const ap = requireProxy();
    const server = ap.createProxy({ name: 'test-get', port: 19705, base_url: 'http://localhost:19605', api_model: 'gpt-4', api_key_env: 'TEST_KEY' });

    process.env.TEST_KEY = 'sk-get';
    const res = await request(19705, 'GET', '/health');

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
    server.close();
    api.close();
  });
});
