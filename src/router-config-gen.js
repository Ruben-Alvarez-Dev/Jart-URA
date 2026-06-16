#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const JART_URA_URL = process.env.JART_URA_URL || 'http://localhost:9100';
const ROUTER_CONFIG = process.env.ROUTER_CONFIG || path.join(__dirname, '..', 'LLM_ROUTER', 'config.yaml');

function modelToLiteLLM(model) {
  const addr = model.tailscale_addr || `host.docker.internal:${model.port}`;
  const base = {
    model_name: model.name,
    litellm_params: {},
    model_info: {
      mode: model.type || 'chat',
      max_tokens: model.max_tokens || 0,
    },
  };

  if (model.source === 'local' || model.provider === 'metal' || model.provider === 'coreml') {
    base.litellm_params.model = `openai/${model.name}`;
    base.litellm_params.api_base = `http://${addr}/v1`;
  } else if (model.provider === 'openrouter') {
    base.litellm_params.model = `openrouter/${model.api_model}`;
    base.litellm_params.api_key = 'os.environ/OPENROUTER_API_KEY';
  } else if (model.provider === 'openai') {
    base.litellm_params.model = `openai/${model.api_model}`;
    base.litellm_params.api_key = 'os.environ/OPENAI_API_KEY';
  } else if (model.provider === 'anthropic') {
    base.litellm_params.model = `anthropic/${model.api_model}`;
    base.litellm_params.api_key = 'os.environ/ANTHROPIC_API_KEY';
  } else {
    base.litellm_params.model = `openai/${model.api_model || model.name}`;
    base.litellm_params.api_base = `http://${addr}/v1`;
  }

  if (model.supports_vision) base.model_info.supports_vision = true;
  if (model.supports_function_calling) base.model_info.supports_function_calling = true;
  if (model.max_tokens) base.model_info.max_tokens = model.max_tokens;

  return base;
}

async function fetchRegistry() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${JART_URA_URL}/v1/registry`);
    http.get(url.toString(), { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  let registry;
  try {
    registry = await fetchRegistry();
  } catch (e) {
    console.error(`[gen] Cannot reach Jart-URA at ${JART_URA_URL}: ${e.message}`);
    process.exit(1);
  }

  const models = registry.unified || [...(registry.local || []), ...(registry.peered || [])];

  const modelList = [];
  for (const m of models) {
    if (m.status === 'stopped' || m.health === 'unreachable') continue;
    modelList.push(modelToLiteLLM(m));
  }

  try {
    const existing = fs.readFileSync(ROUTER_CONFIG, 'utf8');
    const doc = yaml.parseDocument(existing);

    doc.set('model_list', modelList);

    fs.writeFileSync(ROUTER_CONFIG, doc.toString());
    console.log(`[gen] ${modelList.length} models written to ${ROUTER_CONFIG}`);
  } catch (e) {
    console.error(`[gen] Failed to update router config: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { fetchRegistry, modelToLiteLLM, main };
