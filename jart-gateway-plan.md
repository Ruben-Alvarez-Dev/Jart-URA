# Jart-Gateway — Plan de herramienta conjunta vLLM + LiteLLM

> Análisis y planificación para Jart-URA · Junio 2026

---

## 1. Análisis: vLLM

### Qué es
Motor de inferencia local de alta performance, diseñado para servir LLMs con máxima eficiencia en hardware propio.

### Lo que aporta a Jart

**PagedAttention** — el corazón de vLLM. Gestiona el KV cache como páginas de memoria virtual, eliminando fragmentación. El resultado: hasta 24x más throughput que llama.cpp/llama-server en cargas con múltiples peticiones concurrentes. Para Jart, que tiene 4 agentes activos en paralelo (director, executor, guardian, council), esto es crítico.

**Continuous batching** — no espera a que un batch termine para agregar peticiones nuevas. Las requests entran en el motor mientras otras siguen procesándose. Fundamental para un sistema multi-agente donde las requests llegan en ráfagas.

**Cuantización de primera clase** — AWQ, GPTQ, FP8, INT4, INT8 con perfiles de accuracy/VRAM bien documentados. Actualmente Jart usa llama-server con cuantización básica; vLLM permitiría correr Qwen 32B en hardware que hoy solo aguanta Qwen 7B.

**Prefix caching** — cachea automáticamente el prefijo del prompt (system prompt, contexto repetido). En Jart, el system prompt de cada agente es prácticamente fijo → primer token gratis para la mayoría de peticiones.

**Speculative decoding** — usa un modelo pequeño (draft) para predecir tokens que el modelo grande verifica en paralelo. Para los agentes de Jart que usan modelos grandes con outputs repetitivos, puede 2-3x la velocidad de generación.

**API OpenAI-compatible** — expone `/v1/chat/completions`, `/v1/completions`, `/v1/models`. Drop-in replacement para cualquier cliente.

### Limitaciones para Jart
- No es un gateway: sirve **un modelo a la vez** por instancia
- No tiene routing nativo entre proveedores cloud
- No tiene gestión de API keys, budgets ni tracking de costos
- Sin UI de administración
- Sin soporte nativo para MCP/A2A

---

## 2. Análisis: LiteLLM

### Qué es
Gateway/proxy unificado que abstrae 100+ proveedores LLM detrás de una API OpenAI-compatible.

### Lo que aporta a Jart

**Routing inteligente** — ya está en Jart-OS (puerto 10201). Lo que aún no se explota al máximo:
- `health_check_routing`: elimina providers caídos del pool antes de que fallen usuarios
- `adaptive_router` (beta): aprende qué modelo/provider responde mejor para cada tipo de tarea
- `tag_routing`: rutas distintas por etiqueta → `director` vs `executor` pueden ir a providers diferentes
- `budget_routing`: si el gasto en cloud supera X, redirige automáticamente a local

**Fallback en cascada** — actualmente Jart tiene Xiaomi → Z.AI. Con LiteLLM se puede añadir vLLM local como tercer nivel (gratis, siempre disponible), o incluso como primera opción para tareas donde privacidad/latencia importa más que capacidad.

**Virtual keys + per-agent budgets** — cada agente (director, executor, guardian, council) puede tener su propio budget diario y rate limit. Previene que un agente descontrolado queme toda la cuota del mes.

**MCP Gateway** — LiteLLM 2025+ puede actuar como gateway MCP central con control de acceso por key. Esto podría unificar el acceso de los agentes a las tools sin que cada uno gestione su propia conexión MCP.

**Observabilidad** — integración con Langfuse, MLflow, Helicone con una línea. Para auditar qué deciden los agentes y cuánto cuesta cada decisión.

**Guardrails** — PII masking, content filtering. Relevante si Jart maneja datos personales del usuario.

### Limitaciones para Jart
- No optimiza la inferencia en sí (eso es trabajo del backend)
- El proxy añade ~10-50ms de latencia por request
- Config YAML puede volverse compleja a escala
- El adaptive router está en beta y puede ser impredecible

---

## 3. Lo que falta en ambos para Jart

Ni vLLM ni LiteLLM solos resuelven los problemas específicos de Jart:

1. **Routing por rol de agente + contexto de memoria** — no saben qué agente hace qué, ni si ese agente tiene contexto en MCP-agent-memory que justifique un modelo local
2. **Presupuesto local vs cloud dinámico** — decidir en runtime si "esta tarea vale gastar tokens cloud o puede hacerse local"
3. **Priorización por urgencia de Jart** — director tiene prioridad sobre executor; las peticiones del usuario tienen prioridad sobre procesos background
4. **Health awareness de la stack local** — saber si Qdrant, llama-server/vLLM están sanos antes de intentar una petición local
5. **Integración con Engram/MCP-agent-memory** — ninguno sabe que existe una capa de memoria persistente que podría determinar si un modelo local tiene suficiente contexto

---

## 4. La herramienta: Jart-Gateway

### Concepto
Un thin proxy que se sienta **entre los agentes y la infraestructura LLM**, usando LiteLLM como motor de routing y vLLM como backend local de alta performance.

No es construir algo desde cero — es una capa de decisión propia sobre herramientas existentes.

