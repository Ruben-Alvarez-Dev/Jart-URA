# JART-URA — Fleet Data Model (index)

Pointer doc. The fleet data model lives in single-source-of-truth files; this
index says which is which. No model content is duplicated here (Golden Rule 2 —
DRY). The long-form data-model prose that used to live here was folded into the
canonical sources below.

| Concern | Canonical source |
| --- | --- |
| **Domain model** — entities, relationships, state machines, provenance | `dashboard/docs/control-center/01-er-model.md` (canonical, hexagonal core) |
| **Live API contract** — endpoints the dashboard fetches | `dashboard/docs/CONTROL-CENTER.md` |
| **Observed inventory** — real machines, components, NICs, the VPS stack, physical datapaths | `docs/fleet-entities.yaml` |
| **Per-model live metrics** — tps / load / latency, and the gap | `docs/METRICS-LAYER-SPEC.md` + `src/metrics-sampler.js` |
| **UX / interaction spec** — camera, side panels, illumination | `dashboard/docs/control-center/00-ux-spec.md` |
| **Open questions to verify** | `dashboard/docs/control-center/02-open-questions.md` |

## Provenance vocabulary (shared)

- `live` — from `/v1/registry` / `/health` right now.
- `configured` — from `config/models.json`.
- `snapshot` / `observed` — from node snapshots (see `fleet-entities.yaml`).
- `design-target` — from `ARCHITECTURE.md`, not confirmed running → render ghosted.

## Resolved facts

- **VPS = ionos** (`100.77.1.10` / `82.223.64.198`), confirmed 2026-06-15 by the
  UX branch's live curl + the node snapshot. `ARCHITECTURE.md` is mostly
  corrected; 2 residual `contabo-vps` mentions remain (lines 248, 768).
- **Live perf metrics**: `tps / load / req_active` are real today via
  `src/metrics-sampler.js`; latency percentiles and `req_total` have no honest
  source yet (see `METRICS-LAYER-SPEC.md` §3 and §5 deferred design).
