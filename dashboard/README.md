# Jart-URA · Control Center (Dashboard)

UI compacta de alta densidad para operar el router de modelos **Jart-URA**: ve toda la flota mesh (local + cloud) de un vistazo, filtra, y abre el detalle profundo de cada modelo sin cambiar de pantalla.

React + Vite + Tailwind CSS + lucide-react. Tema oscuro tipo control-room.

## Arrancar

```bash
cd dashboard
npm install
npm run dev      # http://localhost:3200
npm run build    # build de producción a dist/
```

Arranca conectándose a Jart-URA (`/v1/registry`); si el router no responde, cae al **mock** automáticamente y lo indica en la barra superior.

## Los 3 patrones de interfaz

1. **Filtros globales (TopBar)** — buscador + selects (Nodo · Source · Tipo · Estado), franja de KPIs de salud de la flota e indicador de conexión (En vivo / Offline · mock). Arriba del todo (brazo superior del patrón F).
2. **Tabla densa central (ModelTable)** — una fila por modelo, columnas MUST/SHOULD, header sticky, cifras en `font-mono tabular-nums`. Clic en fila → detalle.
3. **Drawer lateral (ModelDrawer)** — panel derecho desplegable con divulgación progresiva (secciones colapsables) y los datos COULD. No cambia de ruta.

## Prioridad de la información (MoSCoW)

- **MUST** (KPIs + columnas principales): estado, modelo, nodo, source, tipo, motor, contexto, tok/s, p95, carga.
- **SHOULD** (cuerpo de tabla): max_tokens, capacidades, cost layer, certificación, uptime, reinicios.
- **COULD** (drawer): model_path, api_key_env, base_url, gpu_layers, threads, default_args, tailscale_addr, PID, historial de reinicios, logs, p50/p99, JSON crudo del registry, acciones.

## Datos en vivo (ya cableado)

El dashboard consume `GET /v1/registry` de Jart-URA con **polling cada 15 s** (mismo cadence que `mesh_poll_ms` del router) y **degradación silenciosa**: si el router está caído, mantiene los últimos datos buenos (o el mock) y solo cambia el badge de conexión — la UI nunca se rompe.

Piezas:

- `src/lib/api.js` — `fetchRegistry()` + `mapRegistryEntry()` que normaliza la respuesta unificada (`local + peered + api`) a la forma que consumen los componentes.
- `src/hooks/useFleet.js` — hook con polling, `AbortController` y fallback al mock.
- `src/data/fleet.js` — mock con la forma exacta del registry (se usa como fallback y para `npm run dev` sin router).

Apuntar a otro host (p. ej. el Mac Mini por Tailscale):

```bash
# dev: el proxy de vite.config.js ya manda /api → JART_URA_BASE (default http://localhost:9100)
JART_URA_BASE=http://mac-mini-m1:9100 npm run dev

# build/SPA servida aparte: salta el proxy y pega directo al management API
VITE_JART_URA_BASE=http://mac-mini-m1:9100 npm run build
```

> Nota: algunos campos (context, gpu_layers, threads) sólo llegan si el registry los expone; las métricas (tok/s, p50/p95/p99, carga) corresponden a endpoints **planificados** (`/v1/health/full`, Prometheus) — hasta entonces se muestran como `—`/`0` con datos reales, o simuladas en el mock.

## Estructura

```
dashboard/
├── index.html
├── vite.config.js          # proxy /api → Jart-URA :9100 (JART_URA_BASE)
├── tailwind.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx             # estado, filtrado, layout
│   ├── hooks/useFleet.js    # polling 15s + fallback (datos en vivo)
│   ├── lib/
│   │   ├── api.js           # fetch + map de /v1/registry
│   │   └── format.js        # mapas de estado/source/cost + helpers
│   ├── data/fleet.js        # mock con forma de /v1/registry
│   └── components/
│       ├── TopBar.jsx       # patrón 1: filtros globales + conexión
│       ├── KpiStrip.jsx     # KPIs de salud de la flota
│       ├── ModelTable.jsx   # patrón 2: tabla densa
│       └── ModelDrawer.jsx  # patrón 3: drawer de detalle
```
