import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const scanner = require('../src/model-scanner.js');

const TMP = path.join(os.tmpdir(), `jart-ura-scan-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(path.join(TMP, 'nested', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'qwen2.5-7b-instruct-Q4_K_M.gguf'), 'x'.repeat(2048));
  fs.writeFileSync(path.join(TMP, 'bge-m3-Q8_0.gguf'), 'y'.repeat(1024));
  fs.writeFileSync(path.join(TMP, 'nested', 'model.safetensors'), 'z'.repeat(512));
  fs.writeFileSync(path.join(TMP, 'notes.txt'), 'ignore me');
  // CoreML/ANE bundle = a directory ending in .mlmodelc
  fs.mkdirSync(path.join(TMP, 'kokoro.mlmodelc'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'kokoro.mlmodelc', 'model.mil'), 'w'.repeat(4096));
});

afterAll(() => { try { fs.rmSync(TMP, { recursive: true }); } catch { /* ignore */ } });

describe('model-scanner', () => {
  it('finds real model files and ignores non-models', () => {
    const found = scanner.scan([TMP]);
    const names = found.map((f) => f.name);
    expect(names).toContain('qwen2.5-7b-instruct-Q4_K_M.gguf');
    expect(names).toContain('bge-m3-Q8_0.gguf');
    expect(names).toContain('model.safetensors');
    expect(names).not.toContain('notes.txt');
  });

  it('treats a .mlmodelc directory as a single bundle with summed size', () => {
    const bundle = scanner.scan([TMP]).find((f) => f.name === 'kokoro.mlmodelc');
    expect(bundle).toBeTruthy();
    expect(bundle.kind).toBe('bundle');
    expect(bundle.engineHint).toBe('coreml');
    expect(bundle.size).toBeGreaterThanOrEqual(4096);
  });

  it('guesses quant + family + engine hint', () => {
    const q = scanner.scan([TMP]).find((f) => f.name.startsWith('qwen'));
    expect(q.quant).toBe('Q4_K_M');
    expect(q.family).toBe('qwen');
    expect(q.engineHint).toBe('metal');
    expect(q.sizeHuman).toMatch(/KB|B/);
  });

  it('ignores missing paths without throwing', () => {
    const found = scanner.scan(['/no/such/dir/anywhere', TMP]);
    expect(found.length).toBeGreaterThan(0);
  });
});
