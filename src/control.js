// control: the unified load / unload / restart layer.
//
// Closes the circuit between a model *definition* (config/models.json), its
// *engine* (binary + args), the real *file on disk*, and a live *process*:
//   local → spawn/kill a real llama-server (or any engine) via process-manager
//   api   → start/stop an HTTP proxy via proxy-manager
// Everything reads the freshest config through config-store so changes made by
// the REST endpoints take effect immediately.

const fs = require('fs');
const path = require('path');
const configStore = require('./config-store');
const processManager = require('./process-manager');
const proxyManager = require('./proxy-manager');

function repoPath(p) {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

// Resolve an engine for a model and absolutise its binary path.
function resolveEngine(config, model) {
  const engine = (config.engines || {})[model.engine];
  if (!engine) return null;
  return { ...engine, bin: repoPath(engine.bin) };
}

function findModel(config, name) {
  return (config.models || []).find((m) => m.name === name) || null;
}

async function loadModel(name, configPath, pidDir) {
  const config = configStore.readConfig(configPath);
  const model = findModel(config, name);
  if (!model) return { ok: false, errors: [`model '${name}' not found`] };

  if ((model.source || 'local') === 'api') {
    proxyManager.startProxy(model);
    return { ok: true, status: getStatus(name, configPath) };
  }

  const engine = resolveEngine(config, model);
  if (!engine) return { ok: false, errors: [`engine '${model.engine}' is not defined`] };

  const resolvedPath = repoPath(model.model_path);
  const fileExists = fs.existsSync(resolvedPath);

  try {
    await processManager.startModel({ ...model, model_path: resolvedPath }, engine, pidDir);
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }

  const out = { ok: true, status: getStatus(name, configPath) };
  if (!fileExists) out.warning = `model_path not found on disk: ${model.model_path} (engine started anyway)`;
  if (!fs.existsSync(engine.bin)) {
    out.warning = `${out.warning ? out.warning + '; ' : ''}engine binary not found: ${engine.bin}`;
  }
  return out;
}

function unloadModel(name, configPath) {
  const config = configStore.readConfig(configPath);
  const model = findModel(config, name);
  const source = model ? (model.source || 'local') : null;

  // Try both — covers the case where the config row was already deleted.
  let stopped = false;
  if (source === 'api' || proxyManager.isProxyRunning(name)) {
    stopped = proxyManager.stopProxy(name) || stopped;
  }
  if (source === 'local' || processManager.isModelRunning(name)) {
    processManager.stopModel(name);
    stopped = true;
  }
  return { ok: true, stopped };
}

async function restartModel(name, configPath, pidDir) {
  unloadModel(name, configPath);
  await new Promise((r) => setTimeout(r, 150));
  return loadModel(name, configPath, pidDir);
}

// Unified live status for one model (local process or api proxy), or null.
function getStatus(name, configPath) {
  let model = null;
  try { model = findModel(configStore.readConfig(configPath), name); } catch { /* ignore */ }
  const source = model ? (model.source || 'local') : null;
  if (source === 'api') return proxyManager.getProxyStatus(name) || { name, running: false, source: 'api' };
  if (source === 'local') return processManager.getModelStatus(name) || { name, running: false, source: 'local' };
  // Unknown config: best-effort probe of both managers.
  return processManager.getModelStatus(name) || proxyManager.getProxyStatus(name) || { name, running: false };
}

module.exports = { loadModel, unloadModel, restartModel, getStatus, resolveEngine };