```
Agentes Jart (director/executor/guardian/council)
            │
     [Jart-Gateway]  ← capa propia
     /            \
[LiteLLM Proxy]  [vLLM local]
   /      \           │
[Cloud]  [Fallback]  [Qwen local]
```

### Arquitectura en capas

**Capa 1: Jart-Router (nuevo)**
Un servicio ligero (~300 líneas Python/FastAPI) que recibe peticiones de los agentes y decide:
- ¿Tarea local o cloud?
- ¿Qué modelo exacto?
- ¿Con qué prioridad?

Lógica de decisión:
```
si tarea.tipo == "embedding" → vLLM/local siempre
si tarea.privacidad == "alta" → vLLM/local siempre
si tarea.complejidad == "alta" AND cloud.disponible → cloud
si local.carga < 70% AND tarea.complejidad == "media" → local
si cloud.budget_restante < 20% → local si posible, sino error
```

**Capa 2: LiteLLM (existente, reforzado)**
- Añadir vLLM como provider local
- Configurar per-agent virtual keys con budgets
- Activar health-check routing
- Añadir tag routing por agente
- Activar adaptive router para aprender con el tiempo

**Capa 3: vLLM (nuevo)**
- Reemplaza llama-server en :9000
- Modelo principal: Qwen 32B cuantizado (AWQ Q4) para razonamiento local
- Modelo embedding: bge-m3 (ya lo tiene MCP-agent-memory)
- Prefix caching activado (system prompts son fijos)
- Speculative decoding con Qwen 1.7B como draft model

---

## 5. Planificación de implementación

### Fase 0 — Diagnóstico (1-2 días)
- [ ] Benchmark actual llama-server vs vLLM en hardware de Ruben (tokens/sec, latencia p50/p99)
- [ ] Mapear qué modelos se usan en local hoy y sus tamaños
- [ ] Auditar el litellm.yaml actual — qué está bien, qué falta
- [ ] Definir qué hardware tiene disponible para vLLM (GPU, VRAM, RAM)

### Fase 1 — vLLM como backend local (3-5 días)
- [ ] Instalar vLLM con soporte de cuantización
- [ ] Servir Qwen local en vLLM en el mismo puerto :9000 (drop-in replacement)
- [ ] Verificar que MCP-agent-memory sigue funcionando (embedding endpoint compatible)
- [ ] Activar prefix caching + speculative decoding
- [ ] Benchmark de mejora real

### Fase 2 — LiteLLM reforzado (2-3 días)
- [ ] Añadir vLLM como provider en litellm.yaml:
  ```yaml
  - model_name: qwen-local
    litellm_params:
      model: openai/qwen3-32b
      api_base: http://localhost:9000/v1
      api_key: none
  ```
- [ ] Crear virtual keys por agente con budgets
- [ ] Activar health-check routing
- [ ] Configurar fallback cloud → local → error
- [ ] Activar tag routing (etiquetas: `director`, `executor`, `guardian`, `council`, `memory`, `rag`)

### Fase 3 — Jart-Router (5-7 días)
- [ ] Servicio FastAPI en :10200 (frente a LiteLLM en :10201)
- [ ] Clasificador de tarea (local/cloud/hybrid) con reglas simples
- [ ] Integración con health checks de la stack (Qdrant, vLLM, LiteLLM)
- [ ] Priority queue: peticiones usuario > agentes foreground > background
- [ ] Endpoint de métricas propio (Prometheus-compatible)

### Fase 4 — Integración Jart-OS (3-4 días)
- [ ] Actualizar agentes para enviar tags y metadatos de prioridad
- [ ] Conectar Jart-Router con MCP-agent-memory (si hay memoria → preferir local)
- [ ] Dashboard Grafana para visualizar routing decisions en tiempo real
- [ ] Ajuste de heurísticas basado en uso real

---

## 6. Estructura de directorios propuesta

```
Jart-OS/
└── TIERS/
    └── TIER-02-GATEWAY/
        ├── 10200-router-jart/          ← nuevo: Jart-Router
        │   ├── docker-compose.yml
        │   ├── Dockerfile
        │   └── src/
        │       ├── main.py             ← FastAPI
        │       ├── router.py           ← lógica de decisión
        │       ├── health.py           ← health checks
        │       └── metrics.py
        ├── 10201-proxy-litellm/        ← existente, reforzado
        │   └── config/
        │       └── litellm.yaml        ← añadir vLLM, virtual keys, tags
        └── 10202-inference-vllm/       ← nuevo: vLLM local
            ├── docker-compose.yml
            └── config/
                └── vllm.yaml
```

---

## 7. Decisiones pendientes

Antes de arrancar la implementación, hace falta decidir:

1. **¿Qué GPU/hardware tiene disponible Ruben?** — determina qué modelos puede correr vLLM y con qué cuantización
2. **¿Qué modelos locales son prioritarios?** — Qwen 32B, 14B, 7B; ¿solo chat o también coding?
3. **¿El Jart-Router vive dentro de Docker o como proceso launchd?** — consistencia con el resto de Jart-OS
4. **¿Budget total mensual para cloud?** — para calibrar los umbrales de routing
5. **¿Prioridad de privacidad?** — ¿hay tipos de tarea que NUNCA deben ir a cloud?
