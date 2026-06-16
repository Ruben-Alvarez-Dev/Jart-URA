import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MODULE_PATH = require.resolve('../src/proxy-manager.js');

function requireManager() {
  delete require.cache[MODULE_PATH];
  return require('../src/proxy-manager.js');
}

function createMockUpstream(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(port, () => resolve(server));
  });
}

describe('ProxyManager', () => {
  afterEach(() => {
    const mod = requireManager();
    mod.stopAll();
  });

  it('starts a proxy and reports it as running', async () => {
    const upstream = await createMockUpstream(19801);
    const mod = requireManager();
    const result = mod.startProxy({ name: 'test-pm', port: 19811, base_url: 'http://localhost:19801', api_key_env: 'X' });

    expect(result.ok).toBe(true);
    expect(mod.isProxyRunning('test-pm')).toBe(true);
    upstream.close();
  });

  it('is idempotent — starting twice returns already:true', async () => {
    const upstream = await createMockUpstream(19802);
    const mod = requireManager();
    mod.startProxy({ name: 'idem', port: 19812, base_url: 'http://localhost:19802', api_key_env: 'X' });
    const second = mod.startProxy({ name: 'idem', port: 19812, base_url: 'http://localhost:19802', api_key_env: 'X' });

    expect(second.already).toBe(true);
    upstream.close();
  });

  it('stops a running proxy', async () => {
    const upstream = await createMockUpstream(19803);
    const mod = requireManager();
    mod.startProxy({ name: 'stop-me', port: 19813, base_url: 'http://localhost:19803', api_key_env: 'X' });
    const stopped = mod.stopProxy('stop-me');

    expect(stopped).toBe(true);
    expect(mod.isProxyRunning('stop-me')).toBe(false);
    upstream.close();
  });

  it('returns null status for unknown proxy', () => {
    const mod = requireManager();
    expect(mod.getProxyStatus('nonexistent')).toBeNull();
  });

  it('returns valid status shape for running proxy', async () => {
    const upstream = await createMockUpstream(19804);
    const mod = requireManager();
    mod.startProxy({ name: 'status-check', port: 19814, base_url: 'http://localhost:19804', api_key_env: 'X' });
    const status = mod.getProxyStatus('status-check');

    expect(status.name).toBe('status-check');
    expect(status.running).toBe(true);
    expect(status.startedAt).toBeDefined();
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(status.restarts).toBe(0);
    expect(status.logPath).toBeNull();
    upstream.close();
  });

  it('stopAll clears all proxies', async () => {
    const u1 = await createMockUpstream(19805);
    const u2 = await createMockUpstream(19806);
    const mod = requireManager();
    mod.startProxy({ name: 'a', port: 19815, base_url: 'http://localhost:19805', api_key_env: 'X' });
    mod.startProxy({ name: 'b', port: 19816, base_url: 'http://localhost:19806', api_key_env: 'X' });
    mod.stopAll();

    expect(mod.isProxyRunning('a')).toBe(false);
    expect(mod.isProxyRunning('b')).toBe(false);
    u1.close();
    u2.close();
  });
});
