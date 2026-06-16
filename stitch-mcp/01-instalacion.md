# 01 — Instalación de Stitch MCP por cliente

## Paso 0 — Crear una API key (recomendado)

1. Entra en https://stitch.withgoogle.com/
2. Clic en tu foto de perfil (arriba a la derecha) → **Stitch Settings**.
3. Sección **API Keys** → **Create Key**.
4. Copia la clave y guárdala en un gestor seguro. **No la pegues en chats ni la subas a git.**

> La API key está respaldada por "Google Cloud Managed Projects": no necesitas montar un proyecto de GCP ni el baile de OAuth. Para el método alternativo (ADC con tu propio proyecto), ver `03-auth-y-seguridad.md`.

Exporta la clave en tu shell (para Claude Code, SDK y CLI):

```bash
# ~/.zshrc  (o ~/.bashrc)
export STITCH_API_KEY="tu-nueva-api-key"
```

---

## Claude Code (CLI)  ✅ dejado listo

He creado `/Users/ruben/Code/Jart-URA/.mcp.json`:

```json
{
  "mcpServers": {
    "stitch": {
      "type": "http",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": { "X-Goog-Api-Key": "${STITCH_API_KEY}" }
    }
  }
}
```

La clave **no** está en el archivo: se lee de `${STITCH_API_KEY}`. Pasos para activarlo:

```bash
export STITCH_API_KEY="tu-nueva-api-key"   # en tu shell
cd /Users/ruben/Code/Jart-URA
claude                                       # al abrir el repo, aprueba el server del .mcp.json
/mcp                                         # comprueba que "stitch" aparece conectado
```

- Este `.mcp.json` es **de proyecto** (solo activo dentro de `Jart-URA/`). Es versionable y seguro porque usa variable de entorno.
- ¿Lo quieres **global** (en cualquier repo)? Usa scope de usuario:

```bash
claude mcp add stitch --scope user --transport http \
  https://stitch.googleapis.com/mcp \
  --header "X-Goog-Api-Key: $STITCH_API_KEY"
```

---

## Claude Desktop / Cowork (esta app)  ⚠️ pendiente de 2 pasos tuyos

He añadido esta entrada a `~/Library/Application Support/Claude/claude_desktop_config.json` (usa el puente `mcp-remote` porque tu config es de tipo stdio):

```json
"stitch": {
  "command": "npx",
  "args": [
    "-y", "mcp-remote",
    "https://stitch.googleapis.com/mcp",
    "--header", "X-Goog-Api-Key:${STITCH_API_KEY}"
  ],
  "env": { "STITCH_API_KEY": "PEGA_AQUI_TU_NUEVA_API_KEY" }
}
```

**Para terminar:**

1. Abre el archivo y sustituye `PEGA_AQUI_TU_NUEVA_API_KEY` por tu clave nueva (las apps de escritorio no heredan el `export` del shell, por eso la clave va en el propio `env`).
2. **Reinicia Claude Desktop** por completo (Cmd+Q y volver a abrir) para que cargue el nuevo server.
3. Requisitos: Node.js 18+ instalado (para `npx mcp-remote`).

> Si `mcp-remote` no expandiera `${STITCH_API_KEY}` dentro del `--header` en tu versión, pon la clave literal en ese arg: `"X-Goog-Api-Key:tu-clave"`. Funciona igual, solo queda visible en la lista de procesos.

---

## Gemini CLI (extensión oficial)

Requiere Gemini CLI v0.19.0+.

```bash
gemini extensions install https://github.com/gemini-cli-extensions/stitch --auto-update

# Auth por API key:
export API_KEY="tu-nueva-api-key"
sed "s/YOUR_API_KEY/$API_KEY/g" \
  ~/.gemini/extensions/Stitch/gemini-extension-apikey.json \
  > ~/.gemini/extensions/Stitch/gemini-extension.json
```

Uso:

```bash
gemini
/mcp list                 # ver tools de Stitch
/stitch ¿Qué proyectos de Stitch tengo?
/stitch Diseña una app móvil para esquiadores en los Alpes, con Gemini 3 Pro.
```

---

## CLI comunitaria `stitch-mcp` (opcional, no oficial)

Útil para **previsualizar diseños en local**, montarlos como sitio Astro, o exponer un proxy MCP a cualquier IDE.

```bash
npx @_davideast/stitch-mcp init          # asistente de auth + config
npx @_davideast/stitch-mcp serve -p <project-id>   # previsualiza pantallas en local
npx @_davideast/stitch-mcp view --projects         # explora tus proyectos en terminal
```

Como server MCP (VS Code, Cursor, Claude Code, Gemini CLI, Codex, OpenCode):

```json
{ "mcpServers": { "stitch": { "command": "npx", "args": ["@_davideast/stitch-mcp", "proxy"] } } }
```

> Es un proyecto experimental independiente, **no respaldado por Google**. Úsalo bajo tu responsabilidad.
