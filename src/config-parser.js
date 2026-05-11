const fs = require('fs');
const path = require('path');

const VALID_SOURCES = ['local', 'api'];
const LOCAL_REQUIRED = ['name', 'port', 'engine', 'model_path', 'context', 'gpu_layers', 'threads'];
const API_REQUIRED = ['name', 'port', 'provider', 'api_model', 'api_key_env', 'base_url'];

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function validateLocalModel(model, engines) {
  for (const field of LOCAL_REQUIRED) {
    if (model[field] === undefined || model[field] === null) {
      console.error(`[config] ${model.name}: missing required field '${field}'`);
      return false;
    }
  }
  if (!engines[model.engine]) {
    console.error(`[config] ${model.name}: engine '${model.engine}' not found in engines config`);
    return false;
  }
  return true;
}

function validateApiModel(model) {
  for (const field of API_REQUIRED) {
    if (model[field] === undefined || model[field] === null) {
      console.error(`[config] ${model.name}: missing required field '${field}'`);
      return false;
    }
  }
  return true;
}

function getModels(configPath) {
  const config = loadConfig(configPath);
  const models = [];
  const usedPorts = new Set();
  const [rangeMin, rangeMax] = config.port_range || [9000, 9999];

  for (const model of config.models || []) {
    if (!VALID_SOURCES.includes(model.source)) {
      console.error(`[config] ${model.name}: invalid source '${model.source}'`);
      continue;
    }

    if (model.port < rangeMin || model.port > rangeMax) {
      console.error(`[config] ${model.name}: port ${model.port} outside range [${rangeMin}-${rangeMax}]`);
      continue;
    }

    if (usedPorts.has(model.port)) {
      console.error(`[config] ${model.name}: port ${model.port} already in use`);
      continue;
    }

    let valid = false;
    if (model.source === 'local') {
      valid = validateLocalModel(model, config.engines || {});
    } else if (model.source === 'api') {
      valid = validateApiModel(model);
    }

    if (valid) {
      usedPorts.add(model.port);
      models.push({ ...model });
    }
  }

  return models;
}

function getModelByName(name, configPath) {
  return getModels(configPath).find((m) => m.name === name) || null;
}

function getModelByPort(port, configPath) {
  return getModels(configPath).find((m) => m.port === port) || null;
}

function getEngines(configPath) {
  const config = loadConfig(configPath);
  return config.engines || {};
}

function getServerConfig(configPath) {
  const config = loadConfig(configPath);
  return config.server || { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' };
}

module.exports = { getModels, getModelByName, getModelByPort, getEngines, getServerConfig };
