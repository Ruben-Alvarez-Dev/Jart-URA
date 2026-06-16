# Handoff a Jart-URA — Rediseño del Dashboard (JART-URA Control Center cinematográfico)

> **Para Rubén (cómo usar esto):** pega TODO el bloque de abajo (desde
> «PROMPT ↓») en tu sesión de Jart-URA, y adjunta las **3 imágenes** (las notas
> manuscritas). El contexto técnico real ya va incrustado, así que el agente no
> parte de cero ni necesita inventar. El **lead es el arquitecto UX**; mi papel
> (Jart-UP) ha sido auditar el repo real de Jart-URA y compilar la verdad.

---

## PROMPT ↓ (pégalo en Jart-URA, con las 3 imágenes)

Eres el equipo de **Jart-URA**, liderado por un **arquitecto UX senior**. Vas a
**rediseñar y reemplazar el dashboard actual** de Jart-URA por un **Control
Center cinematográfico**: un mapa vivo de la flota real y de cómo se enruta la
inferencia por ella. Respeta íntegramente las golden rules del proyecto
(detalladas al final). **La UX la lideras tú** — es tu especialidad.

### 1. Punto de partida real (ya auditado)

- **Jart-URA** = Universal Routing Agent: router de modelos para Tier-0 (Node,
  config-driven, `config/models.json`). Gestiona `llama-server` locales y proxea
  APIs remotas; expone una **management API en `:9100`**.
- Existe `dashboard/` (React 18 + Vite 6 + Tailwind 3 + lucide-react): "dense
  ops dashboard".
- **PROBLEMA A RESOLVER (regla 1):** el dashboard actual **arranca con datos
  MOCK**. Pruebas: `dashboard/src/data/fleet.js` (`// Mock fleet…`),
  `dashboard/src/hooks/useFleet.js` (`usingMock = true` por defecto, fallback a
  mock), `TopBar.jsx` (badge "datos mock", "Offline · mock"). Eso es la
  "mentira" que hay que eliminar. **El nuevo dashboard se conecta SIEMPRE a
  datos reales**; si algo está caído, muestra su estado real (offline/stopped),
  nunca mock.

### 2. Visión del nuevo dashboard (de las notas + explicación de Rubén)

- Es un **MAPA VIVO** del conjunto de equipos y componentes reales que
  intervienen, y de las **rutas** por las que viaja la inferencia.
- **En reposo:** escena con **profundidad**, vista alejada (como una cámara).
- **Al interactuar:** tocas una pieza o sector y la **cámara hace zoom** a esa
  zona; los componentes **se abren** y se **iluminan** las partes y **rutas
  afectadas**, con **flechas y animación**. Puedes señalar una **ruta completa**,
  o los **dos sentidos** de una ruta **diferenciados por color**.
- **Equipos normalizados:** todos los aparatos representados con un trato común,
  minimalista. La escena base es **blanco / negro / gris desaturado**; los
  **flujos de datos van en NEÓN** como único acento que resalta.
- **Por dentro de cada equipo:** CPU, RAM, **ANE/NPU**, GPU (Metal), disco, NIC;
  y los **canales de red coloreados por protocolo** (p. ej. WebRTC un color,
  HTTP otro, Tailscale/WireGuard otro…).
- **Side panels = SELECTORES.** No ocupan el centro: **se deslizan hacia dentro
  por los lados** (derecha, izquierda, arriba, abajo, o combinación) según lo
  que toques; muestran **qué estás decidiendo** y **permiten modificarlo**. El
  **centro siempre mantiene el mapa** (el "escaparate"): te enseña dónde está
  cada cosa, quién es, y su comunicación. Ejemplo de ficha lateral: `modelo /
  CoreML / 1.8 GB / 12% / 5000 tokens`.
- **Ejemplo de ruta a iluminar** (clave): la cadena de voz **STT → LLM → TTS**.
  Al tocarla, el mapa **traza e ilumina el camino real** por donde van los
  datos, señalando cada elemento ("esto aquí") y resaltando ese tramo.
- **TIP NUCLEAR (de las notas):** los componentes son **componentes de React
  con ESTADOS**. Es precisamente la **fidelidad estado ↔ realidad** lo que activa
  la magia: el mapa señala **exactamente lo que sucede, cómo y dónde**. El mapa
  no es decorativo — es un reflejo fiel del estado real del sistema.

### 3. Dirección de arte (cinematográfica)

- **Cámara** que se desplaza con **zoom in / zoom out por piezas y aparatos**.
- Profundidad / parallax en reposo.
- Paleta base **blanco, negro y gris desaturado**; aparatos tratados como
  **"fotografías desteñidas, versión anime triste"** (desaturadas, melancólicas).
