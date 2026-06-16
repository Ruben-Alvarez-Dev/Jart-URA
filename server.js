const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const configParser = require('./src/config-parser');
const configStore = require('./src/config-store');
const processManager = require('./src/process-manager');
const proxyManager = require('./src/proxy-manager');
const control = require('./src/control');
const meshRegistry = require('./src/mesh-registry');
const modelScanner = require('./src/model-scanner');

const CONFIG_PATH = process.env.JART_URA_CONFIG || path.join(__dirname, 'config', 'models.json');
const PID_DIR = process.env.JART_URA_PID_DIR || path.join(__dirname, 'pids');

let managementServer = null;
let ownHostname = os.hostname();
let diskCache = { at: 0, paths: null, models: [] };

function resolveOwnHostname() {
  try {
    const { execSync } = require('child_process');
    ownHostname = execSync('tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[\'Self\'][\'HostName\'])"', { timeout: 3000 })
      .toString().trim();
  } catch {
    ownHostname = os.hostname();
  }
}

// ── boot ──────────────────────────────────────────────────────────────────

function start() {
  resolveOwnHostname();
  const models = configParser.getModels(CONFIG_PATH);
  const serverConfig = configParser.getServerConfig(CONFIG_PATH);
  const engines = configParser.getEngines(CONFIG_PATH);

  console.log(`[jart-ura] Starting Jart-URA on ${ownHostname} with ${models.length} models...`);

  for (const model of models) {
    if (model.source === 'local') {
      const engineConfig = control.resolveEngine({ engines }, model);
      if (!engineConfig) { console.error(`[jart-ura] ${model.name}: engine '${model.engine}' undefined`); continue; }
      processManager.startModel({ ...model, model_path: path.isAbsolute(model.model_path) ? model.model_path : path.join(__dirname, model.model_path) }, engineConfig, PID_DIR)
        .then(() => console.log(`[jart-ura] Model '${model.name}' started on :${model.port}`))
        .catch((err) => console.error(`[jart-ura] Failed to start '${model.name}': ${err.message}`));
    } else if (model.source === 'api') {
      proxyManager.startProxy(model);
    }
  }

  managementServer = http.createServer(handleRequest);

  const mgmtPort = serverConfig.port || 9100;
  managementServer.listen(mgmtPort, serverConfig.host || '0.0.0.0', () => {
    console.log(`[jart-ura] Management on :${mgmtPort}`);
    console.log(`[jart-ura] ${models.length} models configured`);
    meshRegistry.startPolling(CONFIG_PATH);
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function shutdown() {
  console.log('[jart-ura] Shutting down...');
  meshRegistry.stopPolling();
  processManager.stopAll();
  proxyManager.stopAll();
  if (managementServer) managementServer.close();
  console.log('[jart-ura] Shutdown complete');
}

// ── http helpers ────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { resolve({ __parseError: true }); }
    });
    req.on('error', () => resolve({}));
  });
}

