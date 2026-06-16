## Status Report: Jart-URA Control Center — Actualización 2026-06-16
**Autor:** Claude (asistente) · **Para:** Rubén · **Fecha:** 2026-06-16 (revisión pm)

### Resumen ejecutivo
Avance fuerte desde la última revisión: el Control Center **ya no es solo diseño**. El dashboard y su **API de gestión en el backend (`server.js`) se han construido a la par y están alineados** — registro en vivo, **CRUD de modelos**, ciclo de vida (load/unload/restart/logs), gestión de **engines** y **escáner de disco** de modelos, todo **live-only** (mock eliminado, ADR-0001). Quedan tres frentes: la **piel cinematográfica** (Fase 1, bloqueada por los assets), la decisión del **router de referencia** (que se reencuadra como plano de control vs plano de datos), y **verificar el sistema corriendo en vivo** (cuando se comprobó, Jart-URA estaba caído). Las métricas por modelo siguen en `—` porque `/v1/health/full` aún no está implementado.

### Estado general: 🟡 En riesgo (con tendencia ▲ a verde)
La ejecución va muy bien; lo que mantiene el ámbar es arquitectura por decidir (router de referencia) y que no está confirmado corriendo en vivo. No es deuda de código, es decisión + despliegue.

### Métricas clave
| Métrica | Objetivo | Real | Tendencia | Estado |
|--------|--------|--------|-------|--------|
| Endpoints de gestión servidos por el backend | 13 | 12 | ▲ | 🟢 |
| Alineación front ↔ back (consume = sirve) | 100% | ~100% | ▲ | 🟢 |
| Dashboard live-only (sin mock) | sí | hecho | ▲ | 🟢 |
| Entregables Fase 0 (spec, E-R, ADR, preguntas) | 4 | 4 | ▲ | 🟢 |
| `/v1/health/full` (métricas tok/s, p50/p95, carga) | sí | no | ▬ | 🔴 |
| Sistema verificado corriendo en vivo | sí | no | ▬ | 🔴 |
| Decisión "router de referencia" | 1 | 0 | ▬ | 🔴 |
| Assets gráficos generados | ~18 | 0 | ▬ | 🔴 |

### Logros de este periodo
- **API de gestión completa en `server.js`**: `/v1/models` (GET/POST), `/v1/registry`, `/v1/engines` (+ `:name` PUT/DELETE), `/v1/disk/paths` (GET/PUT), `/v1/disk/models`, y por modelo `GET`/`DELETE`/`load`/`unload`/`restart`/`logs`. Nuevos módulos backend: `config-store.js`, `model-scanner.js`.
- **Dashboard funcional alineado**: pestañas Flota / Engines / Disco, alta de modelos (`ModelForm`), panel de engines, escáner de disco, control de ciclo de vida desde el drawer, y estado **offline honesto** (sin inventar datos).
- **Fase 0 cerrada y verificada**: spec UX, modelo E-R, ADR-0001 (sin mock), preguntas abiertas + diagrama. Verificación en vivo en el Mac: VPS = **ionos**, malla activa, central real = `10999-inference-vllm2`.
- **Stitch MCP integrado** (Claude Code + Desktop) con pack de documentación.

### En curso
| Ítem | Owner | Estado | ETA | Notas |
|------|-------|--------|-----|-------|
| `/v1/health/full` para métricas por modelo | Backend | Pendiente | — | Sin él, tok/s · p50/p95 · carga salen `—` |
| Generación de assets gráficos (cenital + primeros planos) | Rubén / Claude | Bloqueado | — | Sin vía gratis y sin instalación aprobada |
| Verificar el stack corriendo en vivo (front+back contra registry real) | Rubén | Pendiente | — | Jart-URA estaba caído al comprobar |
| Corregir `ARCHITECTURE.md` (Contabo → ionos) | — | Pendiente | — | Dato ya verificado |

### Riesgos e incidencias
| Riesgo / Incidencia | Impacto | Mitigación | Owner |
|------------|--------|------------|-------|
| **Router de referencia** sin decidir: `Jart-URA` (Node) vs `inference-vllm2` (Python) | Alto | Reencuadre: puede que Jart-URA sea el **plano de control** (API de gestión + dashboard) e `inference-vllm2`/llama-swap el **plano de datos** (inferencia). Confirmar si son complementarios, no rivales | Rubén |
| Front avanza más rápido que la verificación en vivo | Medio | Probar la UI contra el backend real arrancado, no solo en build | Rubén |
| `/v1/health/full` no existe | Medio | Implementarlo para llenar métricas; hasta entonces `—` (honesto) | Backend |
| Red de diseño (3 subredes) ≠ realidad (subred plana `100.77.1.x`) | Medio | Marcar `design-target` hasta desplegar | Rubén |
| **API key de Stitch expuesta** en chat | Medio | **Rotarla** ya; no quedó escrita en archivos | Rubén |

### Decisiones necesarias
| Decisión | Por qué importa | Plazo | Recomendación |
|----------|---------|----------|--------------------|
| Relación **Jart-URA ↔ inference-vllm2** | Define la arquitectura y a qué apunta el dashboard | Antes de Fase 1 | Confirmar el reparto control-plane (Jart-URA) / data-plane (inference-vllm2); si se solapan, consolidar |
| Vía de generación de imágenes | Bloquea el set de arte | Cuando se retome | Generarlas en Google Pro / Qwen con los prompts entregados, o autorizar la vía navegador (gratis, sin instalar) |
| Rotar la API key de Stitch | Seguridad | Cuanto antes | Crear clave nueva y borrar la expuesta |

### Prioridades del próximo periodo
1. **Confirmar la relación entre los dos routers** y corregir `ARCHITECTURE.md` (ionos).
2. **Arrancar y verificar el stack en vivo** (dashboard contra `/v1/registry` real) e implementar `/v1/health/full` para las métricas.
3. **Generar el set de arte** (cenital + primeros planos, B/N + haz centralizado) por la vía elegida.
4. **Spike de render** (2.5D vs 3D) para la cámara cinematográfica.