- **Acentos de flujo en NEÓN** que resaltan sobre la escena apagada.
- **Tipografía** acorde al tema (cinematográfica).
- Transiciones suaves; el "gran dibujo" hace zoom e ilumina las piezas afectadas
  conforme te acercas.

### 4. Inventario REAL de piezas (úsalo como verdad — NO inventes)

> Distingue tres niveles de certeza. **Consume datos en vivo**, no hardcodees.

**A) Fuentes de verdad a consumir en vivo**
- `GET :9100/v1/registry` → `{ hostname, local[], peered[], peers[], unified[] }`.
- `GET :9100/v1/models`, `GET :9100/health`.
- Planeados (degradan a `—` hoy): `/v1/health/full` y **FRONTIER BENCH**
  (`:4400`) para métricas/certificación por modelo.
- Topología física: snapshots de nodos (Tailscale, hardware, puertos abiertos).

**B) Modelos configurados — REAL (`config/models.json`, Mac Mini)**
`primary` (qwen2.5-7b-instruct, :9001), `small` (Qwen3.5-2B, :9002), `embed`
(bge-m3, :9003), `coder` (Qwen2.5-Coder-3B, :9004), `fast` (Qwen3-1.7B, :9005),
`multi` (gemma-3n-E2B, :9006); proxy API `gpt-4o` (:9010). `port_range`
9000–9999, `mesh_poll_ms` 15000, `peers: []` (a poblar).

**C) Equipos físicos — REAL (snapshots Tailscale, 2026-06-11)**
- **Mac Mini M1 16GB** — TIER-0-METAL — Tailscale `100.77.1.20`, LAN
  `192.168.1.50` — macOS 26.5 arm64. Corre: Jart-URA `:9100` + `llama-server`
  (Metal) `:9001-9006`, proxies `:9010-9012`, Ollama `:11434`, LM Studio,
  **ANE**, STT (whisper.cpp), TTS (Kokoro-82M ONNX), Home Assistant, Tailscale,
  SMB `:445`, VNC `:5900`.
- **MacBook Pro M1 Max 32GB** — WORKHORSE — `100.77.1.30` (LAN `192.168.1.44`).
- **VPS ionos** — `82.223.64.198` — Ubuntu 26.04 (KVM/QEMU x86-64), Docker, UFW,
  fail2ban, Tailscale (`udp 41641`), puertos `443/53/50000`.
- **jart-os-remote-server-2** — `100.118.124.101` (linux, tagged).
- **Móviles/tablet:** Pixel (`100.77.1.31`), Samsung S9 FE (`100.77.1.32`),
  Xiaomi Pad 5 (`100.77.1.33`) — Android.

**D) Topología documentada — DISEÑO OBJETIVO (`ARCHITECTURE.md`; valida el
despliegue real antes de pintarlo como activo)**
- Mac Mini M1 (TIER-0-METAL) ↔ MacBook Pro M1 Max (WORKHORSE) ↔ **VPS Contabo
  24GB** (SERVICES) sobre **Tailscale (mesh)**.
- VPS Contabo SERVICES: **LiteLLM `:10280`** (cloud gateway), Postgres `:10281`,
  vLLM `:10282` (opt), WebUI `:10283`, Monitor `:10284`, **TEI** (embed+reranker),
  **Qdrant** (RAG), **LiveKit `:7881`** (WebRTC SFU) + `:50000-60000/udp`,
  **FRONTIER BENCH `:4400`**.
- Pipeline de inferencia (slots): **VAD · STT · ROUTER · LLM · TTS · VISION ·
  EMBEDDINGS**.

> ⚠️ **`ionos` vs `Contabo`:** el snapshot real es un VPS **ionos**; ARCHITECTURE
> menciona **Contabo**. Confírmalo con Rubén / los snapshots antes de fijarlo.

**E) Protocolos / canales (para colorear)**
- HTTP (OpenAI-spec) `:9001-9012`, management HTTP `:9100`, LiteLLM `:10280`.
- WebSocket (LiveKit `:7881`). **WebRTC/Opus** (`:50000-60000/udp`).
- **Tailscale / WireGuard** (`udp 41641`, red `100.x`). SSH `:22`. Ollama
  `:11434`. SMB/VNC (LAN).

**F) Rutas reales clave (para iluminar)**
- **Chat:** Electron → Unified LLM Client → Jart-URA `:9100` → `llama-server`
  local **o** proxy API (política *local-first, cloud fallback*).
- **Mesh cross-nodo:** Jart-URA sondea peers vía Tailscale
  `hostname:9100/v1/models` cada 15s.
- **Voz:** Browser/Electron → **WebRTC/Opus** → **LiveKit** (VPS) → **Silero
  VAD** → **whisper.cpp STT** → LiteLLM/Jart-URA → **Kokoro-82M TTS** →
  WebRTC/Opus → usuario.
- **Cloud:** vía **LiteLLM `:10280`** → OpenAI / Anthropic / OpenRouter / Groq
  (capas de coste: flat/free, PPU, backup).

