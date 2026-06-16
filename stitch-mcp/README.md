# Stitch (Google) — Pack de integración y documentación

> Recopilado el 2026-06-14. Stitch está en **beta** (Google Labs). El MCP es **gratuito**.
> Fuente canónica: https://stitch.withgoogle.com/docs

**Stitch** es la herramienta de Google Labs de diseño UI/UX + generación de código con IA. Generas pantallas de interfaz desde un prompt de texto y te devuelve **HTML/CSS + capturas**, editable y exportable. Los modelos son **Gemini 3 Pro** y **Gemini 3 Flash** (por defecto Flash).

Stitch se expone a agentes y herramientas por cuatro vías:

| Vía | Qué es | Oficial |
|-----|--------|---------|
| **MCP Server** | Servidor MCP remoto en `https://stitch.googleapis.com/mcp` | ✅ Google |
| **SDK** | `@google/stitch-sdk` (TypeScript) para generar pantallas mediante código | ✅ Google Labs |
| **Gemini CLI Extension** | Extensión `/stitch` para Gemini CLI | ✅ Google |
| **Agent Skills** | Skills de agente publicadas junto al SDK (`.agents/skills`) | ✅ Google Labs |
| **stitch-mcp (CLI)** | CLI comunitaria para previsualizar/servir diseños y proxy MCP | ⚠️ No oficial (David East) |

---

## Estado de instalación en este equipo

Lo que he dejado configurado en `macbook-pro-de-ruben-local`:

- **Claude Code** → `/Users/ruben/Code/Jart-URA/.mcp.json` creado (transporte `http`, header `X-Goog-Api-Key` vía variable de entorno `${STITCH_API_KEY}`).
- **Claude Desktop (esta app)** → entrada `stitch` añadida a `claude_desktop_config.json` usando el puente `mcp-remote`. **Pendiente**: pegar una API key nueva y reiniciar la app (ver más abajo).

> ⚠️ **Seguridad**: la API key que pegaste en el chat (`AQ.Ab8RN6…`) está comprometida. **Rótala** en Stitch Settings → API Keys y usa la nueva. No la he escrito en ningún archivo; en su lugar verás el placeholder `PEGA_AQUI_TU_NUEVA_API_KEY` y la variable `${STITCH_API_KEY}`.

---

## Índice del pack

1. **[01-instalacion.md](01-instalacion.md)** — Crear API key, y conectar Stitch a Claude Code, Claude Desktop, Gemini CLI y la CLI comunitaria. Pasos finales pendientes.
2. **[02-herramientas-y-sdk.md](02-herramientas-y-sdk.md)** — Referencia de tools MCP, el SDK `@google/stitch-sdk` (clases, métodos, integración con Vercel AI SDK) y las "virtual tools" de la CLI.
3. **[03-auth-y-seguridad.md](03-auth-y-seguridad.md)** — API Key vs ADC, variables de entorno, buenas prácticas y troubleshooting.

---

## Datos clave (referencia rápida)

| Campo | Valor |
|-------|-------|
| Endpoint MCP | `https://stitch.googleapis.com/mcp` |
| Transporte | HTTP (streamable) |
| Header de auth (API key) | `X-Goog-Api-Key: <API_KEY>` |
| Auth alternativa | OAuth / ADC (Google Cloud project) |
| Coste | Gratis |
| Modelos | `GEMINI_3_PRO`, `GEMINI_3_FLASH` (default) |
| App web | https://stitch.withgoogle.com/ |
| Crear API key | Stitch → perfil → **Stitch Settings** → **API Keys** → **Create Key** |

## Enlaces oficiales

- Docs: https://stitch.withgoogle.com/docs · setup MCP: https://stitch.withgoogle.com/docs/mcp/setup
- SDK: https://github.com/google-labs-code/stitch-sdk
- Gemini CLI extension: https://github.com/gemini-cli-extensions/stitch
- Codelab (Antigravity + Stitch): https://codelabs.developers.google.com/design-to-code-with-antigravity-stitch
- CLI comunitaria (no oficial): https://github.com/davideast/stitch-mcp
- Privacidad: https://stitch.withgoogle.com/privacy
