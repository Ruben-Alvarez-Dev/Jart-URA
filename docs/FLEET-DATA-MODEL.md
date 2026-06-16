# JART-URA — Fleet Data Model (the data substrate the dashboard renders)

This is the **data side** of the cinematic dashboard, not the UX. It defines the
entities, their relationships and provenance, the state model, and the API
contract the dashboard consumes. Companion file: [`fleet-entities.yaml`](./fleet-entities.yaml)
(the structural map). The UX/visual layer (camera, neon, side panels) is owned by
the Jart-URA design branch and consumes this.

## 1. Why this exists

The current `dashboard/` boots on **mock data** (`src/data/fleet.js`,
`useFleet` `usingMock = true`, "datos mock" badge). That violates the project's
golden rule #1 (no mock/fake). This model anchors the rebuild to **real**
sources so the dashboard is a faithful mirror of the system — touching a piece
shows exactly what is happening, where (the "fidelity = magic" tip from the
notes).

## 2. Entities and relationships

```
machine ──contains──> component (cpu, ram, ane, gpu, disk, nic)
machine ──runs──────> process / service        (observed in snapshots)
machine ──hosts─────> jart-ura router (:9100) ──exposes──> model (slot)
model   ──speaks────> protocol (http-openai, http-mgmt, …)
route   ──traverses─> machine(s) via protocol(s)   (chat, mesh, voice, …)
node    ──peers─────> node            over Tailscale/WireGuard
```

`fleet-entities.yaml` carries: `machines[]` (with hardware + observed
services), `models[]` (inference slots), `protocols[]` (channel kinds →
accent colour), `routes[]` (edges to illuminate), `states` (the status model).

## 3. Provenance — the honesty layer

Every entity is tagged so the dashboard never paints unverified data as fact:

| tag | meaning | example |
| --- | --- | --- |
| `observed` | seen in a node snapshot (2026-06-11) | Mac mini IPs/processes; the VPS-ionos Docker stack |
| `configured` | declared in `config/models.json` | the 7 Mac-mini model slots |
| `documented` | ARCHITECTURE target, not confirmed deployed | MacBook-Pro models; "Contabo" services |

**Open discrepancies to resolve (do not guess):**
- ARCHITECTURE describes a **VPS Contabo** with LiteLLM (`:10280`), Qdrant and
  FRONTIER BENCH (`:4400`). The **observed** VPS is **ionos** (`82.223.64.198`)
  running `Jart-OS-remote-server` (LiveKit, NATS, Authentik, monitoring) — none
  of those three are present. Confirm whether Contabo is separate / planned /
  renamed.
- The Mac-mini snapshot shows **no** `llama-server` on `9001-9006` and **no**
  `:9100` listening at capture time → models are `configured`, not observed
  running. The dashboard must show their **real** runtime status, not assume up.

## 4. State model (real status, never mock)

- **model**: `running | degraded | failed | stopped` — from `/v1/registry`.
- **node**: `online | idle | offline` — from Tailscale / health.
- **connection**: `connecting | live | offline` — dashboard ↔ feed. Replace the
  current silent `usingMock` fallback with an **honest** connection badge.

## 5. API contract (what the dashboard fetches)

### 5.1 `GET :9100/v1/registry` — exists today

Returns `{ hostname, local[], peered[], peers[], unified[] }`. Per-entry fields
the backend emits today (see `dashboard/src/lib/api.js → mapRegistryEntry`):
`name, port, source (local|api), provider, api_model, type, supports_vision,
supports_function_calling, max_tokens, status, hostname, tailscale_addr, local`.

The dashboard's `mapRegistryEntry` already normalizes this correctly — **keep
it**, just remove the mock fallback in `useFleet` and the `fleet.js` file.

### 5.2 `GET :9100/v1/health/full` — proposed (fills the `—` fields)

Today these render as `null`/`—` because the backend does not emit them. Each
has a **real** source — none should be invented:

