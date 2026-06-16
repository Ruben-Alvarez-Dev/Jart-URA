# Jart-URA Control Center — capa funcional

Estado: **funcional** (junio 2026). Permite gestionar engines, descubrir modelos
reales en disco, crear/parametrizar modelos y **cargar/parar el proceso real** —
el circuito completo, de la UI al `llama-server` (o cualquier engine) vivo.

> Diseño visual cinematográfico = aparte (ver `dashboard/docs/control-center/`,
> ADR-0001). Esto es la parte operativa, sin adornos.

## Arrancar todo

```bash
# 1) Router + API de gestión (puerto 9100)
cd ~/Code/Jart-URA
npm start                      # node server.js

# 2) Dashboard (Vite en :3200, proxya /api → :9100)
cd dashboard
npm install                    # primera vez
npm run dev                    # http://localhost:3200
#   JART_URA_BASE=http://otra-maquina:9100 npm run dev   # apuntar a otro nodo
```

El dashboard es **live-only**: si el router no responde, muestra `Offline ·
router caído` y el estado real — nunca datos mock (Golden Rule 1).

## Flujo típico

1. **Engines** → define un engine (bin + `default_args` + `env` + JSON avanzado).
   Totalmente personalizable; un engine se puede borrar salvo que un modelo lo use.
2. **Disco** → ajusta las rutas de escaneo (una por línea, acepta `~`) y pulsa
   *Escanear*. Lista los ficheros reales (`.gguf`, `.safetensors`, `.onnx`,
   `.bin`) y bundles (`.mlmodelc`, `.mlpackage`). *Crear modelo* prerellena el form.
3. **Nuevo modelo** / form → parametriza (engine, `model_path`, `context`,
   `gpu_layers`, `threads`, `extra_args`, caps…) y marca *cargar al guardar*.
4. **Flota** → clic en una fila: **Cargar / Parar / Reiniciar / Logs / Borrar**.

Rutas de escaneo por defecto (editables): `models`, `~/models`,
`~/.cache/huggingface`, `~/.ollama/models`.

## API de gestión (`:9100`)

| Método | Ruta | Qué hace |
|--------|------|----------|
| GET | `/health` | resumen de salud (total/running/failed) |
| GET | `/v1/models[?all]` | modelos (con peers si `all`) |
| GET | `/v1/registry` | flota enriquecida (engine, tuning, pid, restarts, uptime, log) |
| GET | `/v1/engines` | engines + `in_use` |
| POST `/v1/engines` · PUT `/v1/engines/:name` | crear/actualizar engine |
| DELETE | `/v1/engines/:name` | borrar (409 si está en uso) |
| GET | `/v1/disk/paths` · PUT `/v1/disk/paths` | leer/guardar rutas de escaneo |
| GET | `/v1/disk/models[?refresh]` | escanear modelos reales en disco |
| POST `/v1/models` · PUT `/v1/models/:name` | crear/actualizar modelo (`load:true` para cargar) |
| DELETE | `/v1/models/:name` | parar + borrar de la config |
| POST | `/v1/models/:name/load` · `/unload` · `/restart` | ciclo de vida del proceso |
| GET | `/v1/models/:name/logs?tail=N` | últimas N líneas del log |

Todas responden JSON con CORS abierto. Los errores de validación llegan como
`{ ok:false, errors:[…] }` con HTTP 400 (409 para engine en uso).

## Arquitectura de la capa funcional

```
dashboard (React)
   │  fetch /api → vite proxy → :9100
   ▼
server.js (router + CORS)
   ├─ config-store.js   ← única vía de ESCRITURA de models.json (validación + .bak atómico)
   ├─ model-scanner.js  ← escaneo real de disco
   └─ control.js        ← load/unload/restart unificado
         ├─ process-manager.js  (local: spawn/kill llama-server, logs, pid, auto-restart)
         └─ proxy-manager.js    (api: arranca/para el proxy HTTP al proveedor)
```

`config/models.json` sigue siendo la única fuente de verdad. `config-parser.js`
es de solo lectura y tolerante al arranque; `config-store.js` es la puerta de
escritura con validación dura.

## Tests

```bash
npm test          # 43 tests (incluye el circuito completo end-to-end)
```

> En un sandbox Linux con `node_modules` instalados en macOS, vitest/vite fallan
> por el bug de dependencias opcionales de npm. Fix: `npm i` (o
> `npm install --no-save @rollup/rollup-linux-<arch>-gnu`).
