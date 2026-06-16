# JartOS Desktop — Arquitectura Unificada

> **Autor**: Rubén Alvarez (Arquitecto IT) + Asistente  
> **Fecha**: 2026-06-14  
> **Estado**: DISEÑO v1.0  
> **Objetivo**: Reemplazar Claude Cowork con una app Electron nativa, BYOM (50% local / 50% cloud), que integre la flota completa de infraestructura Jart-OS.

---

## Índice

1. [Visión ejecutiva](#1-visión-ejecutiva)
2. [Diagrama de arquitectura de alto nivel](#2-diagrama-de-arquitectura-de-alto-nivel)
3. [Desglose de módulos y responsabilidades](#3-desglose-de-módulos-y-responsabilidades)
4. [Flujo de datos — interacción típica del usuario](#4-flujo-de-datos--interacción-típica-del-usuario)
5. [Mapa de proyectos existentes → arquitectura unificada](#5-mapa-de-proyectos-existentes--arquitectura-unificada)
6. [Qué es nuevo vs qué se reutiliza](#6-qué-es-nuevo-vs-qué-se-reutiliza)
7. [Stack tecnológico por capa](#7-stack-tecnológico-por-capa)
8. [Modelo de seguridad](#8-modelo-de-seguridad)
9. [Estrategia de despliegue](#9-estrategia-de-despliegue)
10. [Ruta de migración desde Claude Cowork](#10-ruta-de-migración-desde-claude-cowork)
11. [Evaluación honesta de complejidad y timeline](#11-evaluación-honesta-de-complejidad-y-timeline)

---

## 1. Visión ejecutiva

### El problema

Actualmente tu infraestructura LLM está fragmentada en 6+ repositorios, 4 máquinas, y un ecosistema de herramientas que se comunican ad-hoc. Claude Cowork es la UI agéntica, pero depende del SDK de Anthropic — algo que explícitamente no quieres.

### La solución

**JartOS Desktop** es una aplicación Electron nativa que:

- **Reemplaza Claude Cowork** como UI agéntica principal
- **Habla OpenAI Y Anthropic 100%** a través de Jart-URA como backbone de routing
- **BYOM nativo**: 50% local (Ollama/llama.cpp via Jart-URA) + 50% cloud (APIs chinas + occidentales via LLM_ROUTER/LiteLLM)
- **Hereda toda la infraestructura existente** sin migraciones bruscas
- **Funciona offline** con modelos locales certificados por FRONTIER BENCH

### Principios de diseño

1. **Jart-URA es la columna vertebral** — toda inferencia pasa por él (OpenAI + Anthropic specs)
2. **LiteLLM es el gateway cloud** — presupuestos, fallbacks, rate limiting
3. **FRONTIER BENCH certifica** — solo modelos probados entran en producción
4. **Tailscale es la red** — descubrimiento y comunicación entre nodos
5. **Nada se tira** — todo proyecto existente aporta una capa concreta

---

## 2. Diagrama de arquitectura de alto nivel

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        JartOS Desktop (Electron)                            │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Chat UI  │ │ Skills   │ │ Work-    │ │ Scheduled│ │ Computer Use     │  │
│  │ (React)  │ │ Manager  │ │ spaces   │ │ Tasks    │ │ (Gemini vision)  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
│       │             │            │             │                │            │
│  ┌────┴─────────────┴────────────┴─────────────┴────────────────┴─────────┐ │
│  │                    JartOS Core (Main Process)                          │ │
│  │                                                                        │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐  │ │
│  │  │ Session     │ │ Permission   │ │ MCP Client   │ │ Skill         │  │ │
│  │  │ Manager     │ │ System       │ │ Manager      │ │ Executor      │  │ │
│  │  │ (SQLite)    │ │ (ask/act)    │ │ (stdio+SSE)  │ │ (PPTX/DOCX..) │  │ │
│  │  └──────┬──────┘ └──────┬───────┘ └──────┬───────┘ └───────┬───────┘  │ │
│  │         │               │                │                  │           │ │
│  │  ┌──────┴───────────────┴────────────────┴──────────────────┴────────┐ │ │
│  │  │                    Agent Orchestrator                             │ │ │
│  │  │  (tool execution loop, context management, memory retrieval)      │ │ │
│  │  └──────────────────────────┬────────────────────────────────────────┘ │ │
│  │                             │                                          │ │
│  │  ┌──────────────────────────┴────────────────────────────────────────┐ │ │
│  │  │                   Unified LLM Client                             │ │ │
│  │  │  - OpenAI spec: /v1/chat/completions (tool_calls, streaming)     │ │ │
│  │  │  - Anthropic spec: /v1/messages (tool_use, streaming)            │ │ │
│  │  │  - Model selection: local-first, cloud fallback                  │ │ │
│  │  └──────────────────────────┬────────────────────────────────────────┘ │ │
│  └─────────────────────────────┼──────────────────────────────────────────┘ │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   Tailscale Network      │
                    │   (mesh de nodos)        │
                    └────┬───────────────┬─────┘
                         │               │
    ┌────────────────────┴──┐    ┌───────┴────────────────────────┐
    │ Mac Mini M1 16GB      │    │ MacBook Pro M1 Max 32GB        │
    │ (TIER-0-METAL)        │    │ (WORKHORSE)                    │
    │                       │    │                                │
    │ ┌───────────────────┐ │    │ ┌────────────────────────────┐ │
    │ │ Jart-URA :9100    │ │    │ │ Jart-URA :9100             │ │
    │ │ ├─ :9001 primary  │ │    │ │ ├─ :9001 reasoner          │ │
    │ │ ├─ :9002 small    │ │    │ │ ├─ :9002 worker            │ │
    │ │ ├─ :9003 embed    │ │    │ │ ├─ :9003 embed (backup)    │ │
    │ │ ├─ :9004 coder    │ │    │ │ ├─ :9004 vision            │ │
    │ │ ├─ :9005 fast     │ │    │ │ ├─ :9005 fast              │ │
    │ │ └─ :9006 multi    │ │    │ │ └─ API proxies             │ │
    │ └───────────────────┘ │    │ └────────────────────────────┘ │
    │                       │    │                                │
    │ ├─ TTS (Kokoro)       │    │ ├─ Workers (background)       │
    │ ├─ STT (whisper)      │    │ ├─ Vision processing          │
    │ └─ ANE inference      │    │ └─ Heavy reasoning            │
    └───────────────────────┘    └────────────────────────────────┘
                         │               │
    ┌────────────────────┴───────────────┴─────────────────────────┐
    │              VPS Contabo 24GB (SERVICES)                     │
    │                                                              │
    │ ┌──────────────────┐ ┌────────────────┐ ┌─────────────────┐ │
    │ │ LiteLLM :10280   │ │ Monitor :10284 │ │ WebUI :10283    │ │
    │ │ (cloud gateway)  │ │ (spend/stats)  │ │ (model picker)  │ │
    │ └────────┬─────────┘ └────────────────┘ └─────────────────┘ │
    │          │                                                    │
    │ ┌────────┴─────────┐ ┌────────────────┐ ┌─────────────────┐ │
    │ │ Postgres :10281  │ │ TEI (embed+    │ │ Qdrant          │ │
    │ │ (litellm logs)   │ │  reranker)     │ │ (RAG vectors)   │ │
    │ └──────────────────┘ └────────────────┘ └─────────────────┘ │
    │                                                              │
    │ ┌──────────────────┐ ┌────────────────┐                     │
    │ │ LiveKit :7881    │ │ FRONTIER BENCH │                     │
    │ │ (WebRTC voice)   │ │ :4400 (UI)     │                     │
    │ └──────────────────┘ └────────────────┘                     │
    └──────────────────────────────────────────────────────────────┘
                         │
                    ┌────┴────────────────────┐
                    │   Cloud APIs             │
                    │   (vía LiteLLM :10280)   │
                    ├─────────────────────────┤
                    │ Capa 1 (flat/free):      │
                    │  Qwen token-plan         │
                    │  Z.AI coding plan        │
                    │ Capa 2 (PPU):            │
                    │  DeepSeek, Mistral       │
                    │  Chutes, OpenRouter      │
                    │ Capa 3 (backup):         │
                    │  Groq (capado)           │
                    └─────────────────────────┘
```

---

## 3. Desglose de módulos y responsabilidades

### 3.1 JartOS Desktop — Electron App

#### 3.1.1 UI Layer (Renderer Process)

| Módulo | Tecnología | Responsabilidad |
|--------|-----------|-----------------|
| **Chat UI** | React + TailwindCSS | Conversación con el agente, streaming de tokens, visualización de tool calls |
| **Skills Manager** | React | Instalar/habilitar/deshabilitar skills (PPTX, DOCX, PDF, XLSX, code exec, web search) |
| **Workspaces** | React + SQLite | Proyectos aislados con su propio contexto, memoria, y configuración |
| **Scheduled Tasks** | React + cron-parser | UI para crear/editar tareas programadas (cron expressions) |
| **Computer Use** | React + canvas overlay | GUI automation via Gemini vision (screenshots → acciones) |
| **Settings** | React | Configuración de modelos, APIs, permisos, Tailscale, MCP servers |
| **Model Selector** | React | Selector BYOM: local (Jart-URA) + cloud (LiteLLM), con estado en tiempo real |

#### 3.1.2 Core Layer (Main Process)

| Módulo | Tecnología | Responsabilidad |
|--------|-----------|-----------------|
| **Session Manager** | better-sqlite3 | Persistir conversaciones, contexto, memoria a sesiones |
| **Permission System** | Custom (ask/act modes) | Controlar qué puede hacer el agente sin supervisión |
| **MCP Client** | @modelcontextprotocol/sdk | Conectar a MCP servers (stdio y SSE), descubrir tools |
| **Skill Executor** | child_process + sandbox | Ejecutar skills de generación de documentos, code execution |
| **Agent Orchestrator** | Custom event loop | Loop principal: mensaje → contexto → tools → LLM → respuesta |
| **Unified LLM Client** | got/undici | Cliente HTTP que habla OpenAI spec Y Anthropic spec transparentemente |
| **Memory System** | SQLite + embeddings | Memoria a corto plazo (sesión) y largo plazo (persistente) |
| **Sandbox Manager** | Lima (macOS) / Docker (Linux) | Aislamiento de ejecución de código |

#### 3.1.3 IPC Bridge

```
Renderer ←→ Main Process: contextBridge + ipcRenderer/ipcMain
  - llm:stream-start, llm:stream-chunk, llm:stream-end
  - permission:request, permission:grant, permission:deny
  - skill:execute, skill:progress
  - session:load, session:save, session:list
  - workspace:create, workspace:switch, workspace:list
  - mcp:tools-list, mcp:tool-call
  - model:status, model:health
```

### 3.2 Routing Backbone — Jart-URA

**Ubicación**: `~/Code/Jart-URA` (existente, se extiende)  
**Puerto management**: `:9100`  
**Puertos modelos**: `:9001-:9099`  
**Config**: `config/models.json`

**Responsabilidades ampliadas**:

1. **Router local primario** — gestiona llama-server processes con auto-restart
2. **API proxy** — modelos cloud accedidos directamente (OpenAI, Anthropic, OpenRouter)
3. **Mesh registry** — descubrimiento Tailscale de peers (cada máquina es un nodo)
4. **Spec compliance** — los puertos locales exponen OpenAI spec, el proxy traduce a Anthropic spec cuando el modelo remoto lo requiere
5. **Process manager** — spawn/kill/restart con PID files y health checks
6. **NUEVO: Gateway mode** — Jart-URA actúa como único endpoint para Electron, resolviendo internamente si va a local o cloud

**Cambios necesarios en Jart-URA**:

```javascript
// Nuevos endpoints en server.js
// POST /v1/chat/completions  → OpenAI spec (ya funciona vía llama-server)
// POST /v1/messages          → Anthropic spec (NUEVO: traduce a OpenAI internamente)
// GET  /v1/models/all        → modelos locales + peered + cloud (fusionado)
// POST /v1/route             → NUEVO: elige modelo según criteria (role, budget, privacy)
// GET  /v1/health/full       → health detallado de todos los backends
```

### 3.3 Cloud Gateway — LLM_ROUTER (LiteLLM)

**Ubicación**: VPS Contabo (Docker)  
**Puertos**: `:10280` (LiteLLM), `:10281` (Postgres), `:10282` (vLLM), `:10283` (WebUI), `:10284` (Monitor)  
**Config**: `config.yaml` (existente, se amplía)

**Responsabilidades**:

1. **Gateway cloud** — 100+ proveedores detrás de API OpenAI-compatible
2. **Política de gasto** — 3 capas: flat (Qwen/Z.AI) → PPU (DeepSeek/Mistral) → local
3. **Fallback en cascada** — automático entre capas
4. **Rate limiting** — RPM/TPM por modelo (ya implementado para Groq)
5. **Monitor API** — gasto acumulado, por proveedor, por modelo, diario
6. **NUEVO: Integración con Jart-URA** — Jart-URA apunta a LiteLLM como "provider cloud"

**Flujo de integración**:

```
Electron → Jart-URA (:9100) → decides:
  ├─ local? → llama-server (:9001-9006) directamente
  └─ cloud? → LiteLLM (:10280) → proveedor adecuado
```

### 3.4 Certificación — FRONTIER BENCH

**Ubicación**: `~/Code/LLM-BENCHMARKS` (existente)  
**UI**: `:4400`  
**DB**: SQLite WAL (`data/frontier_bench_v2.db`)  
**Config**: `batteries.yaml`, `verdict_rules.yaml`, `techniques.yaml`

**Responsabilidades**:

1. **Certificar modelos** — solo modelos con veredicto APTO/FRONTERA entran en `models.json` de Jart-URA
2. **Benchmark fleet** — medir en cada nodo (m1-mini, m1-max, ryzen-5600g, contabo-vps)
3. **Tuning rules** — parámetros óptimos por hardware (threads, gpu_layers, context)
4. **NUEVO: API de consulta** — JartOS Desktop consulta FRONTIER BENCH para mostrar "certificación" al lado de cada modelo en el selector

**Endpoints que consume JartOS Desktop**:

```bash
GET  /api/machines              # lista de nodos certificados
GET  /api/results?model=X       # resultados de un modelo
GET  /api/verdict?model=X&host=Y # veredicto APTO/RECHAZADO
GET  /api/tuning?model=X&host=Y  # parámetros óptimos
```

### 3.5 Quantización — ROTORQUANT / TurboQuant

**Ubicación**: `~/Code/ROTORQUANT` (existente)  
**Variantes**: Rotor, Planar, Iso, Turbo, Literati

**Responsabilidades**:

1. **Cuantización custom** — PlanarQuant/IsoQuant para GGUF
2. **KV cache quantization** — reducir uso de memoria en contextos largos
3. **Integración**: FRONTIER BENCH mide modelos cuantizados con ROTORQUANT → solo los que pasan van a Jart-URA

### 3.6 Investigación INFERENCE

**Ubicación**: `~/Code/-Code/INFERENCE-investigation` (existente)

**Responsabilidades**:

1. **Speculative decoding** — draft models para acelerar generación
2. **1M context** — vLLM con contextos enormes (documentos)
3. **Lab de pruebas** — experimentos previos a FRONTIER BENCH

### 3.7 Capa de Voz

**Componentes**:

| Componente | Ubicación | Puertos | Tecnología |
|-----------|-----------|---------|------------|
| LiveKit Server | VPS Contabo | `:7881/tcp`, `:50000-60000/udp` | WebRTC SFU |
| LiveKit Agents | VPS Contabo | (dentro de LiveKit) | Silero VAD + turn-taking |
| STT | Mac Mini M1 | local | whisper.cpp |
| TTS | Mac Mini M1 | local | Kokoro-82M ONNX |

**Flujo de voz**:

```
Navegador/Electron → WebRTC/Opus → LiveKit (VPS) → Agent
  → whisper.cpp STT → texto
  → LiteLLM/Jart-URA → respuesta
  → Kokoro-82M TTS → audio
  → WebRTC/Opus → usuario
```

---

## 4. Flujo de datos — interacción típica del usuario

### 4.1 Chat simple (texto)

```
1. Usuario escribe "Explícame la arquitectura de microservicios"
2. Renderer envía IPC → Main Process (Agent Orchestrator)
3. Orchestrator carga contexto de sesión (SQLite) + workspace actual
4. Orchestrator consulta Permission System → "chat" está en modo act (no pregunta)
5. Orchestrator construye messages[] con system prompt + historial + usuario
6. Unified LLM Client envía a Jart-URA (:9100)
7. Jart-URA decide: modelo "primary" (:9001, local Qwen 7B) tiene capacidad suficiente
8. llama-server procesa en Mac Mini M1, stream de tokens vuelve
9. Renderer muestra tokens en tiempo real via IPC
10. Session Manager guarda en SQLite al finalizar
```

### 4.2 Tool call (ejecución de skill)

```
1. Usuario: "Genera un informe PDF con los datos del sprint"
2. Orchestrator detecta que necesita tool → MCP Client lista tools disponibles
3. Orchestrator envía messages + tools a Jart-URA
4. LLM responde con tool_call: { name: "generate_pdf", args: {...} }
5. Permission System: "generate_pdf" requiere permiso → pregunta al usuario
6. Usuario aprueba → Skill Executor ejecuta la skill
7. Resultado del tool se inyecta como tool_result en la conversación
8. LLM genera respuesta final confirmando la generación
9. PDF se guarda en el workspace actual
```

### 4.3 Tarea programada (cron)

```
1. Scheduled Tasks detecta que "resumen_diario" vence a las 18:00
2. Orchestrator crea conversación automática con el contexto del workspace
3. Unified LLM Client envía a Jart-URA → modelo "small" (:9002) para resumen barato
4. Resultado se guarda en el workspace y se notifica al usuario
5. Si hay integración Telegram configurada → envía resumen vía bot
```

### 4.4 Computer Use (GUI automation)

```
1. Usuario: "Abre Chrome, navega a Jira, y crea un ticket con el resumen"
2. Orchestrator detecta que necesita computer_use
3. Unified LLM Client envía a modelo con vision (Gemini 2.5 Flash vía OpenRouter)
4. Gemini responde con screenshot analysis + acciones建议
5. Permission System: "screen_click" requiere modo ask → usuario aprueba cada paso
6. Sandbox Manager ejecuta acciones en Lima VM (macOS) o Docker (Linux)
7. Loop: screenshot → LLM analiza → acción → screenshot → ... hasta completar
```

### 4.5 Interacción cross-nodo (Tailscale)

```
1. Usuario en MacBook Pro pide "analiza este dataset con el modelo más potente"
2. Jart-URA en MacBook consulta mesh registry → Mac Mini tiene "primary" (Qwen 7B)
3. Pero la tarea necesita razonamiento fuerte → mesh registry ve API proxy "claude-sonnet-4"
4. Jart-URA en MacBook decide: cloud (Claude) vía proxy a :9011
5. Si Tailscale cae → fallback automático a modelo local en el MacBook
```

---

## 5. Mapa de proyectos existentes → arquitectura unificada

| Proyecto | Rol en JartOS Desktop | Se reutiliza | Se modifica | Se integra vía |
|----------|----------------------|-------------|-------------|----------------|
| **Jart-URA** | Backbone de routing, endpoint único para Electron | ✅ 95% (server.js, process-manager, mesh-registry, api-proxy) | Añadir Anthropic spec endpoint, gateway mode, route endpoint | HTTP :9100 desde Electron Main Process |
| **LLM_ROUTER** | Gateway cloud, políticas de gasto, fallbacks | ✅ 100% (docker-compose, config.yaml, monitor_api, webui) | Config.yaml se amplía con nuevos modelos | HTTP :10280 desde Jart-URA (como provider) |
| **LLM-BENCHMARKS** | Certificación de modelos, tuning por hardware | ✅ 100% (frontier_bench engine, batteries, verdict_rules, fleet DB) | API endpoints para consulta externa | HTTP :4400 / SQLite DB directa |
| **ROTORQUANT** | Cuantización custom para modelos locales | ✅ 100% (llama-cpp-turboquant, PlanarQuant, IsoQuant) | Sin cambios — se usa como build tool | Binarios de engine en Jart-URA |
| **INFERENCE-investigation** | Lab de investigación, speculative decoding | ✅ 80% (resultados, configuraciones) | Codificar hallazgos en tuning_rules.yaml | Referencia → FRONTIER BENCH |
| **MANU-DOCKER docs** | Documentación de arquitectura referencial | ✅ 100% (docs, specs) | Sin cambios — referencia viva | Lectura directa |
| **Jart-OS (variantes)** | Organización de infraestructura existente | ⚠️ 60% (docker-compose, configs) | Consolidar en JartOS Desktop como configuración | Archivos de config importados |

---

## 6. Qué es nuevo vs qué se reutiliza

### NUEVO (construir desde cero)

| Componente | Esfuerzo estimado | Dependencias |
|-----------|------------------|--------------|
| **Electron shell** (ventana, menú, tray, auto-updater) | 3-5 días | electron, electron-builder |
| **Chat UI** (React, streaming, markdown, code blocks) | 5-7 días | react, react-markdown, highlight.js |
| **Agent Orchestrator** (tool loop, context window mgmt) | 7-10 días | Custom, depende de Unified LLM Client |
| **Unified LLM Client** (OpenAI + Anthropic specs) | 3-5 días | got/undici, streaming parser |
| **Permission System** (ask/act modes, UI prompts) | 3-4 días | IPC bridge |
| **Session Manager** (SQLite, CRUD sesiones) | 2-3 días | better-sqlite3 |
| **Workspace Manager** (proyectos aislados) | 2-3 días | better-sqlite3 |
| **Skill System** (registry, executor, sandbox) | 5-7 días | child_process, Lima/Docker |
| **Scheduled Tasks** (cron engine, UI) | 2-3 días | cron-parser, node-cron |
| **MCP Client integration** | 3-5 días | @modelcontextprotocol/sdk |
| **Computer Use module** | 5-7 días | Gemini vision API, screenshot tools |
| **Model Selector UI** | 2-3 días | Fetch Jart-URA :9100 + LiteLLM :10280 |
| **Settings UI** | 2-3 días | React forms |

**Total nuevo: ~44-65 días de desarrollo**

### SE REUTILIZA (adaptar)

| Componente | Estado actual | Acción necesaria |
|-----------|--------------|-----------------|
| Jart-URA server.js | Funcional | Añadir 2-3 endpoints, Anthropic spec adapter |
| Jart-URA process-manager | Funcional | Sin cambios |
| Jart-URA mesh-registry | Funcional | Sin cambios |
| Jart-URA api-proxy | Funcional | Sin cambios |
| LLM_ROUTER completo | Funcional en Docker | Config.yaml actualizado con modelos nuevos |
| FRONTIER BENCH completo | Funcional (83 tests green) | API endpoints para consulta externa |
| ROTORQUANT binaries | Funcionales | Copiar engines a Jart-URA/engines/ |
| Monitor API (:10284) | Funcional | Sin cambios |
| WebUI (:10283) | Funcional | Sin cambios |

### SE DESCARTA

| Componente | Razón |
|-----------|-------|
| Claude Agent SDK | Requisito explícito: NO usar |
| OpenCode | Requisito explícito: NO usar |
| Jart-OS docker-compose completo | Electron reemplaza la capa Docker para el cliente |

---

## 7. Stack tecnológico por capa

### Capa 1: Cliente Desktop

| Tecnología | Versión | Justificación |
|-----------|---------|---------------|
| **Electron** | 35.x | Nativo macOS/Linux, Chromium, Node.js integrado |
| **React** | 19.x | UI declarativa, streaming-friendly |
| **TypeScript** | 5.x | Type safety en todo el proyecto |
| **TailwindCSS** | 4.x | Estilos rápidos, dark mode nativo |
| **better-sqlite3** | 11.x | SQLite nativo, sin servidor, WAL mode |
| **@modelcontextprotocol/sdk** | latest | Cliente MCP oficial |
| **electron-builder** | latest | Empaquetado y auto-update |

### Capa 2: Routing (Jart-URA)

| Tecnología | Versión | Justificación |
|-----------|---------|---------------|
| **Node.js** | 20+ | Runtime existente, sin dependencias nuevas |
| **llama-server** (binarios) | b9605+ | Backend local, Apple Silicon optimized |
| **Engines ROTORQUANT** | latest | Planar3, Metal, CoreML engines |

### Capa 3: Gateway Cloud (LLM_ROUTER)

| Tecnología | Versión | Justificación |
|-----------|---------|---------------|
| **LiteLLM** | main-stable | Gateway cloud, 100+ providers |
| **PostgreSQL** | 16 | Logs de spend, virtual keys |
| **vLLM** | latest | Backend local alternativo (GPU disponible) |
| **Docker Compose** | v2 | Orquestación del stack VPS |
| **Monitor API** | Python custom | Stats de gasto |

### Capa 4: Servicios (VPS Contabo)

| Tecnología | Versión | Justificación |
|-----------|---------|---------------|
| **TEI** | ≥1.8.2 | Embeddings + reranking (EmbeddingGemma-300m, bge-reranker) |
| **Qdrant** | latest | Vector store para RAG |
| **LiveKit** | latest | WebRTC voice, self-hosted |
| **FRONTIER BENCH** | v2 | Benchmark engine, SQLite WAL |

### Capa 5: Infraestructura

| Tecnología | Justificación |
|-----------|---------------|
| **Tailscale** | Mesh networking, zero-config VPN, descubrimiento de nodos |
| **Lima** (macOS) | Sandbox aislado para ejecución de código en macOS |
| **Docker** (Linux) | Sandbox aislado en VPS |
| **LaunchAgents/daemons** | Auto-start de Jart-URA en cada nodo |

---

## 8. Modelo de seguridad

### 8.1 Permisos (Permission System)

```
┌─────────────────────────────────────────────────┐
│              MODELOS DE PERMISO                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  ACT mode (automático):                          │
│    ✅ Chat / preguntas                           │
│    ✅ Lectura de archivos en workspace           │
│    ✅ Búsqueda web                               │
│    ✅ Consulta de memoria                        │
│                                                  │
│  ASK mode (requiere confirmación):               │
│    ⚠️  Escritura de archivos fuera del workspace │
│    ⚠️  Ejecución de código                       │
│    ⚠️  Envío de mensajes (Telegram/email)        │
│    ⚠️  Modificación de configuración             │
│                                                  │
│  DENY mode (bloqueado):                          │
│    ❌ Acceso a credenciales                      │
│    ❌ Eliminación de datos sin backup            │
│    ❌ Acceso a archivos del sistema               │
│                                                  │
│  Por skill:                                      │
│    Cada skill declara su nivel de permiso         │
│    Ejemplo: pdf_generate → ACT                   │
│             shell_exec → ASK                     │
│             file_delete → DENY                   │
└─────────────────────────────────────────────────┘
```

### 8.2 Aislamiento (Sandbox)

| Entorno | Tecnología | Aislamiento |
|---------|-----------|-------------|
| **macOS** | Lima VM | VM ligera con filesystem montado solo para workspace |
| **Linux** | Docker | Contenedor con networking limitado |
| **Ejecución remota** | SSH + Tailscale | Comandos en nodos remotos vía mesh |

### 8.3 Datos y Credenciales

| Dato | Almacenamiento | Cifrado |
|------|---------------|---------|
| API keys | Keychain (macOS) / env vars (Linux) | OS-level encryption |
| Sesiones | SQLite WAL en ~/Library/Application Support/JartOS/ | SQLite encryption (SQLCipher) |
| Memoria | SQLite en mismo directorio | SQLCipher |
| Config | JSON en ~/Library/Application Support/JartOS/ | Plaintext (no sensible) |
| Modelos GGUF | ~/Code/Jart-URA/models/ | Sin cifrar (son públicos) |

### 8.4 Red

```
┌─────────────────────────────────────────────────┐
│              SEGURIDAD DE RED                    │
├─────────────────────────────────────────────────┤
│                                                  │
│  Tailscale:                                      │
│    ✅ WireGuard under the hood                   │
│    ✅ Autenticación por dispositivo              │
│    ✅ Traffic cifrado punto a punto              │
│    ✅ Sin puertos expuestos en firewall          │
│                                                  │
│  VPS Contabo:                                    │
│    ⚠️  LiteLLM (:10280) con auth (master key)   │
│    ⚠️  PostgreSQL (:10281) solo Tailscale        │
│    ✅ WebUI (:10283) con usuario/password        │
│    ✅ LiveKit con tokens de sala                 │
│                                                  │
│  APIs Cloud:                                     │
│    ✅ HTTPS siempre                              │
│    ✅ API keys en env vars, nunca en código      │
│    ✅ Rate limiting en LiteLLM                   │
│    ✅ Budget alerts en Monitor API               │
└─────────────────────────────────────────────────┘
```

---

## 9. Estrategia de despliegue

### 9.1 Desarrollo local (macOS)

```
~/Code/JartOS-Desktop/
├── electron/              # Shell Electron
│   ├── main.ts           # Main process
│   ├── preload.ts        # Context bridge
│   └── renderer/         # React app
├── core/                  # Core logic (TypeScript)
│   ├── orchestrator/     # Agent loop
│   ├── llm-client/       # Unified LLM client
│   ├── permissions/      # Permission system
│   ├── sessions/         # Session manager
│   ├── workspaces/       # Workspace manager
│   ├── skills/           # Skill system
│   ├── mcp/              # MCP client
│   ├── memory/           # Memory system
│   ├── scheduler/        # Scheduled tasks
│   └── computer-use/     # GUI automation
├── skills/                # Skills instaladas
│   ├── docx-gen/         # Generación DOCX
│   ├── pdf-gen/          # Generación PDF
│   ├── pptx-gen/         # Generación PPTX
│   ├── xlsx-gen/         # Generación XLSX
│   ├── code-exec/        # Ejecución de código
│   └── web-search/       # Búsqueda web
├── config/                # Configuración por defecto
│   ├── models.json       # Copia de Jart-URA config
│   ├── skills.json       # Registry de skills
│   └── workspaces.json   # Workspaces del usuario
├── package.json
├── tsconfig.json
├── electron-builder.yml
└── README.md
```

### 9.2 Despliegue por nodo

| Nodo | Qué se ejecuta | Auto-start |
|------|---------------|------------|
| **MacBook Pro M1 Max** | JartOS Desktop (Electron) + Jart-URA | LaunchAgent |
| **Mac Mini M1** | Jart-URA + whisper.cpp (STT) + Kokoro (TTS) | LaunchAgents |
| **VPS Contabo** | Docker stack (LiteLLM + Postgres + TEI + Qdrant + LiveKit + FRONTIER BENCH) | systemd / docker-compose up -d |
| **Pixel 10** | Companion app (Tailscale) — voz, cámara, notificaciones | App nativa |

### 9.3 Orden de despliegue

```
Fase 1 (semana 1-2): Core funcional
  → Electron shell + Chat UI + Jart-URA connection + streaming
  → RESULTADO: puedes chatear con modelos locales

Fase 2 (semana 3-4): Cloud + Skills
  → LLM_ROUTER connection + primeras skills (DOCX, PDF)
  → RESULTADO: chateas con cloud + generas documentos

Fase 3 (semana 5-6): Agente completo
  → Tool loop + MCP + permisos + sesiones + workspaces
  → RESULTADO: agente que ejecuta tools de verdad

Fase 4 (semana 7-8): Avanzado
  → Scheduled tasks + Computer use + Voz
  → RESULTADO: app completa tipo Claude Cowork
```

---

## 10. Ruta de migración desde Claude Cowork

### 10.1 What to keep from Claude Cowork

| Feature | En JartOS Desktop | Prioridad |
|---------|------------------|-----------|
| Chat con streaming | Chat UI (nativo) | P0 |
| Tool use (function calling) | Agent Orchestrator | P0 |
| File editing | Skill: file-edit | P0 |
| Code execution | Skill: code-exec + sandbox | P0 |
| MCP servers | MCP Client (nativo) | P0 |
| Memory/context | Session Manager + Memory System | P1 |
| Multi-file editing | Skill: multi-edit | P1 |
| Browser automation | Computer Use module | P2 |
| Voice | LiveKit + STT/TTS | P2 |

### 10.2 Migration checklist

```
□ Exportar conversaciones de Claude Cowork (si es posible)
□ Identificar MCP servers que usas y listarlos
□ Listar skills/workflows que usas frecuentemente
□ Configurar Jart-URA con los mismos modelos que usas en Claude
□ Configurar LLM_ROUTER con las mismas API keys
□ Probar que el chat funciona con los mismos modelos
□ Migrar MCP servers uno a uno
□ Recrear workflows como scheduled tasks
□ Configurar permisos según tus hábitos
```

---

## 11. Evaluación honesta de complejidad y timeline

### 11.1 Complejidad por módulo

| Módulo | Complejidad | Riesgo | Días estimados |
|--------|-----------|--------|---------------|
| Electron shell | ⬛⬛⬜⬜⬜ Baja | Bajo | 3-5 |
| Chat UI (streaming) | ⬛⬛⬛⬜⬜ Media | Bajo | 5-7 |
| Unified LLM Client | ⬛⬛⬛⬜⬜ Media | Medio (spec compliance) | 3-5 |
| Agent Orchestrator | ⬛⬛⬛⬛⬜ Alta | Alto (tool loop correctness) | 7-10 |
| Permission System | ⬛⬛⬜⬜⬜ Baja | Bajo | 3-4 |
| Session Manager | ⬛⬛⬜⬜⬜ Baja | Bajo | 2-3 |
| Workspace Manager | ⬛⬛⬜⬜⬜ Baja | Bajo | 2-3 |
| Skill System | ⬛⬛⬛⬛⬜ Alta | Medio (sandboxing) | 5-7 |
| MCP Client | ⬛⬛⬛⬜⬜ Media | Medio (SDK maturity) | 3-5 |
| Memory System | ⬛⬛⬛⬜⬜ Media | Medio (embeddings quality) | 3-5 |
| Scheduled Tasks | ⬛⬛⬜⬜⬜ Baja | Bajo | 2-3 |
| Computer Use | ⬛⬛⬛⬛⬛ Muy Alta | Alto (vision reliability) | 5-7 |
| Voice (LiveKit) | ⬛⬛⬛⬛⬜ Alta | Alto (WebRTC complexity) | 5-7 |
| Jart-URA extensions | ⬛⬛⬜⬜⬜ Baja | Bajo (extending existing) | 2-3 |

**Total estimado: 50-75 días** (un developer full-time)

### 11.2 Riesgos principales

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Agent Orchestrator tiene bugs en tool loop | Alta | Alto | TDD estricto, empezar con tools simples |
| MCP SDK inmaduro para Electron | Media | Alto | Fallback a stdio directo sin SDK |
| Computer Use no es fiable con Gemini | Alta | Medio | Feature opt-in, no crítica para MVP |
| Jart-URA necesita cambios que rompen existentes | Baja | Alto | Branch feature, tests antes de merge |
| Tailscale cae y se pierde connectivity | Baja | Medio | Fallback a modelos locales siempre disponible |
| Lime/Docker sandbox complicado en macOS | Media | Medio | Empezar sin sandbox, añadir después |

### 11.3 Recomendación de sequencing

**MVP (4 semanas)**: Electron + Chat + Jart-URA + streaming + 1 skill (code-exec)  
**v1.0 (8 semanas)**: + Cloud (LiteLLM) + MCP + Skills + Sessions + Permissions  
**v1.5 (12 semanas)**: + Workspaces + Scheduler + Memory + Computer Use  
**v2.0 (16 semanas)**: + Voice + Advanced features + Polishing

### 11.4 Lo que NO hacer ahora

1. **No migrar LLM_ROUTER a Jart-URA** — son capas complementarias, no competidoras
2. **No construir un nuevo benchmark engine** — FRONTIER BENCH ya funciona
3. **No reescribir ROTORQUANT** — los binarios existentes funcionan
4. **No implementar Computer Use en MVP** — es la feature más compleja y menos crítica
5. **No construir Voice en MVP** — LiveKit ya existe, integrar después

---

## A. Puertos — Mapa completo

| Puerto | Servicio | Nodo | Protocolo |
|--------|---------|------|-----------|
| 9001 | Jart-URA: primary (Qwen 7B) | Mac Mini | HTTP (OpenAI spec) |
| 9002 | Jart-URA: small (Qwen 2B) | Mac Mini | HTTP |
| 9003 | Jart-URA: embed (bge-m3) | Mac Mini | HTTP |
| 9004 | Jart-URA: coder (Qwen Coder 3B) | Mac Mini | HTTP |
| 9005 | Jart-URA: fast (Qwen 1.7B) | Mac Mini | HTTP |
| 9006 | Jart-URA: multi (Gemma 3n) | Mac Mini | HTTP |
| 9010 | Jart-URA: gpt-4o proxy | Mac Mini | HTTP |
| 9011 | Jart-URA: claude-sonnet-4 proxy | Mac Mini | HTTP |
| 9012 | Jart-URA: gemini-2.5-flash proxy | Mac Mini | HTTP |
| 9100 | Jart-URA: management API | Todos | HTTP |
| 10280 | LiteLLM gateway | VPS | HTTP |
| 10281 | PostgreSQL | VPS | TCP |
| 10282 | vLLM (GPU, optional) | VPS | HTTP |
| 10283 | WebUI (model picker) | VPS | HTTP |
| 10284 | Monitor API (spend) | VPS | HTTP |
| 4400 | FRONTIER BENCH UI | VPS | HTTP |
| 7881 | LiveKit server | VPS | HTTP + WebSocket |
| 50000-60000 | LiveKit WebRTC | VPS | UDP |

## B. Configuración de Jart-URA para Electron

```json
{
  "port_range": [9000, 9999],
  "mesh_poll_ms": 15000,
  "peers": ["mac-mini-tailscale"],
  "electron_mode": true,
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
      "type": "chat",
      "role": ["general", "reasoning", "chat"],
      "certification": "APTO",
      "benchmark_source": "FRONTIER-BENCH:m1-max-32gb"
    },
    {
      "name": "zai-deepseek",
      "port": 9020,
      "source": "api",
      "provider": "litellm",
      "api_model": "zai-deepseek",
      "api_key_env": "LITELLM_MASTER_KEY",
      "base_url": "http://contabo-vps:10280",
      "type": "chat",
      "supports_vision": true,
      "supports_function_calling": true,
      "max_tokens": 131072,
      "cost_layer": "flat",
      "role": ["agent", "coding", "tool-use"]
    }
  ],
  "engines": {
    "metal": {
      "bin": "engines/metal/llama-metal",
      "default_args": ["--no-mmap", "--mlock"]
    },
    "planar3": {
      "bin": "engines/planar3/llama-planar3",
      "default_args": ["-ctk", "q4_0", "-ctv", "q4_0"]
    }
  },
  "server": {
    "host": "0.0.0.0",
    "port": 9100,
    "log_dir": "logs/",
    "pid_dir": "pids/"
  }
}
```

## C. Skills base (MVP)

| Skill | Archivo | Descripción | Permiso |
|-------|---------|-------------|---------|
| `code-exec` | `skills/code-exec/` | Ejecutar Python/Node/bash en sandbox | ASK |
| `docx-gen` | `skills/docx-gen/` | Generar documentos Word | ACT |
| `pdf-gen` | `skills/pdf-gen/` | Generar PDFs | ACT |
| `pptx-gen` | `skills/pptx-gen/` | Generar presentaciones PowerPoint | ACT |
| `xlsx-gen` | `skills/xlsx-gen/` | Generar hojas de cálculo Excel | ACT |
| `file-read` | `skills/file-read/` | Leer archivos del workspace | ACT |
| `file-write` | `skills/file-write/` | Escribir archivos | ACT |
| `web-search` | `skills/web-search/` | Búsqueda web via Tavily/SearXNG | ACT |
| `mcp-tool` | `skills/mcp-tool/` | Ejecutar tool de cualquier MCP server | ASK |

---

> **Siguiente paso recomendado**: Crear el repo `JartOS-Desktop` con el Electron shell + Chat UI conectado a Jart-URA, y tener streaming funcionando en <1 semana como proof of concept.
