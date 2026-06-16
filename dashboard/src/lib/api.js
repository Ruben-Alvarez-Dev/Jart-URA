// Live data layer: talks to Jart-URA's management API and normalizes the
// /v1/registry response into the shape the components consume.
//
// Real registry entry (server.js → modelToJson) provides:
//   name, port, source, provider, api_model, type,
//   supports_vision, supports_function_calling, max_tokens,
//   status, hostname, tailscale_addr, local
// Fields not yet emitted by the backend (context, gpu_layers, threads,
// cost_layer, certification, per-model metrics…) degrade to null / 0 and
// render as "—". They map to the planned /v1/health/full + FRONTIER BENCH.

const BASE = import.meta.env?.VITE_JART_URA_BASE || '/api';

export function mapRegistryEntry(e) {
  const source = e.source || (e.local ? 'local' : 'api');
  const node = e.hostname || e.node || 'local';
  return {
    name: e.name,
    node,
    source,
    port: e.port,
    status: e.status || 'stopped',
    type: e.type || 'chat',
    engine: source === 'local' ? e.provider || e.engine : undefined,
    provider: source === 'api' ? e.provider : undefined,
    model: e.api_model || e.model || e.name,
    context: e.context ?? null,
    maxTokens: e.max_tokens ?? null,
    gpuLayers: e.gpu_layers ?? null,
    threads: e.threads ?? null,
    defaultArgs: e.default_args || [],
    apiKeyEnv: e.api_key_env || null,
    baseUrl: e.base_url || null,
    costLayer: (e.cost_layer || 'ppu').toLowerCase(),
    caps: { vision: !!e.supports_vision, fnCall: !!e.supports_function_calling },
    cert: e.certification || '—',
    benchSource: e.benchmark_source || null,
    metrics: {
      tps: e.tps ?? e.metrics?.tps ?? 0,
      p50: e.p50 ?? e.metrics?.p50 ?? null,
      p95: e.p95 ?? e.metrics?.p95 ?? null,
      p99: e.p99 ?? e.metrics?.p99 ?? null,
      loadPct: e.load ?? e.metrics?.loadPct ?? 0,
      reqActive: e.req_active ?? 0,
      reqTotal: e.req_total ?? 0,
      uptime: e.uptime || '—',
    },
    pid: e.pid ?? null,
    restarts: e.restarts ?? 0,
    lastRestart: e.last_restart || null,
    logPath: e.log_path || null,
    hostname: node,
    tailscaleAddr: e.tailscale_addr || `${node}:${e.port}`,
  };
}

// GET /v1/registry → { hostname, local, peered, peers, unified }
export async function fetchRegistry(signal) {
  const res = await fetch(`${BASE}/v1/registry`, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const raw = data.unified || [...(data.local || []), ...(data.peered || [])];
  return {
    hostname: data.hostname || null,
    peers: data.peers || [],
    models: raw.map(mapRegistryEntry),
  };
}

// ── generic request helpers ──────────────────────────────────────────────────

async function get(path, signal) {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Returns the parsed body even on 4xx (our API answers { ok:false, errors:[…] }),
// so callers branch on `body.ok`. Only network / unexpected failures throw.
async function send(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok && data.ok === undefined && data.errors === undefined) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── engines ───────────────────────────────────────────────────────────────
export const fetchEngines = (signal) => get('/v1/engines', signal);
export const saveEngine = (name, def) => send('PUT', `/v1/engines/${encodeURIComponent(name)}`, def);
export const deleteEngine = (name) => send('DELETE', `/v1/engines/${encodeURIComponent(name)}`);

// ── disk ──────────────────────────────────────────────────────────────────
export const fetchScanPaths = (signal) => get('/v1/disk/paths', signal);
export const saveScanPaths = (paths) => send('PUT', '/v1/disk/paths', { paths });
export const fetchDiskModels = (refresh, signal) => get(`/v1/disk/models${refresh ? '?refresh=1' : ''}`, signal);

// ── models (CRUD + lifecycle) ────────────────────────────────────────────────
export const saveModel = (model) => send('POST', '/v1/models', model);
export const deleteModel = (name) => send('DELETE', `/v1/models/${encodeURIComponent(name)}`);
export const loadModel = (name) => send('POST', `/v1/models/${encodeURIComponent(name)}/load`);
export const unloadModel = (name) => send('POST', `/v1/models/${encodeURIComponent(name)}/unload`);
export const restartModel = (name) => send('POST', `/v1/models/${encodeURIComponent(name)}/restart`);
export const fetchLogs = (name, tail = 200, signal) => get(`/v1/models/${encodeURIComponent(name)}/logs?tail=${tail}`, signal);
