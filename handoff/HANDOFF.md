# Handoff — Memory Enrichment Phase A (Quick Win)

> **Agent target**: any Python-capable agent (Cursor, Claude Code, opencode)
> **Language**: Python 3.12, FastAPI, pytest
> **Duration**: 3-4 days
> **Source of truth**: this file + the referenced specs. Nothing else.

---

## What you are building

A **transparent middleware** that intercepts every LLM request, retrieves relevant memory from the existing Backpack API (`:8890`), and injects it into the system prompt. The agent gets memory automatically without changing any client code.

```
Client → POST /v1/chat/completions → EnrichmentMiddleware → Backpack API :8890
                                          ↓
                                    enriched messages
                                          ↓
                                  Middleware → backend LLM
```

Standalone endpoint for IDE hooks:
```
POST /api/enrich  →  { messages, injection_text, was_enriched, latency_ms }
```

---

## Step-by-step execution

### 1. Create the project structure

```
router-jart/                     ← NEW repo or subdirectory
├── src/
│   └── enrichment/
│       ├── __init__.py
│       ├── core/
│       │   ├── __init__.py
│       │   ├── ports.py         ← IMemoryRetriever, IContextExtractor (ABCs)
│       │   ├── models.py        ← MemoryFact, MemoryResult, EnrichmentConfig (dataclasses)
│       │   └── service.py       ← EnrichmentService (orchestrator)
│       ├── adapters/
│       │   ├── __init__.py
│       │   ├── memory/
│       │   │   ├── __init__.py
│       │   │   ├── backpack.py  ← BackpackMemoryAdapter (HTTP to :8890)
│       │   │   └── null.py      ← NullMemoryAdapter (tests)
│       │   ├── extraction/
│       │   │   ├── __init__.py
│       │   │   └── message.py   ← MessageContextExtractor
│       │   └── injection/
│       │       ├── __init__.py
│       │       ├── system_prompt.py  ← SystemPromptInjector
│       │       └── noop.py           ← NoopInjector (tests)
│       ├── middleware.py        ← FastAPI ASGI middleware
│       ├── factory.py           ← build_enrichment_service() from env vars
│       └── tests/
│           ├── __init__.py
│           ├── conftest.py
│           ├── test_service.py
│           ├── test_backpack_adapter.py
│           ├── test_extractor.py
│           ├── test_injector.py
│           └── test_middleware.py
├── app.py                       ← FastAPI app entry point
├── pyproject.toml
└── README.md
```

### 2. Implement each file

**ALL code is in `memory-enrichment/implementation/PHASE-A-quickwin.md`** — read it, it has every file with complete implementations. Copy-adapt, don't reinvent.

The key files and their responsibilities:

| File | What it does | Lines |
|------|-------------|-------|
| `core/ports.py` | Two ABCs: `IMemoryRetriever` (async query, never throws) and `IContextExtractor` (sync extract) | ~35 |
| `core/models.py` | `MemoryFact`, `MemoryResult`, `EnrichmentConfig` dataclasses. `EnrichmentConfig.from_env()` reads env vars. | ~55 |
| `core/service.py` | `EnrichmentService.enrich(messages)` — orchestrates extract→retrieve→inject. NEVER throws. | ~60 |
| `adapters/memory/backpack.py` | `BackpackMemoryAdapter` — HTTP POST to `:8890/api/request-context`. Uses `urllib` (no extra deps). | ~80 |
| `adapters/extraction/message.py` | `MessageContextExtractor` — last user msg + system entities + sliding window. Max 512 tokens out. | ~60 |
| `adapters/injection/system_prompt.py` | `SystemPromptInjector` — prepends `[JART-MEMORY:...]` block to system prompt. Idempotent. | ~30 |
| `middleware.py` | FastAPI ASGI middleware. Only intercepts `POST /v1/chat/completions`. | ~70 |
| `factory.py` | `build_enrichment_service()` — wiring from env vars. | ~15 |

### 3. Write tests

Tests use `NullMemoryAdapter` (returns empty) and `NoopInjector` (passthrough) for isolation.

