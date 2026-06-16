// model-scanner: find the REAL model files that exist on disk.
//
// Walks the configured scan paths (repo models/, HF cache, Ollama, ~/models…)
// and returns concrete files — never invented entries. Recognises single-file
// formats (.gguf/.safetensors/.onnx/.bin) and Apple bundle directories
// (.mlmodelc/.mlpackage, i.e. CoreML/ANE). Each hit carries enough metadata
// (size, mtime, quant + family guess, engine hint) to pre-fill a model form.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE_EXTS = ['.gguf', '.safetensors', '.onnx', '.bin'];
const BUNDLE_EXTS = ['.mlmodelc', '.mlpackage'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache_lock', 'blobs']);

const ENGINE_HINT = {
  '.gguf': 'metal',
  '.mlmodelc': 'coreml',
  '.mlpackage': 'coreml',
  '.onnx': 'onnx',
  '.safetensors': 'transformers',
  '.bin': 'transformers',
};

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function humanSize(bytes) {
  if (bytes == null) return null;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Q4_K_M, Q5_K_S, Q8_0, IQ3_XXS, F16, BF16, FP16…
function guessQuant(name) {
  const m = name.match(/\b(IQ\d[\w]*|Q\d(?:_[Kk0-9]+)*(?:_[SMLsml])?|F16|F32|BF16|FP16|FP8|INT8|INT4)\b/);
  return m ? m[1].toUpperCase() : null;
}

const FAMILIES = [
  'qwen', 'llama', 'mistral', 'mixtral', 'gemma', 'phi', 'deepseek', 'yi',
  'command-r', 'codestral', 'starcoder', 'bge', 'gte', 'nomic', 'e5',
  'whisper', 'kokoro', 'parakeet', 'llava', 'minicpm', 'internlm', 'glm', 'falcon',
];

function guessFamily(name) {
  const low = name.toLowerCase();
  return FAMILIES.find((f) => low.includes(f)) || null;
}

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// Bounded recursive size for bundle directories (CoreML can be many files).
function bundleSize(dir, cap = 50000) {
  let total = 0;
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (count++ > cap) return total;
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        const st = safeStat(full);
        if (st) total += st.size;
      }
    }
  }
  return total;
}

function makeEntry(fullPath, kind) {
  const ext = BUNDLE_EXTS.find((b) => fullPath.endsWith(b)) || path.extname(fullPath).toLowerCase();
  const st = safeStat(fullPath);
  const name = path.basename(fullPath);
  const size = kind === 'bundle' ? bundleSize(fullPath) : (st ? st.size : null);
  return {
    path: fullPath,
    name,
    dir: path.dirname(fullPath),
    ext,
    kind, // 'file' | 'bundle'
    size,
    sizeHuman: humanSize(size),
    mtime: st ? st.mtime.toISOString() : null,
    quant: guessQuant(name),
    family: guessFamily(name),
    engineHint: ENGINE_HINT[ext] || null,
  };
}

// Walk one root. Bounded by maxDepth and maxEntries; loop-safe via realpath set.
function scanRoot(root, { maxDepth = 6, maxEntries = 4000 } = {}) {
  const results = [];
  const seenDirs = new Set();
  const start = expandHome(root);
  const startStat = safeStat(start);
  if (!startStat || !startStat.isDirectory()) return results;

  const stack = [[start, 0]];
  while (stack.length) {
    if (results.length >= maxEntries) break;
    const [dir, depth] = stack.pop();

    // Bundle directories are themselves a result — don't descend into them.
    if (BUNDLE_EXTS.some((b) => dir.endsWith(b))) {
      results.push(makeEntry(dir, 'bundle'));
      continue;
    }

    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      const isBundle = BUNDLE_EXTS.some((b) => e.name.endsWith(b));
      if (e.isDirectory() || (e.isSymbolicLink() && safeStat(full)?.isDirectory())) {
        if (isBundle) { results.push(makeEntry(full, 'bundle')); continue; }
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        if (depth < maxDepth) stack.push([full, depth + 1]);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (FILE_EXTS.includes(ext)) results.push(makeEntry(full, 'file'));
      }
    }
  }
  return results;
}

// Scan many roots, dedup by realpath, newest first.
function scan(paths, opts = {}) {
  const roots = (paths && paths.length ? paths : []).map(String);
  const byPath = new Map();
  for (const root of roots) {
    for (const entry of scanRoot(root, opts)) {
      let key = entry.path;
      try { key = fs.realpathSync(entry.path); } catch { /* keep raw */ }
      if (!byPath.has(key)) byPath.set(key, entry);
    }
  }
  return [...byPath.values()].sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
}

module.exports = { scan, scanRoot, expandHome, humanSize, guessQuant, guessFamily, FILE_EXTS, BUNDLE_EXTS };
