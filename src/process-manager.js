const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const processes = {};

function buildArgs(model, engineConfig) {
  const args = [
    ...(engineConfig.default_args || []),
    '--port', String(model.port),
    '--host', '0.0.0.0',
    '-m', model.model_path,
    '--ctx-size', String(model.context),
    '--threads', String(model.threads),
    '-ngl', String(model.gpu_layers),
  ];
  if (model.type === 'embedding') args.push('--embedding');
  return args;
}

function startModel(model, engineConfig, pidDir, maxRetries = 3, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const binPath = engineConfig.bin;
    const buildArgsRes = buildArgs(model, engineConfig);
    const name = model.name;

    if (processes[name]) {
      reject(new Error(`Model ${name} already running`));
      return;
    }

    const child = spawn(binPath, buildArgsRes, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child._stopped = false;

    processes[name] = {
      child,
      model,
      stopped: false,
    };

    if (pidDir) {
      const pidFile = path.join(pidDir, `${name}.pid`);
      fs.writeFileSync(pidFile, String(child.pid));
    }

    child.on('exit', (code) => {
      if (child._stopped) return;
      const nextRetry = retryCount + 1;
      if (nextRetry <= maxRetries) {
        delete processes[name];
        console.log(`[jart-ura] ${name} exited (code ${code}), restarting (${nextRetry}/${maxRetries})`);
        startModel(model, engineConfig, pidDir, maxRetries, nextRetry);
      } else {
        console.error(`[jart-ura] ${name}: max retries (${maxRetries}) reached, giving up`);
        delete processes[name];
      }
    });

    child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));

    // Wait briefly for the process to start
    setTimeout(() => resolve(child), 100);
  });
}

function stopModel(name) {
  const entry = processes[name];
  if (!entry) return;
  if (entry.child) entry.child._stopped = true;
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

module.exports = { startModel, stopModel, stopAll, isModelRunning, getModelPid, processes };
