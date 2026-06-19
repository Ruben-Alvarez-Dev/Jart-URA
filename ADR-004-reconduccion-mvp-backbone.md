# ADR-004 — Reconducción a monorepo de dos planos + MVP del backbone enrichment-routing

> **Status:** Proposed
> **Date:** 2026-06-19
> **Deciders:** Rubén Alvarez
> **Relación:** complementa y aclara **ADR-003** (Control/Data plane). No deroga **ADR-002** (diseño hexagonal del enrichment).

---

## Context

El repo `Jart-URA` contiene **hoy tres scopes que compiten** y producen la sensación de incoherencia. Verificado contra el código, no contra los docs:

1. **Control Plane (Jart-URA, Node.js) — REAL y sólido.**
   `server.js` tiene tabla de rutas explícita y funcional: `/v1/registry`, `/v1/models`, `/v1/models/:name/{load,unload,restart,logs}`, `/v1/engines` CRUD, `/v1/disk/*`, `/health`, `/v1/health/full`. Cero dependencias salvo `yaml`. Suite Vitest verde.

2. **Data Plane (router-jart, Python/FastAPI `:10200`) — REAL y bien hecho.**
   Hexagonal de libro: `core/ports.py` + `core/service.py` (dominio que *nunca* lanza excepción), adaptadores de memoria/inyección/extracción, `factory.py`, y `EnrichmentMiddleware` con degradación "el enrichment nunca bloquea". Tests presentes. **PERO vive físicamente dentro de este repo**, mientras ADR-003 (ACCEPTED) dice que el Data Plane debe ser un repo *separado*. Contradicción entre decisión aceptada y realidad.

3. **Dos visiones de futuro que NO son el build actual y chocan entre sí.**
   `ARCHITECTURE.md` (JartOS Desktop — Electron, 50-75 días) y `jart-gateway-plan.md` (Jart-Gateway — vLLM + LiteLLM + 4 agentes director/executor/guardian/council). Colisión concreta: el puerto **`:10200` está doblemente asignado** — enrichment (ADR-003/router-jart) vs "Jart-Router clasificador" (gateway-plan). Eso solo ya envenena el modelo mental.

**Fuerzas en juego:**
- Necesitamos **MVP ya**. Cero margen para reescrituras, ni para JartOS Desktop, ni para el stack vLLM/LiteLLM.
- El código ya está mayoritariamente bien. El problema es de **fronteras y alcance**, no de implementación.
- Falta **una sola costura real**: `router-jart` enriquece `POST /v1/chat/completions` pero **no reenvía a ningún backend de modelo**. La middleware enriquece y delega en su propia app FastAPI, que no tiene ruta de forwarding al Control Plane. Es una middleware sin backend.

---

## Decision

**1. Estilo arquitectónico — no se elige "una arquitectura nueva"; se formaliza la combinación que ya existe y es la correcta.**
- **Control Plane (Node):** servicio modular ligero. **No se hexagonaliza** — sería sobreingeniería; su trabajo es I/O + gestión de procesos.
- **Data Plane (Python):** **hexagonal puertos & adaptadores** (ya implementado). Se mantiene y se termina.
- "Hexagonal, o la que sea, o una combinación" → es una **combinación deliberada**: hexagonal donde aporta (dominio de enrichment), modular donde no (router de procesos).

**2. Topología de repo — monorepo con frontera lógica dura AHORA; split físico DESPUÉS.**
- Comunicación **solo por HTTP, sin imports cruzados** entre planos.
- Esto **aclara ADR-003**: la frontera que importa para el MVP es la *lógica* (ya respetada). El split en dos git repos es una optimización posterior, reversible, y **no debe bloquear el MVP**.

**3. Cuarentena de visiones.**
- Mover `ARCHITECTURE.md` y `jart-gateway-plan.md` a `docs/vision/` con cabecera **"FUTURO — no es el build actual"**.
- El MVP **excluye explícitamente**: Electron/JartOS Desktop, vLLM, LiteLLM, NATS, Qdrant, modelo de 4 agentes, computer use, voz.

**4. Resolver la colisión `:10200`.**
- `:10200` = **Data Plane (enrichment + passthrough)**, per ADR-003. El "Jart-Router clasificador" del gateway-plan queda aparcado en `docs/vision/`.

---

## Options Considered

### Option A: Split físico en dos repos ahora (ADR-003 literal)
| Dimensión | Evaluación |
|-----------|------------|
| Complejidad | Media-Alta |
| Coste (durante MVP) | Alto (fricción) |
| Escalabilidad | Alta |
| Familiaridad | Alta |

**Pros:** fiel a ADR-003; aislamiento total.
**Cons:** fricción de tooling (2 repos, 2 CI, clones/submódulos) justo cuando se busca velocidad; iterar el seam cross-repo es más lento.

### Option B: Monorepo con frontera lógica dura ahora, split después *(ELEGIDA)*
| Dimensión | Evaluación |
|-----------|------------|
| Complejidad | Baja |
| Coste | Bajo |
| Escalabilidad | Alta (split trivial luego) |
| Familiaridad | Alta |

