// Mock fleet REMOVED per ADR-0001 (live-only Control Center, Golden Rule 1).
// The dashboard now binds exclusively to GET /v1/registry via useFleet().
// KPIs moved to ../lib/kpis.js. This file is intentionally left without data;
// it remains only so any stale import fails loudly instead of resurrecting a lie.

export const FLEET = [];
export { fleetKpis } from '../lib/kpis';
