import { useEffect, useState } from 'react';
import { Cpu, Plus, Save, Trash2, Loader2 } from 'lucide-react';
import { fetchEngines, saveEngine, deleteEngine } from '../lib/api';

const inputCls = 'h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-emerald-600';
const areaCls = 'min-h-[64px] w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-600';

// engine def <-> form. default_args is an array; env is an object. The advanced
// JSON box carries any extra keys so engines are fully customizable.
function toForm(name, def = {}) {
  const known = ['bin', 'default_args', 'env', 'description'];
  const extra = Object.fromEntries(Object.entries(def).filter(([k]) => !known.includes(k)));
  return {
    name: name || '',
    bin: def.bin || '',
    default_args: (def.default_args || []).join('\n'),
    env: Object.entries(def.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    description: def.description || '',
    advanced: Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '',
  };
}

function fromForm(f) {
  const def = {};
  if (f.bin.trim()) def.bin = f.bin.trim();
  const args = f.default_args.split('\n').map((s) => s.trim()).filter(Boolean);
  if (args.length) def.default_args = args;
  const env = {};
  for (const line of f.env.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (Object.keys(env).length) def.env = env;
  if (f.description.trim()) def.description = f.description.trim();
  if (f.advanced.trim()) {
    try { Object.assign(def, JSON.parse(f.advanced)); } catch { /* surfaced on save */ }
  }
  return def;
}

export default function EnginesPanel({ onChanged }) {
  const [engines, setEngines] = useState({});
  const [inUse, setInUse] = useState({});
  const [sel, setSel] = useState(null); // engine name or '__new__'
  const [form, setForm] = useState(toForm(''));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    try {
      const data = await fetchEngines();
      setEngines(data.engines || {});
      setInUse(data.in_use || {});
    } catch (e) { setMsg({ kind: 'err', text: e.message }); }
  };
  useEffect(() => { load(); }, []);

  function pick(name) {
    setMsg(null);
    setSel(name);
    setForm(name === '__new__' ? toForm('') : toForm(name, engines[name]));
  }
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  async function save() {
    setBusy(true); setMsg(null);
    if (form.advanced.trim()) {
      try { JSON.parse(form.advanced); } catch { setMsg({ kind: 'err', text: 'JSON avanzado inválido' }); setBusy(false); return; }
    }
    const res = await saveEngine(form.name.trim(), fromForm(form));
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: (res.errors || ['error']).join('; ') }); return; }
    setMsg({ kind: 'ok', text: `engine '${form.name}' guardado` });
    await load(); onChanged && onChanged();
    setSel(form.name.trim());
  }

  async function remove(name) {
    setBusy(true); setMsg(null);
    const res = await deleteEngine(name);
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: (res.errors || ['no se pudo borrar']).join('; ') }); return; }
    setMsg({ kind: 'ok', text: `engine '${name}' borrado` });
    setSel(null); await load(); onChanged && onChanged();
  }

  return (
    <div className="flex h-full min-h-0">
      {/* list */}
      <div className="w-64 shrink-0 overflow-auto border-r border-zinc-800">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Engines</span>
          <button onClick={() => pick('__new__')} className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:border-emerald-600">
            <Plus className="h-3 w-3" /> Nuevo
          </button>
        </div>
        {Object.keys(engines).length === 0 && <div className="px-3 py-4 text-[11px] text-zinc-600">Sin engines.</div>}
        {Object.entries(engines).map(([name, def]) => (
          <button key={name} onClick={() => pick(name)}
            className={`flex w-full flex-col items-start border-b border-zinc-900 px-3 py-2 text-left hover:bg-zinc-900/60 ${sel === name ? 'bg-zinc-800/70' : ''}`}>
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-100"><Cpu className="h-3.5 w-3.5 text-zinc-500" /> {name}</span>
            <span className="mt-0.5 truncate font-mono text-[10px] text-zinc-500" title={def.bin}>{def.bin}</span>
            {inUse[name]?.length > 0 && <span className="mt-0.5 text-[10px] text-amber-400/80">en uso: {inUse[name].join(', ')}</span>}
          </button>
        ))}
      </div>

      {/* editor */}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!sel ? (
          <div className="grid h-full place-items-center text-sm text-zinc-600">Elige un engine o crea uno nuevo.</div>
        ) : (
          <div className="mx-auto max-w-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">{sel === '__new__' ? 'Nuevo engine' : `Engine · ${sel}`}</h2>
              {sel !== '__new__' && (
                <button onClick={() => remove(sel)} disabled={busy}
                  className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                  <Trash2 className="h-3.5 w-3.5" /> Borrar
                </button>
              )}
            </div>

            <label className="mb-2 block">
              <span className="text-[11px] text-zinc-400">Nombre</span>
              <input className={inputCls} value={form.name} onChange={set('name')} disabled={sel !== '__new__'} placeholder="metal · coreml · planar3 · vllm…" />
            </label>
            <label className="mb-2 block">
              <span className="text-[11px] text-zinc-400">bin · ruta del binario del engine</span>
              <input className={inputCls} value={form.bin} onChange={set('bin')} placeholder="engines/metal/llama-metal" />
            </label>
            <label className="mb-2 block">
              <span className="text-[11px] text-zinc-400">default_args · un argumento por línea</span>
              <textarea className={areaCls} value={form.default_args} onChange={set('default_args')} placeholder={'--no-mmap\n--mlock'} />
            </label>
            <label className="mb-2 block">
              <span className="text-[11px] text-zinc-400">env · NAME=value por línea</span>
              <textarea className={areaCls} value={form.env} onChange={set('env')} placeholder={'GGML_METAL=1'} />
            </label>
            <label className="mb-2 block">
              <span className="text-[11px] text-zinc-400">descripción</span>
              <input className={inputCls} value={form.description} onChange={set('description')} placeholder="llama.cpp Metal (Apple Silicon)" />
            </label>
            <label className="mb-2 block">
              <span className="text-[11px] text-zinc-400">avanzado · JSON con claves extra (opcional)</span>
              <textarea className={areaCls} value={form.advanced} onChange={set('advanced')} placeholder={'{ "health_path": "/health", "ready_timeout_ms": 30000 }'} />
            </label>

            {msg && (
              <div className={`mb-2 rounded-md border px-3 py-2 text-[11px] ${msg.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{msg.text}</div>
            )}

            <button onClick={save} disabled={busy || !form.name.trim()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-600/15 px-3 text-xs font-medium text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar engine
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
