#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer(process.env.UNOROUTER_API_KEY);
const transport = new StdioServerTransport();
await server.connect(transport);
