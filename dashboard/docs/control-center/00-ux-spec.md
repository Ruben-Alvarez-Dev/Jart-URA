# Jart-URA Control Center — UX Specification

- **Status:** DRAFT — Phase 0, for review (do not implement yet)
- **Owner:** UX architecture (Jart-URA team)
- **Date:** 2026-06-15
- **Supersedes:** the current `dashboard/` "dense ops dashboard"
- **Related:** [`01-er-model.md`](01-er-model.md) · [`02-open-questions.md`](02-open-questions.md) · [`../adr/0001-replace-mock-with-live-control-center.md`](../adr/0001-replace-mock-with-live-control-center.md)

This document is the Phase 0 deliverable: the UX architecture and interaction model. It defines *what* the Control Center is and *how* it behaves, not its visual assets (Phase 1) or its render technology (Phase 2 spike). It is the contract the later phases must satisfy.

---

## 1. Problem statement & mandate

The current dashboard boots on **mock data**: `src/data/fleet.js` (`// Mock fleet…`), `src/hooks/useFleet.js` (`usingMock = true` by default, mock fallback), and `TopBar.jsx` (badges `datos mock` / `Offline · mock`). That is a lie about system state and violates Golden Rule 1.

**Mandate:** the Control Center is bound **exclusively to live data**. When a source is unreachable, the map shows that source's **real** condition (offline / stopped / unknown) — never a synthetic stand‑in. Honesty about absence replaces the comfort of fake presence.

## 2. Vision

The Control Center is a **living map of the real fleet** and of **how inference routes through it**. It is not a table with decoration; it is an instrument. The center of the screen is always the map — the *showcase* — telling you, at a glance, *where each thing is, what it is, and how it communicates*.

- **At rest:** a wide, depth‑laden establishing shot of the fleet (camera pulled back, parallax).
- **On interaction:** selecting a machine, a component, or a route makes the camera move and zoom to that zone; components open, and the affected parts and paths **illuminate** — directional arrows, protocol colour, animated flow.
- **The map mirrors reality:** because every drawable is a React component bound to live state, illumination and motion are driven by *actual* status and metrics. Fidelity between state and reality is what makes the map an instrument rather than an ornament (the "nuclear tip").

## 3. Design principles

1. **Truth over comfort.** No mock, demo, or placeholder presence. Unknown is rendered as unknown.
2. **The map is the showcase.** The center always holds the map. Panels and controls never cover it; they slide in from the edges.
3. **Panels are selectors, not detail dumps.** A side panel shows *what you are currently deciding* and lets you change it. Deep read‑only detail is surfaced in place, on the map.
4. **State ↔ reality fidelity.** Every visual state derives from a real datum. If a datum is missing, the visual degrades to `—`, it is not invented.
5. **Neon is the only accent.** The base scene is desaturated (white / black / grey). Colour is reserved for data flow and protocol identity, so the eye reads movement instantly.
6. **Progressive depth.** Information density grows as the camera approaches: fleet → node → component → model/slot. Nothing is dumped at the far zoom.
7. **Provenance is first‑class.** Every entity carries where its truth comes from and how fresh it is (see §4). The UI never blurs *verified‑now* with *configured* or *aspirational*.

## 4. Certainty & provenance model (core)

The prompt itself distinguishes levels of certainty. We make that a first‑class property of every entity so the map can be complete **and** honest at the same time.

| Provenance | Source | Meaning | Default rendering |
|------------|--------|---------|-------------------|
| `live` | `:9100/v1/registry`, `/health` (and planned `/v1/health/full`, FRONTIER `:4400`) | Verified now | Full colour eligibility, real status, neon flow when active |
| `configured` | `config/models.json` | Declared, may not be running | Drawn, but status comes only from live; if not seen live → `stopped`/`unknown` |
| `snapshot` | Tailscale / hardware snapshots (e.g. 2026‑06‑11) | True at a point in time | Drawn as physical substrate; staleness shown (timestamp) |
| `design-target` | `ARCHITECTURE.md` | Intended, **not** confirmed deployed | **Ghosted / outlined**, explicitly labelled "design target — unverified" |

**Rule:** a `design-target` or otherwise unverified entity is never shown as active. It appears as a faint blueprint until a live source confirms it, at which point it "materialises". This is how we draw the full intended topology without lying about what is actually running. It is also the principled resolution of the `ionos` vs `Contabo` conflict (see `02-open-questions.md`).

## 5. Information architecture — levels of detail (LOD)

The same scene, four zoom tiers. The camera, not a route change, moves between them.

| LOD | Subject | What is visible | Primary entities |
|-----|---------|-----------------|------------------|
| **L0 Fleet** | The whole mesh | Nodes as normalised silhouettes, inter‑node channels (Tailscale), aggregate health, active routes as neon threads | Node, Channel, Route |
| **L1 Node** | One machine | The node opens: internal hardware blocks and the services/processes it hosts, with their ports | HardwareComponent, Service |
| **L2 Component** | One part | A CPU / RAM / ANE‑NPU / GPU(Metal) / disk / NIC, its live metrics, and what flows through it | HardwareComponent, Channel |
| **L3 Model / slot** | One inference endpoint or pipeline slot | A model (`name / engine / size / load / tokens`) or a pipeline slot (VAD·STT·ROUTER·LLM·TTS·VISION·EMBEDDINGS) | Model, Slot, RoutingDecision |

