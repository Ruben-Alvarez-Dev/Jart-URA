import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_PATH = path.join(os.tmpdir(), `jart-ura-test-${Date.now()}`, 'models.json');
const MODULE_PATH = path.join(process.cwd(), 'src', 'config-parser.js');

function writeConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function loadParser() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

describe('ConfigParser', () => {
  beforeEach(() => {
    try { fs.rmSync(path.dirname(CONFIG_PATH), { recursive: true }); } catch { /* empty */ }
  });

  describe('valid configuration', () => {
    it('parses a valid config with local and API models', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'qwen', port: 9001, source: 'local', engine: 'metal', model_path: 'models/qwen.gguf', context: 16384, gpu_layers: 99, threads: 6 },
          { name: 'gpt4', port: 9010, source: 'api', provider: 'openai', api_model: 'gpt-4o', api_key_env: 'OPENAI_API_KEY', base_url: 'https://api.openai.com/v1' },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);

      expect(models).toHaveLength(2);
      expect(models[0].name).toBe('qwen');
      expect(models[0].source).toBe('local');
      expect(models[1].name).toBe('gpt4');
      expect(models[1].source).toBe('api');
    });

    it('returns engines config', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [],
        engines: {
          metal: { bin: 'engines/metal/llama-metal', default_args: ['--mlock'] },
          coreml: { bin: 'engines/coreml/llama-coreml', default_args: [] },
        },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const engines = parser.getEngines(CONFIG_PATH);

      expect(engines.metal.bin).toBe('engines/metal/llama-metal');
      expect(engines.metal.default_args).toEqual(['--mlock']);
      expect(engines.coreml.bin).toBe('engines/coreml/llama-coreml');
    });

    it('finds model by name', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'alpha', port: 9001, source: 'local', engine: 'metal', model_path: 'models/a.gguf', context: 4096, gpu_layers: 0, threads: 2 },
          { name: 'beta', port: 9002, source: 'local', engine: 'metal', model_path: 'models/b.gguf', context: 4096, gpu_layers: 0, threads: 2 },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const beta = parser.getModelByName('beta', CONFIG_PATH);
      expect(beta).toBeDefined();
      expect(beta.port).toBe(9002);

      const missing = parser.getModelByName('nonexistent', CONFIG_PATH);
      expect(missing).toBeNull();
    });

    it('finds model by port', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'm1', port: 9001, source: 'local', engine: 'metal', model_path: 'models/m1.gguf', context: 4096, gpu_layers: 0, threads: 2 },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const model = parser.getModelByPort(9001, CONFIG_PATH);
      expect(model).toBeDefined();
      expect(model.name).toBe('m1');

      const missing = parser.getModelByPort(9999, CONFIG_PATH);
      expect(missing).toBeNull();
    });
  });

  describe('validation', () => {
    it('skips models with duplicate ports', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'a', port: 9001, source: 'local', engine: 'metal', model_path: 'models/a.gguf', context: 4096, gpu_layers: 0, threads: 2 },
          { name: 'b', port: 9001, source: 'local', engine: 'metal', model_path: 'models/b.gguf', context: 4096, gpu_layers: 0, threads: 2 },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('a');
    });

    it('skips models with invalid source', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'valid', port: 9001, source: 'local', engine: 'metal', model_path: 'models/v.gguf', context: 4096, gpu_layers: 0, threads: 2 },
          { name: 'invalid', port: 9002, source: 'unknown', engine: 'metal', model_path: 'models/i.gguf', context: 4096, gpu_layers: 0, threads: 2 },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('valid');
    });

    it('skips local models with missing engine config', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'bad', port: 9001, source: 'local', engine: 'nonexistent', model_path: 'models/b.gguf', context: 4096, gpu_layers: 0, threads: 2 },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);
      expect(models).toHaveLength(0);
    });

    it('skips local models with missing required fields', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'incomplete', port: 9001, source: 'local' },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);
      expect(models).toHaveLength(0);
    });

    it('skips API models with missing required fields', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'incomplete', port: 9010, source: 'api' },
        ],
        engines: {},
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);
      expect(models).toHaveLength(0);
    });

    it('skips models with ports outside range', () => {
      writeConfig({
        port_range: [9000, 9999],
        models: [
          { name: 'outside', port: 8001, source: 'local', engine: 'metal', model_path: 'models/o.gguf', context: 4096, gpu_layers: 0, threads: 2 },
        ],
        engines: { metal: { bin: 'engines/metal/llama-metal', default_args: [] } },
        server: { host: '0.0.0.0', port: 9100, log_dir: 'logs/', pid_dir: 'pids/' },
      });

      const parser = loadParser();
      const models = parser.getModels(CONFIG_PATH);
      expect(models).toHaveLength(0);
    });
  });
});
