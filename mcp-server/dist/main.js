import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "./server.js";
const STANDALONE_HTML = fs.readFileSync(path.resolve(import.meta.filename.endsWith(".ts")
    ? import.meta.dirname
    : path.join(import.meta.dirname, ".."), "standalone.html"), "utf-8");
export async function startStreamableHTTPServer(createServer) {
    const port = parseInt(process.env.MCP_PORT ?? "3100", 10);
    const app = createMcpExpressApp({ host: "0.0.0.0" });
    app.use(cors());
    const jartUraBase = process.env.JART_URA_BASE || "http://localhost:9100";
    app.get("/", (_req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(STANDALONE_HTML);
    });
    // Proxy API calls from the standalone dashboard to Jart-URA (avoids CORS)
    app.all("/api/jart-ura/*", async (req, res) => {
        const targetPath = req.path.replace("/api/jart-ura", "");
        const targetUrl = `${jartUraBase}${targetPath}${req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : ""}`;
        try {
            const apiRes = await fetch(targetUrl, {
                method: req.method,
                headers: { "content-type": req.headers["content-type"] || "application/json" },
                body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body),
            });
            res.status(apiRes.status);
            apiRes.headers.forEach((v, k) => {
                if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) {
                    res.setHeader(k, v);
                }
            });
            const text = await apiRes.text();
            res.end(text);
        }
        catch (err) {
            console.error("[proxy] error:", err);
            res.status(502).json({ error: "Failed to reach Jart-URA", target: jartUraBase });
        }
    });
    app.all("/mcp", async (req, res) => {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        res.on("close", () => {
            transport.close().catch(() => { });
            server.close().catch(() => { });
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            console.error("MCP error:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                    id: null,
                });
            }
        }
    });
    const httpServer = app.listen(port, () => {
        console.log(`[jart-ura-mcp] MCP server on http://localhost:${port}/mcp`);
        console.log(`[jart-ura-mcp] Jart-URA API at ${process.env.JART_URA_BASE || "http://localhost:9100"}`);
    });
    const shutdown = () => {
        console.log("\n[jart-ura-mcp] Shutting down...");
        httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
export async function startStdioServer(createServer) {
    await createServer().connect(new StdioServerTransport());
}
async function main() {
    if (process.argv.includes("--stdio")) {
        await startStdioServer(createServer);
    }
    else {
        await startStreamableHTTPServer(createServer);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=main.js.map