**Pros:** máxima velocidad a MVP; un solo checkout; el seam se itera en un repo; **reversible** (mover una carpeta a su repo es barato porque no hay imports cruzados).
**Cons:** exige disciplina para no acoplar; el "separate repo" de ADR-003 queda como objetivo diferido (se documenta).

### Option C: Colapsar todo en un servicio (Node hace también enrichment)
| Dimensión | Evaluación |
|-----------|------------|
| Complejidad | Alta |
| Coste | Alto |
| Escalabilidad | Baja |

**Pros:** un solo proceso.
**Cons:** tira el hexagonal Python ya hecho y testeado; mezcla I/O-bound con ML/async; contradice ADR-002 y ADR-003. **Descartada.**

---

## Trade-off Analysis

El eje real **no es "qué arquitectura"** sino **"frontera lógica vs frontera física"**. La B entrega la coherencia que pides (frontera lógica limpia, visiones fuera del camino, un único seam que cerrar) sin pagar el coste de fricción de la A. **A es el destino; B es cómo llegar al MVP sin frenarse.** La C destruiría trabajo válido y bien hecho.

---

## Consequences

**Más fácil:**
- Razonar el sistema: dos planos, un seam, cero visiones compitiendo.
- Cerrar el MVP: solo falta la ruta de passthrough en `router-jart`.
- Operar: el dashboard de salud ya existe.

**Más difícil / a vigilar:**
- Disciplina de frontera en monorepo (regla de estructura/lint que impida imports cruzados).
- Deuda diferida explícita: split físico de repos cuando el Data Plane crezca.

**A revisitar:**
- Cuando el Data Plane necesite desplegarse/escalar aparte → ejecutar el split físico (barato por diseño).
- `gateway-plan` (vLLM/LiteLLM/agentes) se retoma como ADR propio **si y cuando** se priorice.

---

## MVP — definición y alcance

**MVP = "Backbone enrichment-routing, happy path, extremo a extremo".**

```
cliente → :10200  POST /v1/chat/completions   (Data Plane)
   → EnrichmentMiddleware: enriquece con memoria si :8890 está vivo;
     si no, passthrough limpio (degradación YA implementada)
   → [NUEVO] passthrough: elige modelo desde Control Plane :9100 GET /v1/registry
     y reenvía el chat al puerto del modelo (llama-server local o api-proxy), con streaming
   → respuesta vuelve al cliente
```

Usa **solo lo que existe + una costura nueva**. Memoria por defecto en adaptador **`null`** (seguro) para que el MVP funcione aunque `:8890` (MCP-agent-memory) esté caído.

**Definition of done:**
- 1 `curl` a `:10200 /v1/chat/completions` devuelve completion en streaming de un modelo local del Control Plane.
- Con `:8890` vivo → aparece bloque `[JART-MEMORY]`; con `:8890` caído → responde igual (sin bloque).
- Suites verdes: Vitest (Control) + pytest (Data).
- Dashboard muestra el/los modelos en verde.

**Fuera de alcance MVP (explícito):** Electron, vLLM, LiteLLM, NATS, Qdrant, 4-agentes, computer use, voz, split físico de repos.

---

## Action Items

**Reconducción (orden):**
1. [ ] Crear `docs/vision/` y mover ahí `ARCHITECTURE.md` y `jart-gateway-plan.md` con cabecera "FUTURO — no es el build actual".
2. [ ] (Opcional, bajo riesgo si se difiere) Reorganizar a `control-plane/` (server.js, src/, tests/, config/, engines/, models/, mcp-server/, dashboard/) y `data-plane/` (router-jart/). Solo mover, sin tocar lógica. Alternativa mínima hoy: documentar la frontera y mover en un segundo paso.
3. [ ] Fijar el contrato del seam en un `data-plane/README`: consume `GET :9100/v1/registry`; reenvía a `model.port`.

**MVP (el corte que se mueve ya):**
4. [ ] `router-jart`: añadir ruta passthrough `POST /v1/chat/completions` que (a) resuelve el modelo desde el registry del Control Plane, (b) reenvía con streaming al puerto del modelo, (c) preserva el body ya enriquecido por la middleware.
5. [ ] Selección de modelo mínima: campo `model` del body → match con registry; fallback al primer modelo `type: chat` sano.
6. [ ] Config por defecto: ENRICHMENT con adaptador `null` salvo que `ENRICHMENT_MEMORY_URL` esté seteado y sano.
7. [ ] Test e2e: curl happy path + test de degradación (matar `:8890`).
8. [ ] Verificación: Vitest + pytest verdes; smoke del dashboard.

**Diferido (no ahora):** split físico de repos; Jart-Gateway (vLLM/LiteLLM/agentes); JartOS Desktop.

---

## References
- `ADR-002-memory-enrichment-architecture.md` — diseño hexagonal del enrichment
- `ADR-003-control-plane-data-plane.md` — separación de planos
- `README.md` — Control Plane (Node); `router-jart/app.py` + `src/enrichment/*` — Data Plane (Python)
- `docs/vision/ARCHITECTURE.md`, `docs/vision/jart-gateway-plan.md` (tras el move)
