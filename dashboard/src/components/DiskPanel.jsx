import { useEffect, useState } from 'react';
import { HardDrive, RefreshCw, Save, Plus, Loader2, FileBox, Folder } from 'lucide-react';
import { fetchScanPaths, saveScanPaths, fetchDiskModels } from '../lib/api';

const EMBED_FAMILIES = ['bge', 'gte', 'nomic', 'e5'];

function deriveName(file) {
  const base = file.name.replace(/\.(gguf|safetensors|onnx|bin|mlmodelc|mlpackage)$/i, '');
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model';
}

function guessType(file) {
  const n = file.name.toLowerCase();
  if (EMBED_FAMILIES.includes(file.family) || n.includes('embed') || n.includes('rerank')) return 'embedding';
  return 'chat';
}

export default function DiskPanel({ engines = {}, onCreate }) {
  const [pathsText, setPathsText] = useState('');
  const [models, setModels] = useState([]);
  const [scannedAt, setScannedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadPaths = async () => {
    try { const d = await fetchScanPaths(); setPathsText((d.paths || []).join('\n')); } catch (e) { setMsg({ kind: 'err', text: e.message }); }
  };
  const scan = async (refresh = true) => {
    setBusy(true); setMsg(null);
    try {
      const d = await fetchDiskModels(refresh);
      setModels(d.models || []);
      setScannedAt(d.scanned_at || null);
      if (!d.models?.length) setMsg({ kind: 'warn', text: 'No se encontraron modelos en las rutas configuradas.' });
    } catch (e) { setMsg({ kind: 'err', text: e.message }); }
    setBusy(false);
  };
  useEffect(() => { loadPaths(); scan(false); }, []);

  async function savePaths() {
    setBusy(true); setMsg(null);
    const paths = pathsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const res = await saveScanPaths(paths);
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: (res.errors || ['error']).join('; ') }); return; }
    setMsg({ kind: 'ok', text: 'Rutas guardadas. Re-escaneando…' });
    scan(true);
  }

  function createFrom(file) {
    const hint = file.engineHint;
    const engine = engines[hint] ? hint : (Object.keys(engines)[0] || '');
    onCreate && onCreate({
      name: deriveName(file),
      source: 'local',
      engine,
      model_path: file.path,
      type: guessType(file),
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-800 p-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <Folder className="h-3.5 w-3.5" /> Rutas de escaneo · una por línea (acepta ~)
            </div>
            <textarea value={pathsText} onChange={(e) => setPathsText(e.target.value)}
              className="min-h-[64px] w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-600"
              placeholder={'models\n~/.cache/huggingface\n~/.ollama/models'} />
          </div>
          <div className="flex flex-col gap-2 pt-5">
            <button onClick={savePaths} disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:border-emerald-600 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> Guardar rutas
            </button>
            <button onClick={() => scan(true)} disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:border-emerald-600 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Escanear
            </button>
          </div>
        </div>
        {msg && (
          <div className={`mt-2 rounded-md border px-3 py-1.5 text-[11px] ${msg.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : msg.kind === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{msg.text}</div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-zinc-600">
        <span>{models.length} modelos en disco</span>
        {scannedAt && <span className="font-mono">escaneado {new Date(scannedAt).toLocaleTimeString()}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
            <tr className="border-b border-zinc-800 text-left text-[10px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-1.5">Fichero</th>
              <th className="px-2 py-1.5">Familia</th>
              <th className="px-2 py-1.5">Quant</th>
              <th className="px-2 py-1.5 text-right">Tamaño</th>
              <th className="px-2 py-1.5">Tipo</th>
              <th className="px-2 py-1.5">Engine sug.</th>
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((file) => (
              <tr key={file.path} className="border-b border-zinc-900 hover:bg-zinc-900/60">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5 font-medium text-zinc-100">
                    {file.kind === 'bundle' ? <FileBox className="h-3.5 w-3.5 text-violet-400" /> : <HardDrive className="h-3.5 w-3.5 text-sky-400" />}
                    {file.name}
                  </div>
                  <div className="max-w-[360px] truncate font-mono text-[10px] text-zinc-600" title={file.dir}>{file.dir}</div>
                </td>
                <td className="px-2 py-1.5 text-zinc-400">{file.family || '—'}</td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-400">{file.quant || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-300">{file.sizeHuman || '—'}</td>
                <td className="px-2 py-1.5 text-zinc-400">{guessType(file)}</td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-400">{file.engineHint || '—'}</td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => createFrom(file)}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-600/40 bg-emerald-600/15 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-600/25">
                    <Plus className="h-3 w-3" /> Crear modelo
                  </button>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-zinc-600">Sin modelos. Ajusta las rutas y pulsa Escanear.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
