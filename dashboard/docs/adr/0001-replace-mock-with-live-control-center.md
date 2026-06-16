# ADR-0001 — Replace the mock-seeded dashboard with a live, provenance-aware Control Center

- **Status:** Proposed (awaiting approval — Phase 0 gate)
- **Date:** 2026-06-15
- **Deciders:** Rubén (architect), UX architecture
- **Context docs:** [`../control-center/00-ux-spec.md`](../control-center/00-ux-spec.md), [`../control-center/01-er-model.md`](../control-center/01-er-model.md), [`../control-center/02-open-questions.md`](../control-center/02-open-questions.md)

## Context

The current `dashboard/` boots on mock data and falls back to mock when the router is unreachable (`src/data/fleet.js`, `useFleet.js` `usingMock=true`, `TopBar.jsx` "datos mock" / "Offline · mock"). This misrepresents system state and violates Golden Rule 1 ("no mock / demo / fake — 100% real"). Rubén's vision reframes the dashboard as a *living, cinematic map* of the real fleet and its inference routes, where the value comes precisely from the fidelity between rendered state and reality.

## Decision

1. **Live-only data.** Remove `src/data/fleet.js` and the `usingMock` fallback. `useFleet` consumes `fetchRegistry()` (already correct in `src/lib/api.js`) and exposes three honest connection states: `connecting`, `live`, `offline`. When offline, the map shows real unreachable state — never synthetic entities.
2. **Provenance is first-class.** Every entity carries `{ level: live | configured | snapshot | design-target, source, observedAt }`. Unverified/design-target entities render ghosted and labelled, so the full intended topology can be drawn without asserting it is running.
3. **Hexagonal core.** A render-agnostic domain model (Node, HardwareComponent, Service, Model, Slot, Channel, Route, RoutingDecision) sits behind ports; adapters feed it from `/v1/registry`, `/health`, snapshots, and (later) `/v1/health/full` + FRONTIER. The render technology is chosen in a separate Phase 2 spike and is swappable.
4. **Surgical rollout.** The existing dashboard keeps working until the redesign is approved and built behind its own entry point; we flip over only when Phase 4 verification passes. No working behaviour is removed before then (Golden Rule 4).

## Options considered

| Option | Verdict |
|--------|---------|
| Keep mock fallback for resilience/dev | ✗ Rejected — the explicit thing to kill; it is the "lie". |
| Mock only in dev, live in prod | ✗ Rejected — still fabricates state; a dev seeing fake nodes is the same lie. Dev points at a real router via Tailscale, or sees `offline`. |
| **Live-only with honest `offline` + provenance ghosting** | ✓ Chosen — truthful and still able to draw the full intended map. |

## Consequences

- **Positive:** the map is trustworthy; "what the screen shows" equals "what is running". Provenance lets us render design-target topology safely. The hexagonal split de-risks the Phase 2 render choice.
- **Cost:** local dev now requires a reachable Jart-URA (`JART_URA_BASE`) or it shows `offline` — by design. No synthetic fixtures, including in tests; tests use contract fakes at the **port** boundary, not fake fleet entities in the UI.
- **Follow-ups:** ADR-0002 (CSS convention: Tailwind + BEM/CSS-Modules for the scene), ADR-0003 (render/camera tech from the Phase 2 spike), and a possible spec for `/v1/health/full` to populate per-model metrics. Open items tracked in `02-open-questions.md`.

## Compliance with golden rules

1 (no mock) — central goal. 2 (SOLID/hexagonal/docs/ADR) — this ADR + hexagonal core. 4 (surgical) — old dashboard untouched until approved. 5 (spec-driven) — Phase 0 spec precedes code. 6 (verify) — provenance + `02-open-questions.md`.
