# JART-URA — Live Metrics Layer (spec)

- **Status:** corrected 2026-06-16 to match the implemented `src/metrics-sampler.js`
  and verified llama.cpp `/metrics` behaviour. Real data only; nothing fabricated.
- **Companion:** [`FLEET-DATA-MODEL.md`](./FLEET-DATA-MODEL.md) §5.

These are the per-model performance fields the dashboard renders. Most are **real
today**; only per-request **latency percentiles** and the **total request count**
still lack an honest source — and this spec explains exactly why and what it would
take, without breaking the working direct-path inference.

## 1. Current reality — what is real vs the gap (verified)

| field | real today? | source |
|-------|-------------|--------|
| `tps` | ✅ yes | llama.cpp `/metrics` `predicted_tokens_seconds` |
| `prompt_tps` | ✅ yes | llama.cpp `/metrics` `prompt_tokens_seconds` |
| `load` (%) | ✅ yes | llama.cpp `/metrics` `kv_cache_usage_ratio` × 100 |
| `req_active` | ✅ yes | llama.cpp `/metrics` `requests_processing` |
| `req_deferred` | ✅ yes | llama.cpp `/metrics` `requests_deferred` |
| token totals | ✅ yes | `tokens_predicted_total`, `prompt_tokens_total` |
| `p50` / `p95` / `p99` | ❌ no | none — see §3 |
| `req_total` | ❌ no | none — see §3 |

The ✅ fields are already scraped and mapped by `src/metrics-sampler.js`
(implemented). **Prerequisite:** each local `llama-server` must be launched with
`--metrics` so it serves `/metrics`.

## 2. Real source (per local model)

Each local model is a `llama-server` (llama.cpp) on its own port `:900x`, which
exposes there:

- `GET /metrics` — Prometheus text (requires `--metrics`): token throughput,
  processed/deferred request gauges, KV-cache usage, token counters.
- `GET /slots` — per-slot live state.
- `GET /health` — liveness.

> ⚠️ Confirm exact metric names against the **deployed** llama-server build (a
> running binary, not docs) before relying on any — capture one real `/metrics`
> body and map from it. (Rule #6: verify, don't assume.)

For **API** models (`source: api`) there is no local `/metrics`; their latency
could only be measured at the proxy hop. Never synthesize cloud metrics.

## 3. Why latency + `req_total` have NO honest source (corrected)

The earlier draft proposed computing `p50/p95/p99` from a per-model **ring buffer
in the sampler**. That is **not feasible**, and the implemented sampler correctly
leaves them `null`:

- The sampler **polls aggregate `/metrics` every cadence**; it never observes
  individual requests. A latency histogram needs per-request timings the sampler
  cannot see.
- Verified against a second source: llama.cpp `/metrics` exposes throughput,
  KV-cache and token **counters/gauges**, **not a per-request latency histogram**
  (unlike TGI/vLLM). So there is nothing to read percentiles from.
- `req_total`: `/metrics` exposes `requests_processing` / `requests_deferred`
  **gauges**, not a clean cumulative request counter → `req_total` stays `null`
  until something counts requests.

To produce real latency/`req_total`, Jart-URA must be **in the request path** (a
measuring proxy that times each call) or **parse per-request server logs**. Both
are separate units of work — see §5.

## 4. Status of the sampler (implemented)

`src/metrics-sampler.js` already: scrapes `http://127.0.0.1:<port>/metrics` for
each local running model on the existing cadence, parses the Prometheus text with
a small built-in reader (no new dependency — repo stays on `yaml` only), maps the
real fields, and exposes `getMetrics(name) → { tps, prompt_tps, load, req_active,
… , p50:null, p95:null, p99:null, req_total:null }` or `null` when unreachable.
`server.js` merges it into `modelToJson` (`/v1/registry`) and `handleHealthFull`
(`/v1/health/full`). So `tps/load/req_active` are **live now**; only latency and
`req_total` remain.

## 5. Latency — deferred design (NOT implemented; needs approval)

- **Recommended when needed — opt-in measuring proxy** (`src/metrics-proxy.js`,
  **off by default**): only models flagged `"measured": true` route through it;
  every other model keeps the current direct path untouched (rule #4 — don't break
  what works). It times each request, computes percentiles (t-digest / bounded
  buffer) and counts `req_total`, surfaced through the existing endpoints.
- **Alternative — parse llama.cpp per-request timing logs**: no hot-path overhead,
  but brittle and only generation time, not end-to-end.
- Until one is built and approved: `p50/p95/p99` and `req_total` = `null` (honest).

## 6. Honest degradation

If `/metrics` is unreachable (model stopped, build without `--metrics`, or
`source: api`): emit `null`/`—`, never a mock fallback. The connection/state badge
shows the real condition. This is the rule the whole rebuild exists to honour.

## 7. Verification plan (against the real system)

1. **Capture** `curl 127.0.0.1:9001/metrics` from a real loaded model → reference
   sample (real data, not invented fixtures).
2. **Unit**: Prometheus-text parser → numbers, against that captured sample.
3. **Integration**: with a model loaded, `GET /v1/health/full` shows non-zero
   `tps`/`req_active`; `POST /v1/models/:name/unload` → next poll degrades to `—`
   (proves no stale/fake values).
4. **Cross-check** metric names against the deployed binary (second source).

## 8. Integration notes & coordination

- `src/metrics-sampler.js` — **implemented** (Phase 1: throughput/load/active).
- `server.js` (`modelToJson`, `handleHealthFull`) — **wired**.
- `config/models.json` / engine `default_args` — ensure `--metrics` on local
  engines so the source exists on every node.
- `src/metrics-proxy.js` — **new, latency only, deferred** (§5).
- These files hold uncommitted work in the Jart-URA session → coordinate /
  commit-stash before any further code edit to avoid clobbering the working tree.
