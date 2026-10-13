#!/usr/bin/env node
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "./server.js";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3000);
// MCP messages are a few KB; an unbounded read let one POST exhaust the pod's memory.
const MAX_BODY_BYTES = 1 << 20;

const sendJson = (res: http.ServerResponse, status: number, payload: unknown) => {
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  }
};

// Stateless mode: a fresh server + transport per request, the caller's own
// UnoRouter key rides in as a Bearer token so the endpoint is multi tenant.
const httpServer = http.createServer(async (req, res) => {
  let rawUrl: URL;
  try {
    // "//" and similar reach here from scanners; an uncaught throw used to exit the process
    rawUrl = new URL(req.url ?? "/", "http://localhost");
  } catch {
    sendJson(res, 400, { error: "invalid request path" });
    return;
  }
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
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) {
        sendJson(res, 413, {
          jsonrpc: "2.0",
          error: { code: -32600, message: "Request body too large" },
          id: null,
        });
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : undefined;

    await transport.handleRequest(req, res, body);
  } catch (err) {
    sendJson(res, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: String(err) },
      id: null,
    });
  }
});

httpServer.listen(PORT, () => {
  console.log(`unorouter-mcp streamable http on :${PORT}/mcp`);
});
