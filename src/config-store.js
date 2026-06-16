// config-store: the single mutating gateway to config/models.json.
//
// config-parser.js stays read-only and boot-tolerant (it logs + skips invalid
// entries). This module is the WRITE path: every create/update/delete of a
// model, an engine, or the disk scan-paths goes through here, with hard
// validation that returns structured errors (never just console noise) and an
// atomic write that keeps a .bak. models.json remains the single source of truth.

const fs = require('fs');
const path = require('path');

// Default places to look for real model files on disk. Repo-relative `models`
// plus the usual HuggingFace / Ollama caches and a generic ~/models. All are
// editable at runtime via setScanPaths / the /v1/disk/paths endpoint.
const DEFAULT_SCAN_PATHS = ['models', '~/models', '~/.cache/huggingface', '~/.ollama/models'];

const DEFAULT_PORT_RANGE = [9000, 9999];

// Sane defaults so a model can be created from the disk browser with just an
// engine + a file, and tuned later. Full parameterization is still allowed.
const LOCAL_DEFAULTS = { context: 4096, gpu_layers: 99, threads: 4, type: 'chat' };

function readConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  if (!Array.isArray(config.models)) config.models = [];
  if (!config.engines || typeof config.engines !== 'object') config.engines = {};
  return config;
}

// Atomic, backup-keeping write: dump to <path>.tmp, copy current → <path>.bak,
// then rename tmp over the target (atomic on the same filesystem).
function writeConfig(configPath, config) {
  const tmp = `${configPath}.tmp`;
  const bak = `${configPath}.bak`;
  const json = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(tmp, json, 'utf8');
  try {
    if (fs.existsSync(configPath)) fs.copyFileSync(configPath, bak);
  } catch { /* backup is best-effort */ }
  fs.renameSync(tmp, configPath);
  return config;
}

function getPortRange(config) {
  const r = config.port_range;
  return Array.isArray(r) && r.length === 2 ? r : DEFAULT_PORT_RANGE;
}

