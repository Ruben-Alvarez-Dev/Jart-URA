# Jart-URA Control Center — Open questions to verify (Phase 0 gate)

- **Status:** needs Rubén's confirmation before Phase 1
- **Date:** 2026-06-15

Golden Rule 6 (verify, don't assume). Each item lists the conflict, the options, and a recommendation. None of these block writing the spec; all block drawing the affected entity as `live`.

## Verified live — 2026-06-15 (via Desktop Commander on the MacBook Pro)

Ran `curl :9100` + `tailscale status` on host `MacBook-Pro-de-ruben` (`100.77.1.30`):

- **Q1 RESOLVED — the VPS is ionos.** Tailscale peer `vpn-ruben-vps-ionos` at `100.77.1.10` (public `82.223.64.198`). "Contabo" in `ARCHITECTURE.md` is stale and must be corrected.
- **Mesh fabric is live.** Mac Mini (`vpn-ruben-mac-mini`, `100.77.1.20`) is `active; direct 192.168.1.50:41641`; the MacBook sees every peer. Tailscale topology is real and usable.
- **Jart-URA is currently DOWN.** `:9100` → connection refused (exit 7) on both `localhost` (MacBook) and `100.77.1.20` (Mac Mini); nothing listening on `:9100`; no `jart-ura` / `llama-server` processes. → As of now the honest map state is "router offline, 0 live models" — which is exactly the no-mock design working as intended.
- **Fleet power state now:** online — MacBook `100.77.1.30`, Mac Mini `100.77.1.20` (active). Offline/asleep — `jart-os-remote-server-2` `100.118.124.101` (4d), Xiaomi Pad `100.77.1.33` (27d); Pixel `100.77.1.31` / Samsung `100.77.1.32` idle. VPS ionos `100.77.1.10` present.
- **Still open:** start Jart-URA to read `/v1/registry`; `peers[]` is still empty in `config/models.json` even though the mesh is up.

| # | Question | Why it matters | Recommendation |
|---|----------|----------------|----------------|
| 1 | **VPS host: ionos vs Contabo.** Snapshot says ionos `82.223.64.198` (Ubuntu 26.04, KVM); `ARCHITECTURE.md` says Contabo 24GB. | The SERVICES node identity and IP must be real. | ✓ **RESOLVED 2026-06-15** — it is **ionos** (Tailscale `vpn-ruben-vps-ionos`, `100.77.1.10`). Contabo = stale doc, to be corrected. |
| 2 | **Which SERVICES are actually deployed** (LiteLLM `:10280`, Postgres, vLLM, WebUI, Monitor, TEI, Qdrant, LiveKit `:7881`, FRONTIER `:4400`)? | `ARCHITECTURE.md` is a design target; drawing them as active would be a mock. | Render all as `design-target` (ghosted) until probed live per service. Need a per-service liveness check. |
| 3 | **`peers: []` is empty** in `config/models.json`. | The mesh map needs real peer hostnames to draw inter-node channels as `live`. | Populate `peers` with the Tailscale hostnames of WORKHORSE + VPS, or confirm mesh is not yet active (then draw mesh edges as `design-target`). |
| 4 | **CSS convention: BEM (Golden Rule 2) vs the existing Tailwind-utility dashboard.** | Consistency + the rule. The redesign is the moment to reconcile. | Proposal: keep Tailwind utilities for app chrome; use **BEM-named, CSS-Module classes** for the scene/renderer layer (`.cc-node`, `.cc-node--offline`, `.cc-channel__flow`). Lock in ADR-0002. |
| 5 | **Render/camera tech (Phase 2 spike).** r3f+drei (real 3D camera) vs SVG/DOM 2.5D + framer-motion vs pixi/konva. | Determines zoom fidelity, perf, complexity, asset pipeline. | Do not decide now. Spike all three against criteria: 60fps at L0 with N nodes, smooth interruptible zoom, accessibility, bundle size, asset workflow. |
| 6 | **API proxies discrepancy.** Prompt §B lists only `gpt-4o`; real `config/models.json` has `gpt-4o` `:9010`, `claude-sonnet-4` `:9011`, `gemini-2.5-flash` `:9012`. | The map must show all three. | Use the real config (3 proxies). Confirm none were removed in the uncommitted working copy. |
| 7 | **Per-model metrics.** `/v1/health/full` is planned, not implemented; FRONTIER `:4400` not wired. | Spec promises `tps/p50/p95/p99/load/cert` → today they are `—`. | Confirm v1 ships with `—` for these. Optionally, a follow-up ADR specs `/v1/health/full` so the map fills in. |
| 8 | **Mobiles/tablet role** (Pixel/Samsung/Xiaomi). | Are they inference participants, voice clients, or just Tailscale members? Changes whether they appear in routes. | Treat as **edge clients** (voice/WebRTC origin) only, unless told otherwise. |
| 9 | **Live verification access.** This environment cannot reach `:9100` or the `100.x` Tailscale net from the sandbox. | Phase 4 requires verification against real state; I cannot curl your fleet from here. | Pick one: (a) I drive it on your Mac via desktop control, (b) you expose `:9100` to a reachable URL, or (c) you paste `/v1/registry` + `/health` outputs. |
| 10 | **Control actions scope.** Should v1 allow start/stop/restart of models, or observe-only? | Mutating the fleet needs an audited command path; Jart-URA today exposes read endpoints. | v1 = **observe & navigate**. Selectors choose views/routes, not destructive ops. Defer commands to a later, audited ADR. |
| 11 | **WORKHORSE (m1-max) real workload.** `config/models.json` is Mac-Mini-only; m1-max models are design-target. | Avoid drawing m1-max models as active. | Confirm what actually runs on m1-max today, or draw it as an online node with `design-target` models. |
