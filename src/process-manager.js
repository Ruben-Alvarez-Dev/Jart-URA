const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// name -> { child, model, engineConfig, stopped, logStream }
const processes = {};
// name -> { startedAt, restarts, lastRestart, lastExitCode, logPath, pid }
// Kept across automatic restarts (the `processes` entry is recreated each time)
// so /v1/registry and getModelStatus can report a stable process history.
const stats = {};

function resolveLogDir() {
  return process.env.JART_URA_LOG_DIR || path.join(process.cwd(), 'logs');
}

// Build llama-server-style args. Every flag is conditional on a value being
// present, so the engine's own default_args plus an optional per-model
// extra_args[] give full control while the common case still "just works".
function buildArgs(model, engineConfig) {
  const args = [...(engineConfig.default_args || [])];
  args.push('--port', String(model.port));
  args.push('--host', model.host || '0.0.0.0');
  if (model.model_path) args.push('-m', model.model_path);
  if (model.context != null) args.push('--ctx-size', String(model.context));
  if (model.threads != null) args.push('--threads', String(model.threads));
  if (model.gpu_layers != null) args.push('-ngl', String(model.gpu_layers));
  if (model.type === 'embedding') args.push('--embedding');
  if (Array.isArray(model.extra_args)) args.push(...model.extra_args.map(String));
  return args;
}

function startModel(model, engineConfig, pidDir, maxRetries = 3, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const name = model.name;
    const binPath = engineConfig.bin;

    if (processes[name]) {
      reject(new Error(`Model ${name} already running`));
      return;
    }

    const logDir = resolveLogDir();
    try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
    const logPath = path.join(logDir, `${name}.log`);
    let logStream = null;
    try { logStream = fs.createWriteStream(logPath, { flags: 'a' }); } catch { /* ignore */ }

    const child = spawn(binPath, buildArgs(model, engineConfig), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(engineConfig.env || {}) },
    });

    child._stopped = false;
    processes[name] = { child, model, engineConfig, stopped: false, logStream };

    // Fresh start resets the history; an automatic restart (retryCount>0) keeps it.
    if (!stats[name] || retryCount === 0) {
      stats[name] = {
        startedAt: Date.now(), restarts: retryCount,
        lastRestart: retryCount > 0 ? new Date().toISOString() : null,
        lastExitCode: null, logPath, pid: child.pid,
      };
    } else {
      stats[name].pid = child.pid;
      stats[name].logPath = logPath;
    }

    if (pidDir) {
      try { fs.writeFileSync(path.join(pidDir, `${name}.pid`), String(child.pid)); } catch { /* ignore */ }
    }

    if (logStream) {
      child.stdout.on('data', (d) => { try { logStream.write(d); } catch { /* ignore */ } });
      child.stderr.on('data', (d) => { try { logStream.write(d); } catch { /* ignore */ } });
    }

    child.on('exit', (code) => {
      if (stats[name]) stats[name].lastExitCode = code;
      try { logStream?.end(); } catch { /* ignore */ }
      if (child._stopped) return;
      const nextRetry = retryCount + 1;
      if (nextRetry <= maxRetries) {
        delete processes[name];
        if (stats[name]) { stats[name].restarts = nextRetry; stats[name].lastRestart = new Date().toISOString(); }
        console.log(`[jart-ura] ${name} exited (code ${code}), restarting (${nextRetry}/${maxRetries})`);
        startModel(model, engineConfig, pidDir, maxRetries, nextRetry);
      } else {
        console.error(`[jart-ura] ${name}: max retries (${maxRetries}) reached, giving up`);
        delete processes[name];
      }
    });

    // Resolve once the child process has started (stdout first data or 2s timeout)
    const ready = new Promise((r) => {
      const timer = setTimeout(() => r(), 2000);
      child.stdout.once('data', () => { clearTimeout(timer); r(); });
      child.stderr.once('data', () => { clearTimeout(timer); r(); });
    });
    ready.then(() => resolve(child));
  });
}

function stopModel(name) {
  const entry = processes[name];
  if (!entry) return;
  if (entry.child) entry.child._stopped = true;
  try { entry.logStream?.end(); } catch { /* ignore */ }
  try { entry.child?.kill('SIGTERM'); } catch { /* already dead */ }
  delete processes[name];
}

function stopAll() {
  for (const name of Object.keys(processes)) {
    stopModel(name);
  }
}

function isModelRunning(name) {
  const entry = processes[name];
  if (!entry) return false;
  try {
    return entry.child.exitCode === null;
  } catch {
    return false;
  }
}

function getModelPid(name) {
  const entry = processes[name];
  return entry?.child?.pid || null;
}

// Stable status used by the control layer / registry enrichment.
function getModelStatus(name) {
  const s = stats[name];
  const running = isModelRunning(name);
  if (!s && !running) return null;
  return {
    name,
    running,
    pid: running ? getModelPid(name) : null,
    startedAt: s ? new Date(s.startedAt).toISOString() : null,
    uptimeMs: s && running ? Date.now() - s.startedAt : 0,
    restarts: s ? s.restarts : 0,
    lastRestart: s ? s.lastRestart : null,
    lastExitCode: s ? s.lastExitCode : null,
    logPath: s ? s.logPath : path.join(resolveLogDir(), `${name}.log`),
  };
}

module.exports = {
  startModel, stopModel, stopAll, isModelRunning, getModelPid, getModelStatus, processes, stats,
};
