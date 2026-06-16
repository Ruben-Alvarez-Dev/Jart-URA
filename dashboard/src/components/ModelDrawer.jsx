import { useState } from 'react';
import {
  X, Cpu, Gauge, ShieldCheck, Terminal, Cloud, Server, ChevronDown, RefreshCw, Power, Play, Trash2, Loader2, FileText,
} from 'lucide-react';
import { STATUS, SOURCE, COST, dash } from '../lib/format';
import { loadModel, unloadModel, restartModel, deleteModel, fetchLogs } from '../lib/api';

function Field({ label, value, mono = true }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-zinc-500">{label}</span>
      <span className={`break-all text-right text-[11px] text-zinc-200 ${mono ? 'font-mono' : ''}`}>{dash(value)}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800/70">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-zinc-900/50">
        <Icon className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-zinc-600 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

const btn = 'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs disabled:opacity-50';

export default function ModelDrawer({ model, onClose, onChanged }) {
  const [busy, setBusy] = useState(null); // 'load' | 'stop' | 'restart' | 'delete' | 'logs'
  const [logs, setLogs] = useState(null);
  const [err, setErr] = useState(null);
  if (!model) return null;
  const m = model;
  const st = STATUS[m.status] || STATUS.stopped;
  const running = m.status === 'running' || m.status === 'degraded';

  async function act(kind, fn) {
    setBusy(kind); setErr(null);
    try {
      const res = await fn(m.name);
      if (res && res.ok === false) setErr((res.errors || ['error']).join('; '));
      else if (res && res.warning) setErr(`⚠ ${res.warning}`);
      onChanged && onChanged();
      if (kind === 'delete') onClose();
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }

  async function showLogs() {
    setBusy('logs'); setErr(null);
    try {
      const res = await fetchLogs(m.name, 200);
      setLogs(res.lines || []);
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-[460px] max-w-[90vw] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              <h2 className="text-sm font-semibold text-zinc-100">{m.name}</h2>
              <span className={`text-[11px] ${st.text}`}>{st.label}</span>
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{m.node} · :{m.port} · {m.tailscaleAddr}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-auto">
          <Section icon={m.source === 'api' ? Cloud : Server} title="Identidad">
            <Field label="Source" value={SOURCE[m.source].label} mono={false} />
            <Field label={m.source === 'api' ? 'Provider' : 'Engine'} value={m.provider || m.engine} />
            <Field label="Modelo" value={m.model} />
            <Field label="Tipo" value={m.type} />
            <Field label="Contexto" value={m.context != null ? `${m.context.toLocaleString()} tok` : '—'} />
            <Field label="Max tokens" value={m.maxTokens != null ? m.maxTokens.toLocaleString() : '—'} />
            <Field label="Capacidades" mono={false}
              value={[m.caps.vision && 'visión', m.caps.fnCall && 'function-calling'].filter(Boolean).join(', ') || 'ninguna'} />
          </Section>

          {m.source === 'local' ? (
            <Section icon={Cpu} title="Tuning local">
              <Field label="gpu_layers" value={m.gpuLayers} />
              <Field label="threads" value={m.threads} />
              <Field label="default_args" value={(m.defaultArgs || []).join(' ')} />
              <Field label="model_path" value={m.model} />
            </Section>
          ) : (
            <Section icon={Cloud} title="API · coste">
              <Field label="api_model" value={m.model} />
              <Field label="api_key_env" value={m.apiKeyEnv} />
              <Field label="base_url" value={m.baseUrl} />
              <Field label="cost_layer" value={(COST[m.costLayer] || {}).label || m.costLayer || '—'} />
            </Section>
          )}

          {m.source === 'local' && (
            <Section icon={Terminal} title="Proceso">
              <Field label="PID" value={m.pid} />
              <Field label="Reinicios" value={m.restarts} />
              <Field label="Último reinicio" value={m.lastRestart} />
              <Field label="Uptime" value={m.metrics?.uptime} />
              <Field label="Log" value={m.logPath} />
            </Section>
          )}

          <Section icon={ShieldCheck} title="Certificación · Mesh" defaultOpen={false}>
            <Field label="FRONTIER verdict" value={m.cert} />
            <Field label="benchmark_source" value={m.benchSource} />
            <Field label="hostname" value={m.hostname} />
            <Field label="tailscale_addr" value={m.tailscaleAddr} />
          </Section>

          {logs !== null && (
            <Section icon={FileText} title={`Logs (${logs.length})`}>
              <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-black p-2 text-[10px] leading-relaxed text-zinc-400">
                {logs.length ? logs.join('\n') : '(sin contenido de log)'}
              </pre>
            </Section>
          )}
        </div>

        {err && <div className="border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-[11px] text-red-300">{err}</div>}

        <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
          {running ? (
            <button onClick={() => act('stop', unloadModel)} disabled={!!busy} className={`${btn} border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}>
              {busy === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} Parar
            </button>
          ) : (
            <button onClick={() => act('load', loadModel)} disabled={!!busy} className={`${btn} border-emerald-600/40 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25`}>
              {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Cargar
            </button>
          )}
          <button onClick={() => act('restart', restartModel)} disabled={!!busy} className={`${btn} border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}>
            {busy === 'restart' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reiniciar
          </button>
          <button onClick={showLogs} disabled={!!busy} className={`${btn} border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}>
            {busy === 'logs' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />} Logs
          </button>
          <button onClick={() => act('delete', deleteModel)} disabled={!!busy} className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50">
            {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>
    </>
  );
}