// Lowest free port in the range not already claimed by another model.
function nextFreePort(config, exclude = null) {
  const [min, max] = getPortRange(config);
  const used = new Set(
    (config.models || [])
      .filter((m) => m.name !== exclude)
      .map((m) => m.port)
      .filter((p) => typeof p === 'number'),
  );
  for (let p = min; p <= max; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

// ── validation ────────────────────────────────────────────────────────────

function validateEngine(name, engine) {
  const errors = [];
  if (!name || typeof name !== 'string') errors.push('engine name is required');
  if (!engine || typeof engine !== 'object') {
    errors.push('engine definition must be an object');
    return { ok: false, errors };
  }
  if (!engine.bin || typeof engine.bin !== 'string') errors.push('engine.bin (binary path) is required');
  if (engine.default_args !== undefined && !Array.isArray(engine.default_args)) {
    errors.push('engine.default_args must be an array of strings');
  }
  if (engine.env !== undefined && (typeof engine.env !== 'object' || Array.isArray(engine.env))) {
    errors.push('engine.env must be an object of NAME: value');
  }
  return { ok: errors.length === 0, errors };
}

function validateModel(config, model, { isUpdate = false } = {}) {
  const errors = [];
  const engines = config.engines || {};
  const [min, max] = getPortRange(config);

  if (!model || typeof model !== 'object') return { ok: false, errors: ['model must be an object'] };
  if (!model.name || typeof model.name !== 'string') errors.push('name is required');
  const source = model.source || 'local';
  if (!['local', 'api'].includes(source)) errors.push(`invalid source '${source}' (local|api)`);

  // port: optional on create (auto-assigned), but if present must be valid + unique
  if (model.port !== undefined && model.port !== null) {
    if (typeof model.port !== 'number' || model.port < min || model.port > max) {
      errors.push(`port ${model.port} outside range [${min}-${max}]`);
    }
    const clash = (config.models || []).find((m) => m.port === model.port && m.name !== model.name);
    if (clash) errors.push(`port ${model.port} already used by '${clash.name}'`);
  }

  if (source === 'local') {
    if (!model.engine) errors.push('engine is required for local models');
    else if (!engines[model.engine]) errors.push(`engine '${model.engine}' is not defined`);
    if (!model.model_path) errors.push('model_path is required for local models');
  } else if (source === 'api') {
    if (!model.provider) errors.push('provider is required for api models');
    if (!model.api_model) errors.push('api_model is required for api models');
    if (!model.base_url) errors.push('base_url is required for api models');
  }

  if (!isUpdate) {
    const exists = (config.models || []).some((m) => m.name === model.name);
    if (exists) errors.push(`model '${model.name}' already exists (use update)`);
  }

  return { ok: errors.length === 0, errors };
}

// ── mutations ───────────────────────────────────────────────────────────────

// Create or update a model. Fills local defaults and auto-assigns a port when
// missing. Unknown/extra fields (role, caps, cost_layer, extra_args…) are kept
// verbatim so the model is *fully* parameterizable.
function upsertModel(configPath, input) {
  const config = readConfig(configPath);
  const idx = (config.models || []).findIndex((m) => m.name === input.name);
  const isUpdate = idx >= 0;

  const model = { ...(isUpdate ? config.models[idx] : {}), ...input };
  model.source = model.source || 'local';
  if (model.source === 'local') {
    for (const [k, v] of Object.entries(LOCAL_DEFAULTS)) {
      if (model[k] === undefined || model[k] === null) model[k] = v;
    }
  }
  if (model.port === undefined || model.port === null) {
    model.port = nextFreePort(config, isUpdate ? model.name : null);
    if (model.port === null) return { ok: false, errors: ['no free port in range'] };
  }

  const { ok, errors } = validateModel(config, model, { isUpdate });
  if (!ok) return { ok: false, errors };

  if (isUpdate) config.models[idx] = model;
  else config.models.push(model);

  writeConfig(configPath, config);
  return { ok: true, model, config };
}

function removeModel(configPath, name) {
  const config = readConfig(configPath);
  const before = config.models.length;
  config.models = config.models.filter((m) => m.name !== name);
  const removed = config.models.length < before;
  if (removed) writeConfig(configPath, config);
  return { ok: removed, removed, errors: removed ? [] : [`model '${name}' not found`] };
}

// Create or update an engine. The whole definition is stored verbatim (minus
// the name), so engines are fully customizable: bin, default_args, env,
// description, and any extra knobs an engine wrapper may read.
function upsertEngine(configPath, name, engineDef) {
  const config = readConfig(configPath);
  const def = { ...engineDef };
  delete def.name;
  const { ok, errors } = validateEngine(name, def);
  if (!ok) return { ok: false, errors };
  config.engines[name] = def;
  writeConfig(configPath, config);
  return { ok: true, name, engine: def, config };
}

function removeEngine(configPath, name) {
  const config = readConfig(configPath);
  if (!config.engines[name]) return { ok: false, errors: [`engine '${name}' not found`] };
  const users = (config.models || []).filter((m) => m.source === 'local' && m.engine === name).map((m) => m.name);
  if (users.length) return { ok: false, errors: [`engine '${name}' is in use by: ${users.join(', ')}`], inUseBy: users };
  delete config.engines[name];
  writeConfig(configPath, config);
  return { ok: true, removed: true };
}

function getScanPaths(configPath) {
  const config = readConfig(configPath);
  return Array.isArray(config.model_scan_paths) && config.model_scan_paths.length
    ? config.model_scan_paths
    : DEFAULT_SCAN_PATHS.slice();
}

function setScanPaths(configPath, paths) {
  if (!Array.isArray(paths)) return { ok: false, errors: ['paths must be an array of strings'] };
  const clean = paths.map((p) => String(p).trim()).filter(Boolean);
  const config = readConfig(configPath);
  config.model_scan_paths = clean;
  writeConfig(configPath, config);
  return { ok: true, paths: clean };
}

module.exports = {
  DEFAULT_SCAN_PATHS,
  readConfig,
  writeConfig,
  nextFreePort,
  validateEngine,
  validateModel,
  upsertModel,
  removeModel,
  upsertEngine,
  removeEngine,
  getScanPaths,
  setScanPaths,
};
