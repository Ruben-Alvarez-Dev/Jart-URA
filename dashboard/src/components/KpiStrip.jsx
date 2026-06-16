import { Boxes, Activity, Zap, Network, AlertTriangle } from 'lucide-react';

function Kpi({ icon: Icon, label, value, tone = 'text-zinc-200', sub }) {
  return (
    <div className="flex items-center gap-2 px-3 first:pl-0">
      <Icon className="h-3.5 w-3.5 text-zinc-500" strokeWidth={2} />
      <div className="leading-none">
        <div className="flex items-baseline gap-1">
          <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
          {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      </div>
    </div>
  );
}

export default function KpiStrip({ k }) {
  return (
    <div className="flex items-center divide-x divide-zinc-800">
      <Kpi icon={Boxes} label="Activos" value={`${k.running}/${k.total}`} tone="text-emerald-400" />
      <Kpi icon={AlertTriangle} label="Fallidos" value={k.failed} tone={k.failed ? 'text-red-400' : 'text-zinc-300'} />
      <Kpi icon={Network} label="Nodos" value={`${k.nodesOnline}/${k.nodes}`} />
      <Kpi icon={Zap} label="Throughput" value={k.tps} sub="tok/s" />
      <Kpi icon={Activity} label="Req activas" value={k.reqActive} />
    </div>
  );
}