### 5. Modelo de datos para el dashboard (sin mock)

Normaliza `/v1/registry` (ver `dashboard/src/lib/api.js → mapRegistryEntry`,
ya escrito y correcto). Campos por modelo: `name, node/hostname, source
(local|api), port, status (running|degraded|failed|stopped), type
(chat|embedding), provider, model, caps{vision,fnCall}, context, maxTokens,
engine, tailscale_addr, metrics{tps,p50,p95,p99,loadPct,reqActive,reqTotal,
uptime}, pid, restarts, lastRestart, logPath, cert, benchSource`. Lo que el
backend aún no emite degrada a `null`/`—` (no lo inventes).

**ACCIÓN:** elimina `dashboard/src/data/fleet.js` (mock) y el fallback
`usingMock`; conecta `useFleet` a `fetchRegistry()` real con un indicador de
conexión **honesto** (connecting / live / offline).

### 6. Golden rules (innegociables)

1. **Nada de mock / demo / fake / datos ficticios.** 100% real, de producción.
2. SOLID, DRY, clean/hexagonal, **BEM**, patrones claros; estructuras de datos
   coherentes; documentación impecable en **inglés**; estándares de la industria
   (ADRs, changelogs).
3. **Commits granulares** y orgánicos (2–4 frases), en inglés, con push si hay
   remoto.
4. **Enfoque quirúrgico:** no romper lo que funciona sin aprobación previa;
   consultar planes enteros y acciones atómicas.
5. **Spec-driven:** planificación meticulosa, análisis de consecuencias,
   valoración de opciones.
6. **Contrastar cada dato con una segunda fuente.** No suponer: comprobar.

### 7. Plan de trabajo (UX-first, por fases)

- **Fase 0 — Arquitectura UX (el "mapa").** El arquitecto UX define el **modelo
  de entidades-relaciones**: equipos, componentes, canales/protocolos, rutas y
  **estados**, + el sistema de interacción (cámara, zoom, side-panels-selectores,
  iluminación de rutas). *Entregable: spec UX + mapa E-R.*
- **Fase 1 — Dirección de arte y assets.** Estética (anime-triste desaturado +
  neón), tipografía; **set normalizado** de siluetas/"fotos" de equipos y
  componentes. Puedes apoyarte en **Stitch** (hay `stitch-mcp/` en el repo) para
  la generación gráfica.
- **Fase 2 — Spike técnico.** Elige la base de render/cámara **evaluando
  opciones reales** (p. ej. `react-three-fiber` + `drei` para escena 3D con
  cámara real; o DOM/SVG 2.5D con `framer-motion` + transforms; o `pixi`/
  `konva`) y la librería de motion. Decide por rendimiento, complejidad y
  fidelidad al zoom-cámara. *No te cases con una sin contrastar.*
- **Fase 3 — Implementación.** Escena + side panels (selectores) + binding a
  `/v1/registry` real + iluminación de rutas por **estado** y **protocolo** +
  animación de flujos en neón.
- **Fase 4 — Verificación.** Contra datos reales (nodos y estados reales). Ni un
  solo dato inventado.

**Primer entregable que se te pide:** la **spec UX + el mapa de
entidades-relaciones** (Fase 0), para revisar antes de la parte gráfica.

### 8. Las 3 imágenes adjuntas (transcripción)

1. **Notas (rutas + TIP):** «o puedo señalar una ruta completa, o los dos
   sentidos de una ruta y diferenciarlos por colores… **TIP →** los componentes
   son componentes de React, tienen **ESTADOS**; es precisamente la fidelidad
   del mapa y su correspondencia con la realidad lo que activa la magia, porque
   señala exactamente lo que sucede, cómo y dónde.»
2. **Sketch (zoom + side panel):** un equipo con **zoom a un chip "Apple NPU"**
   y un **side panel** con `modelo / CoreML / 1.8 GB / 12% / 5000 tokens`. «Al
   zoomear tendremos una ficha lateral (a derecha, izquierda, arriba, abajo o
   combinación) que nos diga qué estamos decidiendo y permita modificarlo. Los
   side panels son los selectores; el dashboard se convierte en el escaparate
   que te enseña dónde está, quién es y su comunicación.»
3. **"Sistema de representación de dashboard":** X equipos con Y
   características; representación **hiperrealista-cómica-anime** de los recursos
   importantes; esquemas de PC/Mac/VPS; cuando el sistema sabe un stack →
   recuento → conjunto de X piezas; piezas **normalizadas** en gráficas
   (cómicas); se ven los **componentes principales por dentro, animados**, y se
   **iluminan** al tocar algo relacionado; conforme te acercas a una pieza, el
   gran dibujo hace **zoom e ilumina** las piezas afectadas.

— Fin del prompt —
