// Visual maps + tiny formatters. No JSX here — keep it portable/testable.

export const STATUS = {
  running:  { label: 'Running',  dot: 'bg-emerald-400', text: 'text-emerald-400', soft: 'bg-emerald-500/10' },
  degraded: { label: 'Degraded', dot: 'bg-amber-400',   text: 'text-amber-400',   soft: 'bg-amber-500/10' },
  stopped:  { label: 'Stopped',  dot: 'bg-zinc-500',    text: 'text-zinc-400',    soft: 'bg-zinc-500/10' },
  failed:   { label: 'Failed',   dot: 'bg-red-500',     text: 'text-red-400',     soft: 'bg-red-500/10' },
};

export const SOURCE = {
  local: { label: 'Local', icon: 'Server', chip: 'border-sky-500/20 bg-sky-500/10 text-sky-300' },
  api:   { label: 'Cloud', icon: 'Cloud',  chip: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
};

export const COST = {
  flat:   { label: 'Flat',   chip: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  ppu:    { label: 'PPU',    chip: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  backup: { label: 'Backup', chip: 'border-zinc-600/40 bg-zinc-500/10 text-zinc-400' },
};

export const CERT = {
  APTO:     'text-emerald-400',
  FRONTERA: 'text-sky-400',
  '—':      'text-zinc-600',
};

// load %, request saturation, etc.
export function loadColor(pct) {
  if (pct == null) return 'bg-zinc-600';
  if (pct < 60) return 'bg-emerald-500';
  if (pct < 85) return 'bg-amber-500';
  return 'bg-red-500';
}

export function loadText(pct) {
  if (pct == null) return 'text-zinc-500';
  if (pct < 60) return 'text-emerald-400';
  if (pct < 85) return 'text-amber-400';
  return 'text-red-400';
}

export const dash = (v) => (v === undefined || v === null || v === '' ? '—' : v);

export const fmtCtx = (n) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