| field | real source |
| --- | --- |
| `context`, `gpu_layers`, `threads`, `default_args` | `config/models.json` (already loaded by the registry) |
| `pid`, `restarts`, `last_restart`, `uptime`, `status` | `src/process-manager.js` (it owns the llama-server processes) |
| `tps`, `p50`, `p95`, `p99`, `load`, `req_active`, `req_total` | each `llama-server`'s own `/health` + `/metrics`, sampled |
| `cost_layer` | `config/models.json` (api tiers: flat / ppu / backup) |
| `certification`, `benchmark_source` | FRONTIER BENCH (when/if that node exists — `documented`) |

This endpoint is a **spec proposal**, not yet implemented — it would live beside
the existing registry in the Node backend. Implementing it touches
`server.js` / `process-manager.js`, which currently hold **uncommitted work in
the Jart-URA session**, so it is deliberately left for that session to pick up
(coordinate before editing those files).

## 6. How this maps to the dashboard

1. **Topology** (machines, components, protocols, routes) → from
   `fleet-entities.yaml`: the scene the camera flies over.
2. **Live state** (model status, metrics, node up/down) → from `/v1/registry`
   (+ proposed `/v1/health/full`): what lights up, in what colour, right now.
3. **Routes** (`chat-local`, `chat-cloud`, `mesh-peer`, `voice`, `monitoring`)
   → the paths illuminated on touch, coloured by `protocol.accent`.

## 7. Physical layer & datapaths (cable → NIC → chip → RAM → GPU/ANE)

`fleet-entities.yaml` models three zoom depths — machines → components →
transports/datapaths — so the camera can reveal the inner level on deep zoom.

**Component taxonomy** (`component_types`, normalized): compute (cpu, gpu, ane,
vcpu), memory (unified-ram, ram), storage (nvme, virtual-disk), io
(nic-ethernet, nic-wifi, loopback, vpn-tunnel, docker-bridge), bus
(unified-memory, nvme-link, pcie-thunderbolt, virtio).

**Transports** (the cables/wifi/tunnels, all observed): `lan-home`
(Ethernet + Wi-Fi, `192.168.1.0/24`), `wan-internet`, `tailscale-overlay`
(WireGuard UDP/41641, `100.x` mesh), `vps-docker-net` (`172.x` bridges).

**Apple Silicon specifics** (they decide *which component* a model travels
through):
- Unified memory — CPU, GPU and ANE share one RAM pool; no CPU→GPU copy.
- `llama-server` / Ollama compute on the **Metal GPU** (`gpu_layers=99` = all
  layers on GPU); each model carries `compute: gpu`.
- `whisper` STT and `Kokoro` TTS run on the **ANE via CoreML** (or CPU), not the
  GPU — so the voice path lights the ANE, the chat path the GPU.
- The Mac mini is wired by **Ethernet** (`en0`, active); its Wi-Fi (`en1`) is
  present but unused — the map shows the real medium.

**Datapaths** decompose each route into the physical hop sequence to illuminate
piece by piece. Example `dp-chat-local-lan`: client NIC → `lan-home` → router →
mac-mini `en0` → `lo0` → jart-ura → llama-server → `nvme` (weights) → unified
`ram` → `gpu` (Metal) → back. Five shipped: chat-local (LAN + remote),
chat-cloud, mesh-peer, voice.

**Provenance:** chip-level facts (M1 GPU/ANE, unified memory) are tagged
`hardware-spec` — known from the SKU, exact core counts flagged to confirm. NIC
mediums, IPs, RAM size and the VPS stack are `observed` from the snapshots.

## 8. Scope boundary

This file and `fleet-entities.yaml` are the **data contract**. They contain no
visual/interaction design (camera easing, neon palette, side-panel choreography,
"sad-anime" asset treatment) — that is the design branch's call, built on top of
this. Nothing here was taken from the mock; every value traces to §3 provenance.
