import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool, } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
const DIST_DIR = import.meta.filename.endsWith(".ts")
    ? path.join(import.meta.dirname, "dist")
    : import.meta.dirname;
const JART_URA_BASE = process.env.JART_URA_BASE || "http://localhost:9100";
// =============================================================================
// Jart-URA API client
// =============================================================================
async function fetchModels() {
    const res = await fetch(`${JART_URA_BASE}/v1/models`);
    if (!res.ok)
        throw new Error(`Jart-URA /v1/models: ${res.status}`);
    const body = await res.json();
    return body.data;
}
async function fetchHealth() {
    const res = await fetch(`${JART_URA_BASE}/health`);
    if (!res.ok)
        throw new Error(`Jart-URA /health: ${res.status}`);
    return (await res.json());
}
// =============================================================================
// MCP server
// =============================================================================
export function createServer() {
    const server = new McpServer({
        name: "Jart-URA Dashboard",
        version: "0.1.0",
    });
    const resourceUri = "ui://jart-ura/dashboard.html";
    // Model-facing tool: returns all models + health, opens dashboard UI
    registerAppTool(server, "get-dashboard", {
        title: "Jart-URA Dashboard",
        description: "Returns the full model registry and health status, and opens an interactive dashboard UI for model management.",
        inputSchema: {},
        _meta: { ui: { resourceUri } },
    }, async () => {
        const [models, health] = await Promise.all([
            fetchModels(),
            fetchHealth(),
        ]);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ models, health }, null, 2),
                },
            ],
            structuredContent: { models, health },
        };
    });
    // Model-facing tool: detail for a specific model
    registerAppTool(server, "get-model-detail", {
        title: "Model Detail",
        description: "Returns detailed status for a specific model by name.",
        inputSchema: {
            name: z.string().describe("Model name (e.g. 'primary', 'gpt-4o')"),
        },
        outputSchema: {},
        _meta: { ui: { resourceUri } },
    }, async (args) => {
        const models = await fetchModels();
        const model = models.find((m) => m.name === args.name);
        if (!model) {
            return {
                content: [{ type: "text", text: `Model '${args.name}' not found` }],
                isError: true,
            };
        }
        return {
            content: [
                { type: "text", text: JSON.stringify(model, null, 2) },
            ],
            structuredContent: model,
        };
    });
    // App-only tool: poll live model status for the UI
    registerAppTool(server, "poll-model-status", {
        title: "Poll Model Status",
        description: "Returns current model status and health for live dashboard updates. App-only.",
        inputSchema: {},
        outputSchema: {},
        _meta: { ui: { visibility: ["app"] } },
    }, async () => {
        const [models, health] = await Promise.all([
            fetchModels(),
            fetchHealth(),
        ]);
        return {
            content: [
                { type: "text", text: JSON.stringify({ models, health }) },
            ],
            structuredContent: { models, health },
        };
    });
    // Register the dashboard HTML resource
    registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE, description: "Jart-URA Dashboard UI" }, async () => {
        const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
        return {
            contents: [
                {
                    uri: resourceUri,
                    mimeType: RESOURCE_MIME_TYPE,
                    text: html,
                },
            ],
        };
    });
    return server;
}
//# sourceMappingURL=server.js.map