The example side card `modelo / CoreML / 1.8 GB / 12% / 5000 tokens` is an L3 selector.

## 6. Interaction model

### 6.1 Camera
- Rest = establishing shot with parallax depth.
- Select → the camera dollies/zooms to the target LOD; siblings recede (depth‑of‑field / dim), the target opens.
- Zoom‑out gesture / breadcrumb returns up a tier. Camera transitions are smooth and interruptible.

### 6.2 Selection & illumination
- Selecting an entity illuminates **it and everything causally related to it**: the components it uses and the channels/routes it participates in.
- Routes can be lit **whole**, or **one direction at a time**, with the two directions differentiated by colour. Channels are coloured by **protocol** (§8).
- Flow is animated along the lit path (travelling neon), with arrowheads encoding direction.

### 6.3 Side panels = selectors
- Panels slide in from the **edge nearest the touched element** — right, left, top, bottom, or a combination — and never occupy the center.
- A panel states *what you are deciding* and exposes the controls to change it (e.g. pick which model serves a slot, pin local‑first vs cloud‑fallback, select a route to trace).
- Panels are dismissible and stackable by edge; the map stays live underneath.

### 6.4 Signature interaction — trace a route
Selecting the voice route lights the **real** path STT → LLM → TTS hop by hop, naming each element it passes through and highlighting that segment, with protocol‑coloured, directional neon. The same mechanism serves the chat route, the mesh‑poll route, and the cloud route (see `01-er-model.md` §Routes).

## 7. Connection & data states (no mock)

`useFleet` connects to the real management API and exposes exactly three honest states. The `usingMock` flag and the `fleet.js` fallback are **removed**.

| State | Trigger | Map behaviour |
|-------|---------|---------------|
| `connecting` | First load / reconnect in flight | Neutral; last good frame dimmed if present, otherwise empty scaffold |
| `live` | `/v1/registry` responded | Entities reflect real status; poll every `mesh_poll_ms` (15 s) |
| `offline` | Management API unreachable | Nodes/services shown in their **real** unreachable state; banner states the router is down. No invented entities. |

Fields the backend does not yet emit (per‑model `metrics`, `cert`) degrade to `—` (Golden Rule 1). They are wired the day `/v1/health/full` and FRONTIER (`:4400`) exist.

## 8. Protocol → neon colour system (proposed)

One hue per protocol so a lit channel is self‑describing. Hues are **proposals** to confirm in Phase 1; the mapping itself is the contract.

| Protocol / channel | Where | Proposed accent |
|--------------------|-------|-----------------|
| HTTP (OpenAI‑spec model ports `:9001‑9012`, mgmt `:9100`, LiteLLM `:10280`) | intra/inter‑node | neon cyan |
| WebSocket (LiveKit signalling `:7881`) | client ↔ VPS | neon violet |
| WebRTC / Opus (`:50000‑60000/udp`) | media | neon magenta |
| Tailscale / WireGuard (`udp 41641`, `100.x`) | mesh fabric | neon green |
| SSH (`:22`) | ops | neon amber |
| Ollama (`:11434`), SMB (`:445`), VNC (`:5900`) | LAN/local | dim neon blue |

Base scene stays desaturated; only these flow when carrying traffic.

## 9. Architecture (hexagonal, render‑agnostic)

To satisfy Golden Rule 2 and to keep the Phase 2 render decision reversible, the domain is decoupled from the renderer.

```
Adapters (driving)        Domain (core)                 Presenters → Renderer (driven)
─────────────────         ─────────────                 ──────────────────────────────
registryAdapter  ─┐                                     viewModel ─→ <RenderEngine>
healthAdapter    ─┼─→  Fleet model: Node, Component,  ─→  (chosen in Phase 2 spike:
snapshotAdapter  ─┤     Service, Model, Channel,            r3f+drei | SVG/DOM 2.5D | pixi/konva)
benchAdapter(—)  ─┘     Route, State, Provenance
```

- **Ports:** `FleetSource` (live registry/health), `TopologySource` (snapshots), `MetricsSource` (planned). `mapRegistryEntry` in `src/lib/api.js` is the first adapter and is treated as correct.
- The domain holds no rendering or framework concerns; the renderer holds no fetching concerns. The Phase 2 spike swaps only the driven side.
- Naming/CSS convention (Tailwind‑utility vs BEM, Golden Rule 2) is an open decision — see `02-open-questions.md`.

## 10. Non‑goals (v1 of the redesign)

- No control actions that mutate the fleet (start/stop/restart) until a separate, audited command path exists. v1 is **observe & navigate**; selectors choose *views/routes*, not destructive operations.
- No historical time‑series store; v1 reflects *now* + the 15 s poll.
- No 3D art assets in Phase 0; this document commits only to the model and behaviour.

## 11. Phase plan (recap)

- **Phase 0 (this):** UX spec + E‑R map. ← review gate
- **Phase 1:** art direction + normalised equipment asset set (may use `stitch-mcp/`).
- **Phase 2:** render/camera technology spike with measured criteria.
- **Phase 3:** implementation — scene, edge selectors, live `/v1/registry` binding, protocol/state route illumination.
- **Phase 4:** verification against real nodes and real states. Zero invented data.
