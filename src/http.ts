#!/usr/bin/env node
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "./server.js";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3000);

// Stateless mode: a fresh server + transport per request, the caller's own
// UnoRouter key rides in as a Bearer token so the endpoint is multi tenant.
const httpServer = http.createServer(async (req, res) => {
  const rawUrl = new URL(req.url ?? "/", "http://localhost");
  if (rawUrl.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (rawUrl.pathname !== "/mcp" && rawUrl.pathname !== "/") {
    res.writeHead(404, { "Content-Type": "application/json" }).end(
      JSON.stringify({ error: "not found, POST /mcp" }),
    );
    return;
  }
  if (req.method !== "POST") {
    res
      .writeHead(405, { "Content-Type": "application/json", Allow: "POST" })
      .end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed. Use POST." },
          id: null,
        }),
      );
    return;
  }

  const auth = req.headers.authorization;
  // Smithery-style session config arrives as ?apiKey=; Bearer wins when both set.
  const apiKey = auth?.startsWith("Bearer ")
    ? auth.slice(7)
    : (rawUrl.searchParams.get("apiKey") ?? undefined);

  try {
    const server = createMcpServer(apiKey);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : undefined;

    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(err) },
          id: null,
        }),
      );
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`unorouter-mcp streamable http on :${PORT}/mcp`);
});
