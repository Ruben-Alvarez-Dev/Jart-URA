# Jart-URA — Universal Routing Agent

> *"Jart-URA: when the network's got you fried and that Windows box needs to finally earn its keep."*

**Jart-URA** (Universal Routing Agent / Universal Routing API) is a configuration-driven model router for [Tier-0](https://github.com/Ruben-Alvarez-Dev/Jart-OS). It manages local inference processes (`llama-server`) and proxies remote API models (OpenAI, Anthropic, OpenRouter) — each on its own port. No Docker, no database, no overhead.

The name carries a second meaning from Andalucía: **"jartura"** — the bone-deep exhaustion you feel after wrestling native dev environments on a commercial OS. Jart-URA is what you reach for when you're there.

---

## How it works

```
┌──────────────────────────────────────────────────────┐
│                   Jart-URA (:9100)                    │
│                                                       │
│  config/models.json                                   │
│       │                                               │
│       ▼                                               │
│  ┌──────────────────────────────────────┐             │
│  │         Model Registry                │             │
│  │  - Parses & validates config          │             │
│  │  - Assigns ports from range           │             │
│  │  - Tracks model metadata + status     │             │
│  └───────┬──────────────────────────────┘             │
│          │                                             │
│  ┌───────┼───────────────────────────┐                 │
│  ▼       ▼                           ▼                 │
│ ┌─────┐ ┌─────┐     ...           ┌─────┐            │
│ │:9001│ │:9002│                   │:9010│            │
│ │local│ │local│                   │ API │            │
│ └──┬──┘ └──┬──┘                   └──┬──┘            │
│    │       │                         │                │
│    ▼       ▼                         ▼                │
│ llama   llama                   HTTP proxy            │
│ server  server                  → api.openai.com      │
│ qwen2.5 qwen3.5                 → anthropic           │
│ 7b      2b                                          │
│                                                       │
│  management endpoints: /health  /v1/models            │
└──────────────────────────────────────────────────────┘
```

On startup, Jart-URA reads `config/models.json`, validates every model definition, then:
- **Local models**: spawns `llama-server` with the correct engine binary, model file, and parameters on the assigned port
- **API models**: starts a lightweight HTTP proxy on the assigned port that forwards requests to the external provider
- **Management API**: serves `/health` and `/v1/models` on the management port (default :9100)

If a local model crashes, it's automatically restarted (with configurable retries) without affecting other models. On SIGTERM/SIGINT, all child processes are killed and PID files cleaned up.

---

## Prerequisites

- **Node.js >= 20**
- **Engine binaries** in `engines/` — at least one of:
  - `engines/metal/llama-metal` (Apple Silicon / Metal GPU)
  - `engines/coreml/llama-coreml` (Apple Neural Engine)
  - `engines/planar3/llama-planar3` (multi-platform CPU)
- **Model files** (GGUF format) in `models/`
- **API keys** as environment variables (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)

---

## Quick start

```bash
git clone git@github.com:Ruben-Alvarez-Dev/Jart-URA.git
cd Jart-URA
npm install

# Configure models
vim config/models.json

# Set API keys (if using API models)
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# Start
npm start
```

---

## Configuration reference

### `models.json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port_range` | `[number, number]` | No | Allowed port range. Default: `[9000, 9999]` |
| `models` | `Model[]` | Yes | Array of model definitions |
| `engines` | `object` | No | Engine binary paths and default args |
| `server` | `object` | No | Management server settings |

### Model fields (all `source` types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique model identifier |
| `port` | `number` | Yes | Port within `port_range` |
| `source` | `"local" \| "api"` | Yes | Model source type |

### Local model fields (`source: "local"`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `engine` | `string` | Yes | Engine key from `engines` config |
| `model_path` | `string` | Yes | Path to GGUF model file |
| `context` | `number` | Yes | Context window size in tokens |
| `gpu_layers` | `number` | Yes | Number of layers to offload to GPU |
| `threads` | `number` | Yes | CPU threads for inference |
| `type` | `"chat" \| "embedding"` | No | Model type. Default: `"chat"` |

### API model fields (`source: "api"`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | Yes | Provider name (e.g. `"openai"`, `"anthropic"`) |
| `api_model` | `string` | Yes | Remote model ID (e.g. `"gpt-4o"`) |
| `api_key_env` | `string` | Yes | Environment variable name holding the API key |
| `base_url` | `string` | Yes | Provider API base URL |

### Engine config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bin` | `string` | Yes | Path to engine binary |
| `default_args` | `string[]` | No | Additional CLI arguments for the engine |

### Server config

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | `string` | No | `"0.0.0.0"` | Management server bind address |
| `port` | `number` | No | `9100` | Management server port |
| `log_dir` | `string` | No | `"logs/"` | Log directory |
| `pid_dir` | `string` | No | `"pids/"` | PID file directory |

### Example

```json
{
  "port_range": [9000, 9999],
  "models": [
    {
      "name": "primary",
      "port": 9001,
      "source": "local",
      "engine": "metal",
      "model_path": "models/qwen2.5-7b-instruct-Q4_K_M.gguf",
      "context": 16384,
      "gpu_layers": 99,
      "threads": 6,
      "type": "chat"
    },
    {
      "name": "gpt-4o",
      "port": 9010,
      "source": "api",
      "provider": "openai",
      "api_model": "gpt-4o",
      "api_key_env": "OPENAI_API_KEY",
      "base_url": "https://api.openai.com/v1"
    }
  ],
  "engines": {
    "metal": {
      "bin": "engines/metal/llama-metal",
      "default_args": ["--no-mmap", "--mlock"]
    }
  },
  "server": {
    "host": "0.0.0.0",
    "port": 9100
  }
}
```

---

## API reference

### Management endpoints (`http://localhost:9100`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Overall system health with per-model status |
| `GET` | `/v1/models` | List all registered models with their status |

### Per-model endpoints (`http://localhost:<model-port>`)

Each model port proxies requests transparently. For local models, `llama-server` exposes an OpenAI-compatible API:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Chat completion |
| `POST` | `/v1/completions` | Text completion |
| `POST` | `/v1/embeddings` | Embeddings (embedding-type models only) |

API model ports forward all traffic directly to the configured provider.

---

## Environment variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `JART_URA_CONFIG` | No | Path to config file. Default: `config/models.json` |
| `JART_URA_PID_DIR` | No | PID directory. Default: `pids/` |
| `OPENAI_API_KEY` | OpenAI models | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic models | Anthropic API key |
| `OPENROUTER_API_KEY` | OpenRouter models | OpenRouter API key |

---

## Service management

```bash
# Start as background service
./start.sh

# Graceful stop
./stop.sh

# Or run directly
npm start
```

All logs go to `logs/jart-ura.log` when started via script, stderr when via `npm start`.

---

## Development

```bash
npm test              # Run test suite (Vitest)
npm run test:watch    # TDD mode
npm run test:coverage # Coverage report
```

The test suite (23 tests) validates:
- Config parsing with validation and error handling
- Local model process lifecycle (start, stop, crash recovery, restart limits)
- API proxy forwarding with timeout and error handling
- Server endpoints (health, model registry)

---

## Project structure

```
Jart-URA/
├── config/models.json        → Model and engine configuration
├── engines/                  → Engine binaries (metal, coreml, planar3)
├── models/                   → GGUF model files
├── src/
│   ├── config-parser.js      → Config validation and parsing with port dedup
│   ├── process-manager.js    → Local process lifecycle with auto-restart
│   └── api-proxy.js          → Remote API forwarder with timeout handling
├── server.js                 → Core server: orchestration, health, registry, shutdown
├── tests/                    → Vitest test suite
│   ├── config-parser.test.mjs
│   ├── process-manager.test.mjs
│   ├── api-proxy.test.mjs
│   └── server.test.mjs
├── service.conf              → Tier-0 service configuration
├── start.sh                  → Background daemon launcher
├── stop.sh                   → Graceful shutdown script
└── logs/ pids/               → Runtime state
```

---

## Roadmap

### v1 (current)
- [x] Configuration-driven model registry
- [x] Local model process management with auto-restart
- [x] API model proxying (OpenAI, Anthropic, OpenRouter)
- [x] Per-model health checks
- [x] Unified `/v1/models` registry endpoint
- [x] Graceful lifecycle (SIGTERM/SIGINT)
- [x] Model isolation (crash one, others keep running)
- [x] Streaming response support

### v2 (near-term)
- [ ] Config hot-reload (no restart needed)
- [ ] Rate limiting per API key
- [ ] Request logging and token usage tracking
- [ ] Web dashboard for model management
- [ ] `llama-server` log rotation

### v3 (mid-term)
- [ ] Multi-machine mesh: mDNS discovery + remote model proxy
- [ ] Automatic model distribution across machines
- [ ] GPU memory pooling across local models
- [ ] Dynamic model loading/unloading

### Future
- [ ] Token management and API key rotation
- [ ] Load balancing across machines
- [ ] Automatic fallback between equivalent models
- [ ] MCP Apps integration for model switching

---

## Integration with Jart-OS-AI

Jart-URA works with [Jart-OS-AI](https://github.com/Ruben-Alvarez-Dev/Jart-OS) (the capture proxy) for request/response tracing:

```
Agent → Jart-OS-AI (:9101) → Jart-URA (:9100) → llama-server (:9001-9099)
                                                  → API providers (external)
```

Jart-OS-AI captures all prompts, responses, and thinking traces before forwarding to Jart-URA. This is a separate project with its own test suite.

---

## Constraints

- **Zero Docker** — Tier-0 is bare metal. Container overhead is unacceptable for inference.
- **Port isolation** — Ports 9000–9999 reserved exclusively for model endpoints.
- **Fail-fast** — Invalid model configs are logged and skipped. The router starts with valid models.
- **API keys via env vars** — Never committed to config files. Referenced by `api_key_env`.

## License

MIT