**Required test cases:**

```
test_service.py:
  - enrich() with empty messages → returns original
  - enrich() with already-injected [JART-MEMORY → returns original
  - enrich() with relevant memory → system prompt contains [JART-MEMORY
  - enrich() when retriever throws → returns original (never throws)
  - enrich() when extractor returns empty → returns original
  - enrich() when score < min_score → returns original

test_backpack_adapter.py:
  - query() with mock HTTP server → returns parsed MemoryResult
  - query() when server times out → returns MemoryResult.empty()
  - query() when server returns error → returns MemoryResult.empty()
  - health() when server up → True
  - health() when server down → False

test_extractor.py:
  - extract() with single user message → returns that message
  - extract() with system + user → includes system entities
  - extract() with conversation history → includes recent context
  - extract() with empty messages → returns ""

test_injector.py:
  - inject() with facts → prepends [JART-MEMORY block to system prompt
  - inject() with no system prompt → creates one
  - inject() already has [JART-MEMORY → returns original (idempotent)
  - inject() with empty facts → returns original

test_middleware.py:
  - POST /v1/chat/completions → intercepted and enriched
  - POST /v1/embeddings → passed through untouched
  - GET /v1/models → passed through untouched
  - enrichment failure → request passes through unchanged
  - agent_id in skip list → passed through
```

### 4. Verify

```bash
# Unit tests
pytest src/enrichment/tests/ -v

# Integration test (requires Backpack API running on :8890)
curl -s -X POST http://localhost:10200/api/enrich \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "qué configuración tiene Router-Jart?"}], "agent_id": "test"}'

# Expected: was_enriched: true, facts_count > 0, latency_ms < 300
```

### 5. Commit convention

```
feat(enrichment): <what> — conventional commits, English, 2-4 sentences.
```

---

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `ENRICHMENT_ENABLED` | `true` | Kill switch |
| `ENRICHMENT_MEMORY_URL` | `http://localhost:8890` | Backpack API URL |
| `ENRICHMENT_TOKEN_BUDGET` | `2000` | Max tokens to inject |
| `ENRICHMENT_MIN_SCORE` | `0.65` | Minimum fact score |
| `ENRICHMENT_TIMEOUT_MS` | `500` | Hard timeout for retrieval |
| `ENRICHMENT_CACHE_TTL_S` | `60` | Cache TTL for query results |
| `ENRICHMENT_SKIP_AGENT_IDS` | `` | Comma-separated agent IDs to skip |

---

## References (read these, don't deviate)

| Doc | Path | What it gives you |
|-----|------|-------------------|
| **Phase A implementation** | `memory-enrichment/implementation/PHASE-A-quickwin.md` | COMPLETE CODE for every file |
| **OpenAPI spec** | `memory-enrichment/specs/openapi-enrichment-endpoint.yaml` | API contract for /api/enrich |
| **ADR-002** | `ADR-002-memory-enrichment-architecture.md` | Hexagonal architecture, ports & adapters |
| **ADR-004** | `memory-enrichment/adr/ADR-004-enrichment-router-placement.md` | Why middleware lives in Router-Jart |
| **Backpack API** | `http://localhost:8890/api/request-context` | The memory service you'll call |

---

## What you do NOT touch

- ❌ MCP-agent-memory — don't modify it, just consume its Backpack API
- ❌ Qdrant — not in Phase A
- ❌ Jart-URA (Node.js) — it's the control plane, separate repo
- ❌ Jart-BRAIN — that's Phase E
- ❌ NATS — that's Phase F
- ❌ Any file outside `router-jart/`

---

## Acceptance criteria (check all)

- [ ] `pytest` green, coverage > 85% on service + adapters
- [ ] `POST /api/enrich` responds < 300ms p95 with Backpack API up
- [ ] Silent degradation: Backpack API down → request passes through unchanged, < 600ms
- [ ] Idempotent: no duplicate `[JART-MEMORY` injection on consecutive calls
- [ ] `POST /v1/embeddings` and other paths pass through untouched
- [ ] All env vars documented and have sensible defaults
