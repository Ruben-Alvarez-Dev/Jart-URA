# 02 — Herramientas MCP, SDK y CLI

## Tools del MCP server

Estas son las tools que expone el servidor Stitch a los agentes (nombres confirmados en el SDK y la extensión de Gemini CLI):

| Tool | Qué hace |
|------|----------|
| `create_project` | Crea un proyecto nuevo (`{ title }`) |
| `generate_screen_from_text` | Genera una pantalla desde un prompt de texto (modelo Gemini 3 Pro/Flash) |
| `get_screen` | Recupera una pantalla por ID (HTML + metadatos) |
| *(list projects)* | Lista tus proyectos |
| *(project details)* | Detalle de un proyecto por ID |
| *(retrieve screens)* | Lista las pantallas de un proyecto |
| *(download assets)* | Descarga el HTML o la imagen de una pantalla |
| *(edit screen)* | Edita una pantalla con un prompt |
| *(generate variants)* | Genera variantes de diseño |
| *(enhance prompt)* | Mejora/expande un prompt de diseño |

Para ver la lista viva y sus esquemas desde un cliente: `/mcp list` y `/mcp desc` (Gemini CLI) o `/mcp` (Claude Code). Con la CLI comunitaria: `npx @_davideast/stitch-mcp tool` (lista) y `tool -s <name>` (esquema).

---

## SDK oficial — `@google/stitch-sdk`

Genera pantallas y extrae HTML/capturas mediante código. TypeScript.

```bash
npm install @google/stitch-sdk
```

```ts
import { stitch } from "@google/stitch-sdk";   // lee STITCH_API_KEY del entorno

const project = stitch.project("your-project-id");
const screen  = await project.generate("A login page with email and password fields");
const html    = await screen.getHtml();    // URL de descarga del HTML
const imageUrl = await screen.getImage();  // URL de la captura
```

### Clases principales

| Clase | Rol |
|-------|-----|
| `Stitch` | Raíz. `projects()`, `project(id)` |
| `Project` | `generate(prompt, deviceType?)`, `screens()`, `getScreen(id)`; props `id`/`projectId` |
| `Screen` | `edit(prompt)`, `variants(prompt, opts)`, `getHtml()`, `getImage()` |
| `StitchToolClient` | Acceso directo a tools MCP: `callTool(name, args)`, `listTools()` |
| `StitchProxy` | Servidor proxy MCP para reexponer las tools por tu propio server |
| `stitchTools()` | Devuelve las tools como objetos del **Vercel AI SDK** |
| `stitch` | Singleton preconfigurado (lee `STITCH_API_KEY`) |

### Enums y opciones

- `DeviceType`: `MOBILE` · `DESKTOP` · `TABLET` · `AGNOSTIC`
- `modelId`: `GEMINI_3_PRO` · `GEMINI_3_FLASH`
- `variants(prompt, opts)` → `opts`:
  - `variantCount`: 1–5 (default 3)
  - `creativeRange`: `REFINE` · `EXPLORE` (default) · `REIMAGINE`
  - `aspects`: `LAYOUT` · `COLOR_SCHEME` · `IMAGES` · `TEXT_FONT` · `TEXT_CONTENT`

### Integración con Vercel AI SDK

```ts
import { generateText, stepCountIs } from "ai";
import { stitchTools } from "@google/stitch-sdk/ai";

const { text, steps } = await generateText({
  model: yourModel,
  tools: stitchTools(),                 // el modelo llama create_project, generate_screen, get_screen…
  prompt: "Create a project and generate a modern dashboard with a stat card",
  stopWhen: stepCountIs(5),
});
```

### Configuración explícita

```ts
import { StitchToolClient } from "@google/stitch-sdk";
const client = new StitchToolClient({
  apiKey: process.env.STITCH_API_KEY,
  baseUrl: "https://stitch.googleapis.com/mcp",
  timeout: 300_000,
});
```

### Errores

Todos los métodos lanzan `StitchError` con `code` ∈ `AUTH_FAILED`, `NOT_FOUND`, `PERMISSION_DENIED`, `RATE_LIMITED`, `NETWORK_ERROR`, `VALIDATION_ERROR`, `UNKNOWN_ERROR`.

---

## Virtual tools de la CLI comunitaria (`@_davideast/stitch-mcp proxy`)

El proxy añade tools de alto nivel sobre las del MCP oficial:

| Virtual tool | Qué hace |
|--------------|----------|
| `build_site` | Construye un sitio mapeando pantallas → rutas; devuelve el HTML por página |
| `get_screen_code` | Recupera una pantalla y descarga su HTML |
| `get_screen_image` | Recupera una pantalla y descarga la captura en base64 |

`build_site` (input): `{ projectId, routes: [{ screenId, route }] }`.

Comandos útiles de la CLI: `serve` (preview local con Vite), `site` (genera proyecto Astro), `view`/`screens` (explorar en terminal), `snapshot`, `doctor`, `tool`, `proxy`.
