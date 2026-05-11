const http = require('http');
const path = require('path');

const configParser = require('./src/config-parser');
const processManager = require('./src/process-manager');
const apiProxy = require('./src/api-proxy');

const CONFIG_PATH = process.env.JART_URA_CONFIG || path.join(__dirname, 'config', 'models.json');
const pidDir = process.env.JART_URA_PID_DIR || path.join(__dirname, 'pids');

const modelServers = [];
let managementServer = null;

function start() {
  const models = configParser.getModels(CONFIG_PATH);
  const serverConfig = configParser.getServerConfig(CONFIG_PATH);
  const engines = configParser.getEngines(CONFIG_PATH);

  console.log(`[jart-ura] Starting Jart-URA with ${models.length} models...`);

  for (const model of models) {
    if (model.source === 'local') {
      const engineConfig = engines[model.engine];
      processManager.startModel(model, engineConfig, pidDir).then(() => {
        console.log(`[jart-ura] Model '${model.name}' started on :${model.port}`);
      }).catch((err) => {
        console.error(`[jart-ura] Failed to start model '${model.name}': ${err.message}`);
      });
    } else if (model.source === 'api') {
      const server = apiProxy.createProxy(model);
      modelServers.push(server);
    }
  }

  managementServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      handleHealth(req, res, models);
    } else if (req.url === '/v1/models') {
      handleModels(req, res, models);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const mgmtPort = serverConfig.port || 9100;
  managementServer.listen(mgmtPort, serverConfig.host || '0.0.0.0', () => {
    console.log(`[jart-ura] Management on :${mgmtPort}`);
    console.log(`[jart-ura] ${models.length} models configured`);
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function handleHealth(req, res, models) {
  const status = { status: 'ok', models: { total: models.length, running: 0, failed: 0 } };
  for (const model of models) {
    if (model.source === 'local') {
      if (processManager.isModelRunning(model.name)) {
        status.models.running++;
      } else {
        status.models.failed++;
      }
    } else if (model.source === 'api') {
      status.models.running++;
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

function handleModels(req, res, models) {
  const modelList = models.map((m) => ({
    name: m.name,
    port: m.port,
    source: m.source,
    provider: m.provider || m.engine,
    api_model: m.api_model,
    type: m.type || 'chat',
    status: m.source === 'local' ? (processManager.isModelRunning(m.name) ? 'running' : 'stopped') : 'running',
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: modelList }));
}

function shutdown() {
  console.log('[jart-ura] Shutting down...');
  processManager.stopAll();
  for (const server of modelServers) {
    try { server.close(); } catch { /* ignore */ }
  }
  if (managementServer) {
    managementServer.close();
  }
  console.log('[jart-ura] Shutdown complete');
}

if (require.main === module) {
  start();
}

module.exports = { start, shutdown };
