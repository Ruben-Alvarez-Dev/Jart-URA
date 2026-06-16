import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Cpu, HardDrive, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import TopBar from './components/TopBar';
import ModelTable from './components/ModelTable';
import ModelDrawer from './components/ModelDrawer';
import EnginesPanel from './components/EnginesPanel';
import DiskPanel from './components/DiskPanel';
import ModelForm from './components/ModelForm';
import { fleetKpis } from './lib/kpis';
import { fetchEngines } from './lib/api';
import { useFleet } from './hooks/useFleet';

const INITIAL = { q: '', node: 'all', source: 'all', type: 'all', status: 'all' };

const CONN = {
  connecting: { dot: 'bg-zinc-500', text: 'text-zinc-400', label: 'Conectando…' },
  live: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'En vivo' },
  offline: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Offline · router caído' },
};

const TABS = [
  { id: 'fleet', label: 'Flota', icon: Boxes },
  { id: 'engines', label: 'Engines', icon: Cpu },
  { id: 'disk', label: 'Disco', icon: HardDrive },
];

export default function App() {
  const [tab, setTab] = useState('fleet');
  const [filters, setFilters] = useState(INITIAL);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ open: false, initial: null });
  const [engines, setEngines] = useState({});

  const { models: fleet, conn, updatedAt, hostname, refresh } = useFleet();

  const loadEngines = useCallback(async () => {
    try { const d = await fetchEngines(); setEngines(d.engines || {}); } catch { /* offline */ }
  }, []);
  useEffect(() => { loadEngines(); }, [loadEngines]);

  const nodes = useMemo(() => [...new Set(fleet.map((m) => m.node))], [fleet]);

  const models = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return fleet.filter((m) => {
      if (filters.node !== 'all' && m.node !== filters.node) return false;
      if (filters.source !== 'all' && m.source !== filters.source) return false;
      if (filters.type !== 'all' && m.type !== filters.type) return false;
      if (filters.status !== 'all' && m.status !== filters.status) return false;
      if (q) {
        const hay = `${m.name} ${m.node} ${m.model} ${m.provider || m.engine || ''} ${m.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [fleet, filters]);

  const kpis = useMemo(() => fleetKpis(fleet), [fleet]);

  const selectedLive = useMemo(() => {
    if (!selected) return null;
    return fleet.find((m) => m.name === selected.name && m.node === selected.node) || selected;
  }, [selected, fleet]);

  const c = CONN[conn] || CONN.connecting;
  const reload = () => { refresh(); loadEngines(); };
  const openNew = () => setForm({ open: true, initial: { source: 'local' } });
  const openFromDisk = (initial) => { setForm({ open: true, initial }); };

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      {/* global bar: brand · tabs · conn · actions */}
      <header className="flex h-12 items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-3 backdrop-blur">
        <div className="flex items-center gap-2 pr-1">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/15 text-emerald-400">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Jart-URA</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">Control Center</span>
        </div>

        <nav className="flex items-center gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {hostname && <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">{hostname}</span>}
          <span className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1">
            <span className={`h-1.5 w-1.5 rounded-full ${c.dot} ${conn === 'live' ? 'animate-pulse' : ''}`} />
            <span className={`text-[11px] ${c.text}`}>{c.label}</span>
          </span>
          <button onClick={openNew}
            className="flex h-7 items-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-600/15 px-2.5 text-xs font-medium text-emerald-300 hover:bg-emerald-600/25">
            <Plus className="h-3.5 w-3.5" /> Nuevo modelo
          </button>
          <button onClick={reload}
            className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100">
            <RefreshCw className="h-3.5 w-3.5" /> Refrescar
          </button>
        </div>
      </header>

      {tab === 'fleet' && (
        <>
          <TopBar filters={filters} setFilters={setFilters} nodes={nodes} kpis={kpis} updatedAt={updatedAt} />
          <main className="min-h-0 flex-1">
            {conn === 'offline' && fleet.length === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center">
                <div>
                  <p className="text-sm text-amber-400">Router no alcanzable</p>
                  <p className="mt-1 text-xs text-zinc-500">No hay datos en vivo de <span className="font-mono">/v1/registry</span>. Sin mock — esto es el estado real. Arranca Jart-URA (<span className="font-mono">npm start</span>) o revisa el túnel.</p>
                </div>
              </div>
            ) : (
              <ModelTable models={models} selected={selectedLive} onSelect={setSelected} />
            )}
          </main>
          <footer className="flex items-center justify-between border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-600">
            <span>{models.length} de {fleet.length} modelos · clic en una fila para el detalle y control</span>
            <span>Jart-URA Control Center · live · /v1/registry</span>
          </footer>
        </>
      )}

      {tab === 'engines' && <main className="min-h-0 flex-1"><EnginesPanel onChanged={loadEngines} /></main>}

      {tab === 'disk' && <main className="min-h-0 flex-1"><DiskPanel engines={engines} onCreate={openFromDisk} /></main>}

      <ModelDrawer model={selectedLive} onClose={() => setSelected(null)} onChanged={refresh} />
      <ModelForm
        open={form.open}
        initial={form.initial}
        engines={engines}
        onClose={() => setForm({ open: false, initial: null })}
        onSaved={() => { refresh(); loadEngines(); }}
      />
    </div>
  );
}
