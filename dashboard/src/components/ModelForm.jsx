import { useEffect, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { saveModel } from '../lib/api';

const BLANK = {
  name: '', source: 'local', port: '',
  engine: '', model_path: '', context: 4096, gpu_layers: 99, threads: 4, type: 'chat', extra_args: '',
  provider: '', api_model: '', base_url: '', api_key_env: '', max_tokens: '', cost_layer: 'ppu',
  supports_vision: false, supports_function_calling: false,
  role: '',
  loadAfter: true,
};

function Row({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1 py-1.5">
      <span className="text-[11px] text-zinc-400">{label}{hint && <span className="ml-1 text-zinc-600">· {hint}</span>}</span>
      {children}
    </label>
  );
}

const inputCls = 'h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-emerald-600';

export default function ModelForm({ open, initial, engines = {}, onClose, onSaved }) {
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [warning, setWarning] = useState(null);

  useEffect(() => {
    if (open) {
      setErrors([]); setWarning(null);
      const init = { ...BLANK, ...(initial || {}) };
      if (Array.isArray(init.extra_args)) init.extra_args = init.extra_args.join(' ');
      if (Array.isArray(init.role)) init.role = init.role.join(', ');
      // sensible engine default for a local model
      if (init.source === 'local' && !init.engine) init.engine = Object.keys(engines)[0] || '';
      setF(init);
    }
  }, [open, initial, engines]);

  if (!open) return null;
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF((s) => ({ ...s, [k]: v }));
  };
  const editing = !!(initial && initial.__editing);

  async function submit() {
    setBusy(true); setErrors([]); setWarning(null);
    const payload = {
      name: f.name.trim(),
      source: f.source,
      supports_vision: f.supports_vision,
      supports_function_calling: f.supports_function_calling,
    };
    if (f.port !== '' && f.port != null) payload.port = Number(f.port);
    if (f.role.trim()) payload.role = f.role.split(',').map((s) => s.trim()).filter(Boolean);
    if (f.source === 'local') {
      Object.assign(payload, {
        engine: f.engine,
        model_path: f.model_path.trim(),
        context: Number(f.context),
        gpu_layers: Number(f.gpu_layers),
        threads: Number(f.threads),
        type: f.type,
      });
      const extra = f.extra_args.trim();
      if (extra) payload.extra_args = extra.split(/\s+/);
    } else {
      Object.assign(payload, {
        provider: f.provider.trim(),
        api_model: f.api_model.trim(),
        base_url: f.base_url.trim(),
        api_key_env: f.api_key_env.trim() || undefined,
        cost_layer: f.cost_layer,
      });
      if (f.max_tokens !== '') payload.max_tokens = Number(f.max_tokens);
    }
    if (f.loadAfter) payload.load = true;

    try {
      const res = await saveModel(payload);
      if (!res.ok) { setErrors(res.errors || ['error desconocido']); setBusy(false); return; }
      if (res.load && res.load.ok === false) setErrors(res.load.errors || []);
      if (res.load && res.load.warning) setWarning(res.load.warning);
      onSaved && onSaved(res);
      setBusy(false);
      if (!res.load || res.load.ok !== false) onClose();
    } catch (err) {
      setErrors([err.message]); setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-[460px] max-w-[92vw] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{editing ? `Editar · ${f.name}` : 'Nuevo modelo'}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-2">
          <Row label="Nombre" hint="único, es la clave">
            <input className={inputCls} value={f.name} onChange={set('name')} disabled={editing} placeholder="primary" />
          </Row>
          <Row label="Source">
            <select className={inputCls} value={f.source} onChange={set('source')} disabled={editing}>
              <option value="local">local · proceso (llama-server / engine)</option>
              <option value="api">api · proxy a proveedor remoto</option>
            </select>
          </Row>
          <Row label="Puerto" hint="vacío = auto en el rango">
            <input className={inputCls} type="number" value={f.port} onChange={set('port')} placeholder="auto" />
          </Row>

          {f.source === 'local' ? (
            <>
              <Row label="Engine">
                <select className={inputCls} value={f.engine} onChange={set('engine')}>
                  <option value="">— elige engine —</option>
                  {Object.keys(engines).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Row>
              <Row label="model_path" hint="ruta del fichero/bundle en disco">
                <input className={inputCls} value={f.model_path} onChange={set('model_path')} placeholder="models/qwen…Q4_K_M.gguf" />
              </Row>
              <div className="grid grid-cols-3 gap-2">
                <Row label="context"><input className={inputCls} type="number" value={f.context} onChange={set('context')} /></Row>
                <Row label="gpu_layers"><input className={inputCls} type="number" value={f.gpu_layers} onChange={set('gpu_layers')} /></Row>
                <Row label="threads"><input className={inputCls} type="number" value={f.threads} onChange={set('threads')} /></Row>
              </div>
              <Row label="Tipo">
                <select className={inputCls} value={f.type} onChange={set('type')}>
                  <option value="chat">chat</option>
                  <option value="embedding">embedding</option>
                </select>
              </Row>
              <Row label="extra_args" hint="flags extra, separados por espacios">
                <input className={inputCls} value={f.extra_args} onChange={set('extra_args')} placeholder="--flash-attn -ctk q4_0" />
              </Row>
            </>
          ) : (
            <>
              <Row label="provider"><input className={inputCls} value={f.provider} onChange={set('provider')} placeholder="openai · anthropic · openrouter · litellm" /></Row>
              <Row label="api_model"><input className={inputCls} value={f.api_model} onChange={set('api_model')} placeholder="gpt-4o" /></Row>
              <Row label="base_url"><input className={inputCls} value={f.base_url} onChange={set('base_url')} placeholder="https://api.openai.com/v1" /></Row>
              <Row label="api_key_env" hint="nombre de la env var"><input className={inputCls} value={f.api_key_env} onChange={set('api_key_env')} placeholder="OPENAI_API_KEY" /></Row>
              <div className="grid grid-cols-2 gap-2">
                <Row label="max_tokens"><input className={inputCls} type="number" value={f.max_tokens} onChange={set('max_tokens')} /></Row>
                <Row label="cost_layer">
                  <select className={inputCls} value={f.cost_layer} onChange={set('cost_layer')}>
                    <option value="flat">flat</option><option value="ppu">ppu</option><option value="backup">backup</option>
                  </select>
                </Row>
              </div>
            </>
          )}

          <Row label="role" hint="etiquetas, separadas por comas"><input className={inputCls} value={f.role} onChange={set('role')} placeholder="general, coding" /></Row>

          <div className="flex items-center gap-4 py-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300"><input type="checkbox" checked={f.supports_vision} onChange={set('supports_vision')} /> visión</label>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300"><input type="checkbox" checked={f.supports_function_calling} onChange={set('supports_function_calling')} /> function-calling</label>
          </div>

          {errors.length > 0 && (
            <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {errors.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          {warning && (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">⚠ {warning}</div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <input type="checkbox" checked={f.loadAfter} onChange={set('loadAfter')} /> cargar al guardar
          </label>
          <button onClick={submit} disabled={busy}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-600/15 px-3 text-xs font-medium text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar
          </button>
        </div>
      </aside>
    </>
  );
}
