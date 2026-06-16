// Fleet KPIs derived purely from live models — no mock, no global node list.
// Nodes are counted from whatever the registry actually returned.

export function fleetKpis(models) {
  const running = models.filter((m) => m.status === 'running').length;
  const failed = models.filter((m) => m.status === 'failed').length;
  const degraded = models.filter((m) => m.status === 'degraded').length;
  const tps = models.reduce((s, m) => s + (m.metrics?.tps || 0), 0);
  const reqActive = models.reduce((s, m) => s + (m.metrics?.reqActive || 0), 0);
  const nodes = new Set(models.map((m) => m.node)).size;
  const nodesOnline = new Set(
    models.filter((m) => m.status === 'running' || m.status === 'degraded').map((m) => m.node),
  ).size;
  return { total: models.length, running, failed, degraded, tps, reqActive, nodesOnline, nodes };
}
