import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import { createServer } from "./server.js";
export async function startStreamableHTTPServer(createServer) {
    const port = parseInt(process.env.MCP_PORT ?? "3100", 10);
    const app = createMcpExpressApp({ host: "0.0.0.0" });
    app.use(cors());
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