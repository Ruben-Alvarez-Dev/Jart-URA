import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const cs = require('../src/config-store.js');

const TMP = path.join(os.tmpdir(), `jart-ura-cfgstore-${Date.now()}`);
const CONFIG = path.join(TMP, 'models.json');

const BASE = {
  port_range: [9000, 9099],
  models: [],
  engines: { metal: { bin: 'engines/metal/llama-metal', default_args: ['--no-mmap'] } },
  server: { host: '0.0.0.0', port: 9100 },
};

function reset() {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(BASE, null, 2));
}

describe('config-store', () => {
  beforeEach(reset);
  afterAll(() => { try { fs.rmSync(TMP, { recursive: true }); } catch { /* ignore */ } });

  it('creates a local model with defaults + auto-assigned port', () => {
    const r = cs.upsertModel(CONFIG, { name: 'primary', source: 'local', engine: 'metal', model_path: 'models/a.gguf' });
    expect(r.ok).toBe(true);
    expect(r.model.port).toBe(9000);
    expect(r.model.context).toBe(4096);
    expect(r.model.gpu_layers).toBe(99);
    expect(r.model.threads).toBe(4);
    expect(r.model.type).toBe('chat');
    const saved = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    expect(saved.models).toHaveLength(1);
  });

  it('rejects a local model with an undefined engine', () => {
    const r = cs.upsertModel(CONFIG, { name: 'x', source: 'local', engine: 'ghost', model_path: 'm.gguf' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/engine 'ghost' is not defined/);
  });

  it('rejects a duplicate port and keeps full parameterization on update', () => {
    cs.upsertModel(CONFIG, { name: 'a', source: 'local', engine: 'metal', model_path: 'a.gguf', port: 9001 });
    const dup = cs.upsertModel(CONFIG, { name: 'b', source: 'local', engine: 'metal', model_path: 'b.gguf', port: 9001 });
    expect(dup.ok).toBe(false);
    expect(dup.errors.join(' ')).toMatch(/already used by 'a'/);

    // update keeps extra/custom fields verbatim
    const upd = cs.upsertModel(CONFIG, { name: 'a', role: ['coding'], extra_args: ['--flash-attn'], context: 32768 });
    expect(upd.ok).toBe(true);
    expect(upd.model.role).toEqual(['coding']);
    expect(upd.model.extra_args).toEqual(['--flash-attn']);
    expect(upd.model.context).toBe(32768);
    expect(upd.model.port).toBe(9001); // preserved
  });

  it('creates an api model requiring provider/api_model/base_url', () => {
    const bad = cs.upsertModel(CONFIG, { name: 'gpt', source: 'api', provider: 'openai' });
    expect(bad.ok).toBe(false);
    const good = cs.upsertModel(CONFIG, { name: 'gpt', source: 'api', provider: 'openai', api_model: 'gpt-4o', base_url: 'https://api.openai.com/v1', port: 9050 });
    expect(good.ok).toBe(true);
  });

  it('upserts and removes engines, guarding ones in use', () => {
    const e = cs.upsertEngine(CONFIG, 'coreml', { bin: 'engines/coreml/llama-coreml', default_args: ['--no-mmap'], description: 'ANE' });
    expect(e.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).engines.coreml.description).toBe('ANE');

    cs.upsertModel(CONFIG, { name: 'uses-metal', source: 'local', engine: 'metal', model_path: 'a.gguf' });
    const blocked = cs.removeEngine(CONFIG, 'metal');
    expect(blocked.ok).toBe(false);
    expect(blocked.inUseBy).toContain('uses-metal');

    const okDel = cs.removeEngine(CONFIG, 'coreml');
    expect(okDel.ok).toBe(true);
  });

  it('rejects an engine without a bin', () => {
    const r = cs.upsertEngine(CONFIG, 'broken', { default_args: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/bin/);
  });

  it('gets default scan paths and persists custom ones', () => {
    const defaults = cs.getScanPaths(CONFIG);
    expect(defaults).toContain('models');
    const r = cs.setScanPaths(CONFIG, ['/data/models', '~/llms', '']);
    expect(r.ok).toBe(true);
    expect(r.paths).toEqual(['/data/models', '~/llms']); // blanks stripped
    expect(cs.getScanPaths(CONFIG)).toEqual(['/data/models', '~/llms']);
  });

  it('removes a model', () => {
    cs.upsertModel(CONFIG, { name: 'tmp', source: 'local', engine: 'metal', model_path: 'a.gguf' });
    expect(cs.removeModel(CONFIG, 'tmp').ok).toBe(true);
    expect(cs.removeModel(CONFIG, 'tmp').ok).toBe(false);
  });
});
