# Jart-URA — Universal Routing Agent

> *"Jart-URA: when the network's got you fried and that Windows box needs to finally earn its keep."*

**Jart-URA** stands for **Universal Routing Agent** (or Universal Routing API, take your pick). But there's a second meaning — straight from Andalucía:

**"Jartura"** — that bone-deep exhaustion you feel after trying to set up a native dev environment on a commercial operating system. The max level of "I'm done." Jart-URA is what you reach for when you're there.

---

## What it does

Jart-URA is a model router for [Tier-0](https://github.com/Ruben-Alvarez-Dev/Jart-OS). It takes a declarative config and turns it into running endpoints — spinning up local `llama-server` processes and proxying API models from OpenAI, Anthropic, OpenRouter, and more.

Each model gets its own port in the 9000-9999 range. One router to rule them all.

```json
{
  "models": [
    { "name": "primary", "port": 9001, "source": "local", "engine": "metal" },
    { "name": "gpt-4o",  "port": 9010, "source": "api",   "provider": "openai" }
  ]
}
```

## Features

- **Local model serving** — spawns `llama-server` with engine-specific config (Metal, CoreML, Planar3)
- **API model proxying** — lightweight HTTP forwarder with env-var-based API keys (never in config files)
- **Process supervision** — auto-restart on crash with configurable retries, serial startup
- **Health & registry** — `GET /health` on each model port, `GET /v1/models` for the full registry
- **Graceful shutdown** — SIGTERM/SIGINT kills all child processes and cleans up PIDs
- **Zero Docker** — bare metal only, no container overhead for inference

## Quick start

```bash
# Install
git clone git@github.com:Ruben-Alvarez-Dev/Jart-URA.git
cd Jart-URA
npm install

# Configure
# Edit config/models.json with your models and API keys (via env vars)

# Run
npm start
```

## Directory structure

```
Jart-URA/
├── config/models.json    ← Declarative model configuration
├── engines/              ← Engine binaries (metal, coreml, planar3)
├── models/               ← GGUF model files
├── src/
│   ├── config-parser.js  ← Config validation & parsing
│   ├── process-manager.js← Local model process lifecycle
│   └── api-proxy.js      ← Remote API proxy
├── server.js             ← Core router
├── tests/                ← Vitest test suite (23 tests, all pass)
├── logs/                 ← Runtime logs
└── pids/                 ← Process PID files
```

## Architecture

```
Agent → Jart-OS-AI (:9101) → Jart-URA (:9100) → llama-server (:9001-9099)
                                                   → API providers (external)
```

## Test

```bash
npm test           # 23 tests, all green
npm run test:watch # TDD mode
```

## License

MIT
