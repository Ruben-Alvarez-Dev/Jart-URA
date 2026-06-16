// proxy-manager: lifecycle for `source: "api"` models.
//
// api-proxy.createProxy() binds a port immediately, so on its own it can't be
// started/stopped on demand. This wraps it in a registry the control layer can
// load() and unload() symmetrically with local llama-server processes.

const apiProxy = require('./api-proxy');

// name -> { server, model, startedAt }
const proxies = {};

function startProxy(model) {
  const name = model.name;
  if (proxies[name]) return { ok: true, already: true };
  const server = apiProxy.createProxy(model);
  proxies[name] = { server, model, startedAt: Date.now() };
  return { ok: true };
}

function stopProxy(name) {
  const entry = proxies[name];
  if (!entry) return false;
  try { entry.server.close(); } catch { /* already closed */ }
  delete proxies[name];
  return true;
}

function isProxyRunning(name) {
  return !!proxies[name];
}

function getProxyStatus(name) {
  const entry = proxies[name];
  if (!entry) return null;
  return {
    name,
    running: true,
    pid: null,
    startedAt: new Date(entry.startedAt).toISOString(),
    uptimeMs: Date.now() - entry.startedAt,
    restarts: 0,
    lastRestart: null,
    lastExitCode: null,
    logPath: null,
  };
}

function stopAll() {
  for (const name of Object.keys(proxies)) stopProxy(name);
}

module.exports = { startProxy, stopProxy, isProxyRunning, getProxyStatus, stopAll, proxies };
