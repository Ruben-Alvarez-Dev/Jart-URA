import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

const STANDALONE_HTML = fs.readFileSync(
  path.resolve(
    import.meta.filename.endsWith(".ts")
      ? import.meta.dirname
      : path.join(import.meta.dirname, ".."),
    "standalone.html",
  ),
  "utf-8",
);

export async function startStreamableHTTPServer(
  createServer: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.MCP_PORT ?? "3100", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  const jartUraBase = process.env.JART_URA_BASE || "http://localhost:9100";

  async function proxyToJartUra(req: Request, res: Response) {
    const targetPath = req.path.replace("/api/jart-ura", "");
    const targetUrl = `${jartUraBase}${targetPath}`;
    try {
      const apiRes = await fetch(targetUrl, {
        method: req.method,
        headers: { "content-type": "application/json" },
      });
      res.status(apiRes.status);
      apiRes.headers.forEach((v, k) => {
        if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) {
          res.setHeader(k, v);
        }
      });
      res.end(await apiRes.text());
    } catch {
      res.status(502).json({ error: "Cannot reach Jart-URA", target: jartUraBase });
    }
  }

  app.get("/", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(STANDALONE_HTML);
  });

  app.get("/api/jart-ura/v1/models", (req: Request, res: Response) => proxyToJartUra(req, res));
  app.get("/api/jart-ura/health", (req: Request, res: Response) => proxyToJartUra(req, res));

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
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

  const httpServer = app.listen(port, "0.0.0.0", () => {
    console.log(`[jart-ura-mcp] MCP server on http://0.0.0.0:${port}/mcp`);
    console.log(`[jart-ura-mcp] Standalone GUI on http://0.0.0.0:${port}/`);
    console.log(`[jart-ura-mcp] Jart-URA API at ${process.env.JART_URA_BASE || "http://localhost:9100"}`);
  });

  const shutdown = () => {
    console.log("\n[jart-ura-mcp] Shutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(
  createServer: () => McpServer,
): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