function humanUptime(ms) {
  if (!ms || ms < 1000) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

// ── registry projection ──────────────────────────────────────────────────────

function modelToJson(m, engines) {
  const isLocal = (m.source || 'local') === 'local';
  const running = isLocal ? processManager.isModelRunning(m.name) : proxyManager.isProxyRunning(m.name);
  const live = isLocal ? processManager.getModelStatus(m.name) : proxyManager.getProxyStatus(m.name);
  let status = running ? 'running' : 'stopped';
  if (isLocal && !running && live && live.lastExitCode != null && live.lastExitCode !== 0) status = 'failed';

  return {
    name: m.name,
    port: m.port,
    source: m.source || 'local',
    provider: m.provider || m.engine,
    engine: isLocal ? m.engine : undefined,
    api_model: m.api_model || m.name,
    model_path: m.model_path || null,
    type: m.type || 'chat',
    context: m.context ?? null,
    gpu_layers: m.gpu_layers ?? null,
    threads: m.threads ?? null,
    default_args: (isLocal && engines[m.engine]?.default_args) || [],
    extra_args: m.extra_args || [],
    api_key_env: m.api_key_env || null,
    base_url: m.base_url || null,
    cost_layer: m.cost_layer || null,
    role: m.role || null,
    supports_vision: !!m.supports_vision,
    supports_function_calling: !!m.supports_function_calling,
    max_tokens: m.max_tokens || 0,
    certification: m.certification || null,
    benchmark_source: m.benchmark_source || null,
    status,
    hostname: ownHostname,
    tailscale_addr: `${ownHostname}:${m.port}`,
    local: isLocal,
    pid: live?.pid ?? null,
    restarts: live?.restarts ?? 0,
    last_restart: live?.lastRestart ?? null,
    started_at: live?.startedAt ?? null,
    uptime: live?.uptimeMs ? humanUptime(live.uptimeMs) : '—',
    log_path: live?.logPath ?? null,
  };
}

// ── route handlers ───────────────────────────────────────────────────────────

function handleHealth(req, res) {
  const models = configParser.getModels(CONFIG_PATH);
  const status = { status: 'ok', hostname: ownHostname, peers: meshRegistry.getPeerHealth(), models: { total: models.length, running: 0, failed: 0 } };
  for (const m of models) {
    const running = (m.source || 'local') === 'local' ? processManager.isModelRunning(m.name) : proxyManager.isProxyRunning(m.name);
    if (running) status.models.running++; else status.models.failed++;
  }
  json(res, 200, status);
}

function handleModels(req, res, params, query) {
  const engines = configStore.readConfig(CONFIG_PATH).engines || {};
  const list = configParser.getModels(CONFIG_PATH).map((m) => modelToJson(m, engines));
  if (query.has('all')) list.push(...meshRegistry.getAllPeerModels());
  json(res, 200, { data: list });
}

function handleRegistry(req, res) {
  const engines = configStore.readConfig(CONFIG_PATH).engines || {};
  const local = configParser.getModels(CONFIG_PATH).map((m) => modelToJson(m, engines));
  const peered = meshRegistry.getAllPeerModels();
  json(res, 200, { hostname: ownHostname, local, peered, peers: meshRegistry.getPeers(), unified: [...local, ...peered] });
}

// engines
function handleEnginesList(req, res) {
  const engines = configStore.readConfig(CONFIG_PATH).engines || {};
  const inUse = {};
  for (const m of configStore.readConfig(CONFIG_PATH).models || []) {
    if ((m.source || 'local') === 'local' && m.engine) (inUse[m.engine] = inUse[m.engine] || []).push(m.name);
  }
  json(res, 200, { engines, in_use: inUse });
}

async function handleEngineUpsert(req, res, params) {
  const body = await readBody(req);
  if (body.__parseError) return json(res, 400, { ok: false, errors: ['invalid JSON body'] });
  const name = params.name || body.name;
  const def = { ...body };
  delete def.name;
  const result = configStore.upsertEngine(CONFIG_PATH, name, def);
  json(res, result.ok ? 200 : 400, result);
}

function handleEngineDelete(req, res, params) {
  const result = configStore.removeEngine(CONFIG_PATH, params.name);
  json(res, result.ok ? 200 : (result.inUseBy ? 409 : 404), result);
}

// disk
function handleScanPathsGet(req, res) {
  json(res, 200, { paths: configStore.getScanPaths(CONFIG_PATH) });
}

async function handleScanPathsPut(req, res) {
  const body = await readBody(req);
  if (body.__parseError) return json(res, 400, { ok: false, errors: ['invalid JSON body'] });
  const result = configStore.setScanPaths(CONFIG_PATH, body.paths || []);
  diskCache = { at: 0, paths: null, models: [] }; // invalidate
  json(res, result.ok ? 200 : 400, result);
}

function handleDiskModels(req, res, params, query) {
  const paths = configStore.getScanPaths(CONFIG_PATH);
  const fresh = query.has('refresh') || Date.now() - diskCache.at > 30000 || JSON.stringify(paths) !== JSON.stringify(diskCache.paths);
  if (fresh) {
    const models = modelScanner.scan(paths);
    diskCache = { at: Date.now(), paths, models };
  }
  json(res, 200, { paths, count: diskCache.models.length, scanned_at: new Date(diskCache.at).toISOString(), models: diskCache.models });
}

// models CRUD + control
async function handleModelUpsert(req, res, params) {
  const body = await readBody(req);
  if (body.__parseError) return json(res, 400, { ok: false, errors: ['invalid JSON body'] });
  if (params.name) body.name = params.name;
  const result = configStore.upsertModel(CONFIG_PATH, body);
  if (!result.ok) return json(res, 400, result);
  let loadResult = null;
  if (body.load === true || body.autoload === true) {
    loadResult = await control.loadModel(result.model.name, CONFIG_PATH, PID_DIR);
  }
  json(res, 200, { ok: true, model: result.model, load: loadResult });
}

function handleModelDelete(req, res, params) {
  control.unloadModel(params.name, CONFIG_PATH);
  const result = configStore.removeModel(CONFIG_PATH, params.name);
  json(res, result.ok ? 200 : 404, result);
}

async function handleModelLoad(req, res, params) {
  const result = await control.loadModel(params.name, CONFIG_PATH, PID_DIR);
  json(res, result.ok ? 200 : 400, result);
}

function handleModelUnload(req, res, params) {
  const result = control.unloadModel(params.name, CONFIG_PATH);
  json(res, 200, result);
}

async function handleModelRestart(req, res, params) {
  const result = await control.restartModel(params.name, CONFIG_PATH, PID_DIR);
  json(res, result.ok ? 200 : 400, result);
}

function handleModelLogs(req, res, params, query) {
  const status = control.getStatus(params.name, CONFIG_PATH);
  const logPath = status?.logPath;
  const tail = Math.max(1, Math.min(2000, parseInt(query.get('tail') || '200', 10) || 200));
  if (!logPath || !fs.existsSync(logPath)) return json(res, 200, { name: params.name, log_path: logPath || null, lines: [] });
  try {
    const stat = fs.statSync(logPath);
    const maxBytes = 256 * 1024;
    const fd = fs.openSync(logPath, 'r');
    const len = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, Math.max(0, stat.size - len));
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    json(res, 200, { name: params.name, log_path: logPath, lines: lines.slice(-tail) });
  } catch (err) {
    json(res, 500, { ok: false, errors: [err.message] });
  }
}

