import { Search } from 'lucide-react';
import KpiStrip from './KpiStrip';

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// Fleet toolbar: search + filters + KPIs. Connection / hostname / refresh now
// live in the global tab bar (App), so this is purely about the fleet view.
export default function TopBar({ filters, setFilters, nodes, kpis, updatedAt }) {
  const set = (key) => (v) => setFilters((f) => ({ ...f, [key]: v }));
  return (
    <div className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="flex h-11 items-center gap-3 px-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={filters.q}
            onChange={(e) => set('q')(e.target.value)}
            placeholder="Buscar modelo, nodo, proveedor…"
            className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-900 pl-7 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
        </div>

        <div className="flex items-center gap-3">
          <Select label="Nodo" value={filters.node} onChange={set('node')}
            options={[{ value: 'all', label: 'Todos' }, ...nodes.map((n) => ({ value: n, label: n }))]} />
          <Select label="Source" value={filters.source} onChange={set('source')}
            options={[{ value: 'all', label: 'Todos' }, { value: 'local', label: 'Local' }, { value: 'api', label: 'Cloud' }]} />
          <Select label="Tipo" value={filters.type} onChange={set('type')}
            options={[{ value: 'all', label: 'Todos' }, { value: 'chat', label: 'Chat' }, { value: 'embedding', label: 'Embedding' }]} />
          <Select label="Estado" value={filters.status} onChange={set('status')}
            options={[{ value: 'all', label: 'Todos' }, { value: 'running', label: 'Running' }, { value: 'degraded', label: 'Degraded' }, { value: 'stopped', label: 'Stopped' }, { value: 'failed', label: 'Failed' }]} />
        </div>

        <span className="ml-auto font-mono text-[10px] text-zinc-600">
          /v1/registry · poll 15s{updatedAt ? ` · ${updatedAt.toLocaleTimeString()}` : ''}
        </span>
      </div>

      <div className="flex h-11 items-center border-t border-zinc-800/70 px-3">
        <KpiStrip k={kpis} />
      </div>
    </div>
  );
}
