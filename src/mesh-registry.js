const http = require('http');
const https = require('https');

let peerModels = new Map();
let peers = [];
let pollInterval = null;
let pollMs = 15000;

function loadPeers(configPath) {
  const fs = require('fs');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    peers = config.peers || [];
    pollMs = config.mesh_poll_ms || 15000;
    return peers;
  } catch {
    peers = [];
    return [];
  }
}

function fetchPeerModels(hostname) {
  return new Promise((resolve) => {
    const url = new URL(`http://${hostname}:9100/v1/models`);
    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.get(url.toString(), { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ hostname, models: parsed.data || [], ok: true });
        } catch {
          resolve({ hostname, models: [], ok: false, error: 'parse' });
        }
      });
    });
    req.on('error', () => { resolve({ hostname, models: [], ok: false, error: 'unreachable' }); });
    req.on('timeout', () => { req.destroy(); resolve({ hostname, models: [], ok: false, error: 'timeout' }); });
  });
}

async function refresh(hostname) {
  if (!hostname) {
    for (const peer of peers) {
      const result = await fetchPeerModels(peer);
      const models = result.models.map((m) => ({
        ...m,
        hostname: result.hostname,
        tailscale_addr: `${result.hostname}:${m.port}`,
        health: result.ok ? (m.status || 'unknown') : 'unreachable',
        peered: true,
      }));
      peerModels.set(result.hostname, models);
    }
  } else {
    const result = await fetchPeerModels(hostname);
    const models = result.models.map((m) => ({
      ...m,
      hostname: result.hostname,
      tailscale_addr: `${result.hostname}:${m.port}`,
      health: result.ok ? (m.status || 'unknown') : 'unreachable',
      peered: true,
    }));
    peerModels.set(result.hostname, models);
  }
}

function startPolling(configPath) {
  loadPeers(configPath);
  if (pollInterval) clearInterval(pollInterval);
  if (peers.length === 0) return;
  console.log(`[mesh] Polling ${peers.length} peers every ${pollMs}ms: ${peers.join(', ')}`);
  refresh();
  pollInterval = setInterval(() => refresh(), pollMs);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function getAllPeerModels() {
  const all = [];
  for (const [, models] of peerModels) {
    all.push(...models);
  }
  return all;
}

function getPeerHealth() {
  const health = {};
  for (const [hostname, models] of peerModels) {
    health[hostname] = models.length > 0 ? (models[0].health === 'unreachable' ? 'unreachable' : 'connected') : 'empty';
  }
  return health;
}

function getPeers() {
  return peers;
}

module.exports = { loadPeers, startPolling, stopPolling, getAllPeerModels, getPeerHealth, getPeers, refresh };