// ── router ────────────────────────────────────────────────────────────────

const routes = [
  ['GET', '/health', handleHealth],
  ['GET', '/v1/models', handleModels],
  ['GET', '/v1/registry', handleRegistry],
  ['GET', '/v1/engines', handleEnginesList],
  ['POST', '/v1/engines', handleEngineUpsert],
  ['PUT', '/v1/engines/:name', handleEngineUpsert],
  ['DELETE', '/v1/engines/:name', handleEngineDelete],
  ['GET', '/v1/disk/paths', handleScanPathsGet],
  ['PUT', '/v1/disk/paths', handleScanPathsPut],
  ['GET', '/v1/disk/models', handleDiskModels],
  ['POST', '/v1/models', handleModelUpsert],
  ['PUT', '/v1/models/:name', handleModelUpsert],
  ['DELETE', '/v1/models/:name', handleModelDelete],
  ['POST', '/v1/models/:name/load', handleModelLoad],
  ['POST', '/v1/models/:name/unload', handleModelUnload],
  ['POST', '/v1/models/:name/restart', handleModelRestart],
  ['GET', '/v1/models/:name/logs', handleModelLogs],
];

function matchRoute(method, pathname) {
  const reqParts = pathname.split('/').filter(Boolean);
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const patParts = pattern.split('/').filter(Boolean);
    if (patParts.length !== reqParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i].startsWith(':')) params[patParts[i].slice(1)] = decodeURIComponent(reqParts[i]);
      else if (patParts[i] !== reqParts[i]) { ok = false; break; }
    }
    if (ok) return { handler, params };
  }
  return null;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const match = matchRoute(req.method, url.pathname);
  if (!match) return json(res, 404, { error: 'Not found', path: url.pathname });
  try {
    await match.handler(req, res, match.params, url.searchParams);
  } catch (err) {
    console.error(`[jart-ura] handler error: ${err.stack || err.message}`);
    if (!res.headersSent) json(res, 500, { ok: false, errors: [err.message] });
  }
}

if (require.main === module) {
  start();
}

module.exports = { start, shutdown, handleRequest, modelToJson };
