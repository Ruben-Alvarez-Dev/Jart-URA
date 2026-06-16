import { Server, Cloud, Eye, Wrench } from 'lucide-react';
import { STATUS, SOURCE, COST, CERT, loadColor, loadText, dash, fmtCtx } from '../lib/format';

const ICONS = { Server, Cloud };

function SourceChip({ source }) {
  const s = SOURCE[source];
  const Icon = ICONS[s.icon];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${s.chip}`}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

function Th({ children, className = '' }) {
  return (
    <th className={`whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500 ${className}`}>
      {children}
    </th>
  );
}

export default function ModelTable({ models, selected, onSelect }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
          <tr className="border-b border-zinc-800">
            <Th className="pl-3">Estado</Th>
            <Th>Modelo</Th>
            <Th>Nodo</Th>
            <Th>Source</Th>
            <Th>Tipo</Th>
            <Th>Motor</Th>
            <Th className="text-right">Ctx</Th>
            <Th className="text-right">tok/s</Th>
            <Th className="text-right">p95</Th>
            <Th>Carga</Th>
            <Th>Cost</Th>
            <Th>Cert</Th>
            <Th className="pr-3">Caps</Th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const st = STATUS[m.status] || STATUS.stopped;
            const isSel = selected?.name === m.name && selected?.node === m.node;
            return (
              <tr
                key={`${m.node}:${m.name}`}
                onClick={() => onSelect(m)}
                className={`cursor-pointer border-b border-zinc-900 transition-colors ${
                  isSel ? 'bg-zinc-800/70 ring-1 ring-inset ring-emerald-500/30' : 'hover:bg-zinc-900/70'
                }`}
              >
                <td className="pl-3 pr-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                    <span className={`text-[11px] ${st.text}`}>{st.label}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="font-medium text-zinc-100">{m.name}</div>
                  <div className="max-w-[200px] truncate font-mono text-[10px] text-zinc-500">{m.model}</div>
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-400">{m.node}</td>
                <td className="px-2 py-1.5"><SourceChip source={m.source} /></td>
                <td className="px-2 py-1.5 text-zinc-400">{m.type}</td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-400">{dash(m.engine || m.provider)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-300">{fmtCtx(m.context)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-200">{m.metrics.tps || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-zinc-400">{m.metrics.p95 ? `${m.metrics.p95}ms` : '—'}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-800">
                      <div className={`h-full rounded-full ${loadColor(m.metrics.loadPct)}`} style={{ width: `${m.metrics.loadPct}%` }} />
                    </div>
                    <span className={`font-mono text-[10px] tabular-nums ${loadText(m.metrics.loadPct)}`}>{m.metrics.loadPct}%</span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {m.source === 'api' ? (
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${(COST[m.costLayer] || COST.ppu).chip}`}>{(COST[m.costLayer] || { label: m.costLayer }).label}</span>
                  ) : (
                    <span className="text-[10px] text-zinc-600">—</span>
                  )}
                </td>
                <td className={`px-2 py-1.5 font-mono text-[11px] ${CERT[m.cert] || 'text-zinc-400'}`}>{m.cert}</td>
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1">
                    {m.caps.vision && <Eye className="h-3.5 w-3.5 text-sky-400" />}
                    {m.caps.fnCall && <Wrench className="h-3.5 w-3.5 text-amber-400" />}
                    {!m.caps.vision && !m.caps.fnCall && <span className="text-[10px] text-zinc-600">—</span>}
                  </div>
                </td>
              </tr>
            );
          })}
          {models.length === 0 && (
            <tr>
              <td colSpan={13} className="px-3 py-10 text-center text-zinc-600">Sin modelos que coincidan con los filtros.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
