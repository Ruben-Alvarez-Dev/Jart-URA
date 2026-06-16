# ADR-003 — Control Plane vs Data Plane Separation

> **Status**: ACCEPTED
> **Date**: 2026-06-16
> **Author**: Rubén Alvarez
> **Supersedes**: the implicit assumption that Jart-URA handles both planes

---

## Context

Jart-URA (Node.js, `:9100`) was built as a model router: it spawns local `llama-server` processes, proxies API calls to cloud providers, and exposes a management API + React dashboard. It works.

Simultaneously, a substantial body of spec work describes a Python/FastAPI ecosystem (`memory-enrichment/`, `jart-gateway-plan.md`) that would add memory injection, agent identity, NATS messaging, and intelligent routing on top. These specs envision `Router-Jart` on `:10200` as a separate service.

The open question: does Jart-URA grow to encompass both planes, or does each plane get its own home?

---

## Decision

**Jart-URA (Node.js) is the Control Plane.** The Data Plane (memory enrichment, gateway routing, inference optimization) lives in a separate Python ecosystem.

### Control Plane (Jart-URA, Node.js) — THIS REPO

| Responsibility | Endpoint | Status |
|---------------|----------|--------|
| Model registry and discovery | `GET /v1/registry` | ✅ Working |
| Model lifecycle (load/unload/restart) | `POST /v1/models/:name/load` | ✅ Working |
| Process management (PID, logs, auto-restart) | `GET /v1/models/:name/logs` | ✅ Working |
| Engine configuration | CRUD `/v1/engines` | ✅ Working |
| Disk scanning for model files | `GET /v1/disk/models` | ✅ Working |
| Health monitoring (per-model metrics) | `GET /v1/health/full` | ✅ Working |
| Mesh peer discovery (Tailscale) | mesh-registry polling | ✅ Working |
| API proxy to cloud providers | Per-model ports (:9010-9012) | ✅ Working |
| Dashboard UI | React on :3200 | ✅ Working |
| LiteLLM config generation | `router-config-gen.js` CLI | ✅ Working |

### Data Plane (Python ecosystem) — SEPARATE REPO

| Responsibility | Service | Port | Status |
|---------------|---------|------|--------|
| Memory enrichment middleware | EnrichmentMiddleware | :10200 | Spec only |
| Core memory service | jart-core-memory | :8891 | Spec only |
| Cognitive routing | Jart-BRAIN | :8892 | Spec only |
| Cloud gateway | LiteLLM | :10280 | Configured externally |
| Identity governance | MCP Backpack + NATS | :4222 | Spec only |
| Vector storage | Qdrant | :6333 | External dependency |

### The boundary

```
Control Plane (Node)          Data Plane (Python)
┌──────────────────┐         ┌──────────────────────┐
│  Dashboard :3200 │         │  Enrichment :10200   │
│  Management :9100│  ←──→   │  Core-Memory :8891   │
│  Models :9001-12 │         │  JBRAIN :8892        │
│  Engines         │         │  LiteLLM :10280      │
│  Mesh registry   │         │  Qdrant :6333        │
└──────────────────┘         └──────────────────────┘
        │                             │
        │   /v1/registry consumed     │  /api/enrich injected
        │   by Data Plane             │  into Control Plane proxy
        └─────────────────────────────┘
```

The Data Plane **consumes** the Control Plane's `/v1/registry` to know what models exist. The Control Plane **can optionally proxy through** the Data Plane's EnrichmentMiddleware, but functions fully without it (degradation principle: enrichment never blocks).

---

## Consequences

### Positive

- **Each plane scales independently.** Control Plane stays lean Node.js (zero deps except `yaml`). Data Plane grows its own Python stack without bloating this repo.
- **Jart-URA stays testable in isolation.** 55 tests run in 2 seconds with zero external dependencies.
- **The Data Plane specs already assume this separation.** ADR-002 places `EnrichmentMiddleware` in `Router-Jart :10200`, not in Jart-URA. ADR-003 (original) extracts `jart-core-memory` as a separate service. The specs were already correct.
- **Technology choices are independent.** Node.js for fast I/O + process management. Python/FastAPI for async enrichment + ML libraries.

### Negative

- **Two repos to maintain.** Mitigated: they communicate over HTTP, each has its own test suite, no shared code.
- **The Data Plane needs to know the Control Plane's address.** Mitigated: `JART_URA_BASE` env var (already used by the MCP server and dashboard).

### Neutral

- The existing `memory-enrichment/` specs stay in this repo as **reference documentation**. When the Data Plane project starts, the specs move to its repo. No code duplication.

---

## What this means right now

1. **This repo (Jart-URA) is complete for its scope.** The Control Plane works. Dashboard, management API, process lifecycle, mesh discovery, API proxy — all functional.
2. **The Python ecosystem is the next project**, not a feature of this one. Its home will be in `Jart-OS/TIERS/TIER-02-GATEWAY/` (per the existing ROADMAP).
3. **No more ambiguity.** If someone asks "where does memory enrichment live?" — the answer is: not here. Here is the Control Plane that it consumes.

---

## References

- `ARCHITECTURE.md` — JartOS Desktop vision (§3.2 describes Jart-URA's role)
- `ADR-002-memory-enrichment-architecture.md` — enrichment hexagonal design
- `memory-enrichment/ROADMAP.md` — Data Plane phases 0–F
- `jart-gateway-plan.md` — vLLM + LiteLLM analysis
