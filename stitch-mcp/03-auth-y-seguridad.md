# 03 — Autenticación, variables de entorno y seguridad

## Dos métodos de autenticación

| Método | Cuándo | Cómo |
|--------|--------|------|
| **API Key** (recomendado) | Uso personal, setup rápido | Header `X-Goog-Api-Key: <key>`. Se crea en Stitch Settings → API Keys. Respaldada por Google Cloud Managed Projects — sin OAuth. |
| **ADC** (Application Default Credentials) | Tu propio proyecto GCP, IAM, equipos | `gcloud` + proyecto con billing. Varios pasos manuales. |

### Setup ADC (resumen)

```bash
gcloud auth login
export PROJECT_ID="tu-project-id"
gcloud config set project $PROJECT_ID
gcloud auth application-default set-quota-project $PROJECT_ID
gcloud beta services mcp enable stitch.googleapis.com --project=$PROJECT_ID
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:tu-email@gmail.com" \
  --role="roles/serviceusage.serviceUsageConsumer"
gcloud auth application-default login
```

---

## Variables de entorno

| Variable | Para qué |
|----------|----------|
| `STITCH_API_KEY` | API key (auth directa, salta OAuth) |
| `STITCH_ACCESS_TOKEN` | Token OAuth pre-existente (alternativa a la API key) |
| `GOOGLE_CLOUD_PROJECT` / `STITCH_PROJECT_ID` | ID de proyecto (con OAuth/ADC) |
| `STITCH_HOST` | Sobrescribe la URL del MCP server |
| `STITCH_USE_SYSTEM_GCLOUD` | (CLI comunitaria) usar tu gcloud del sistema |

Autenticación válida = `apiKey` **o** (`accessToken` + `projectId`).

---

## Buenas prácticas de seguridad

- **Nunca** comitees la API key. Usa variable de entorno (`${STITCH_API_KEY}`) o `.env.local` en `.gitignore`.
- En apps de escritorio (Claude Desktop) la clave **sí** vive en el `env` del config porque el proceso no hereda el shell — protege ese archivo y no lo compartas.
- Una clave que aparece en un chat, captura, log o repo se considera **comprometida**: rótala.
- Rotación: Stitch Settings → API Keys → crea una nueva y borra la antigua.

> **Acción pendiente para ti**: la clave `AQ.Ab8RN6…` se pegó en el chat. Bórrala/rótala en Stitch Settings y usa la nueva en los dos sitios donde dejé el placeholder/variable.

---

## Troubleshooting

| Síntoma | Causa probable / arreglo |
|---------|--------------------------|
| `AUTH_FAILED` / 401 | Key inválida o caducada, o header mal escrito (`X-Goog-Api-Key`) |
| `PERMISSION_DENIED` (ADC) | Falta rol Owner/Editor o `serviceUsageConsumer`; billing no activado; API no habilitada |
| El server `stitch` no aparece en Claude Desktop | ¿Reiniciaste la app? ¿Node 18+? ¿Pegaste la key en `env`? |
| `mcp-remote` no arranca | Prueba `npx -y mcp-remote https://stitch.googleapis.com/mcp --header "X-Goog-Api-Key:TU_KEY"` a mano para ver el error |
| URL de OAuth no aparece (CLI) | Se imprime en terminal con timeout corto; busca una URL `https://accounts.google.com` |
| Diagnóstico general (CLI) | `npx @_davideast/stitch-mcp doctor --verbose` |

---

## Legal

El uso de la Stitch API se rige por los Términos de Google, los Términos de las APIs de Google y tu configuración de Stitch. Ver el [Aviso de Privacidad de Stitch](https://stitch.withgoogle.com/privacy). El MCP es gratuito.
