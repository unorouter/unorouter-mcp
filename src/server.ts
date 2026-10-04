import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const API_BASE = process.env.UNOROUTER_BASE_URL ?? "https://api.unorouter.com";

interface PricingModel {
  model_name: string;
  quota_type?: number;
  model_ratio?: number;
  model_price?: number;
  owner_by?: string;
  completion_ratio?: number;
  enable_groups?: string[];
  supported_endpoint_types?: string[];
}

export function createServer(apiKey: string | undefined): McpServer {
  function authHeaders(): Record<string, string> {
    if (!apiKey) {
      throw new Error(
        "No API key. Pass an Authorization: Bearer header (HTTP) or set UNOROUTER_API_KEY (stdio). Create a key at https://unorouter.com/token.",
      );
    }
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async function fetchModels(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/v1/models`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET /v1/models failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: { id: string }[] };
  return body.data.map((m) => m.id);
}

  const server = new McpServer({ name: "unorouter", version: "0.2.2" });

server.registerTool(
  "search_models",
  {
    title: "Search UnoRouter models",
    description:
      "Search the live UnoRouter model catalog (200+ models behind one OpenAI-compatible key). Models ending in :free cost nothing. Returns matching model IDs usable with the chat tool or any OpenAI-compatible client pointed at https://api.unorouter.com/v1.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe("Substring filter on the model id, e.g. 'deepseek' or 'claude'"),
      free_only: z.boolean().optional().describe("Only return :free models"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results, default 50"),
    },
  },
  async (args) => {
    let ids = await fetchModels();
    if (args.free_only) ids = ids.filter((id) => id.endsWith(":free"));
    if (args.query) {
      const q = args.query.toLowerCase();
      ids = ids.filter((id) => id.toLowerCase().includes(q));
    }
    ids = ids.slice(0, args.limit ?? 50);
    return { content: [{ type: "text", text: ids.join("\n") || "no models matched" }] };
  },
);

server.registerTool(
  "chat",
  {
    title: "Chat with a UnoRouter model",
    description:
      "Send a single prompt to any UnoRouter model and return the reply. Use search_models to find model IDs; :free models cost nothing (light per-model rate limit, rotate models if you hit 429).",
    inputSchema: {
      model: z.string().describe("Model id, e.g. deepseek-v4-flash:free"),
      prompt: z.string().describe("The user prompt"),
      system: z.string().optional().describe("Optional system prompt"),
      max_tokens: z.number().int().min(1).max(32768).optional(),
      temperature: z.number().min(0).max(2).optional(),
    },
  },
  async (args) => {
    const messages: { role: string; content: string }[] = [];
    if (args.system) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: args.prompt });
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: args.model,
        messages,
        max_tokens: args.max_tokens,
        temperature: args.temperature,
      }),
    });
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `request failed (${res.status}): ${await res.text()}` }],
        isError: true,
      };
    }
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    const usage = body.usage
      ? `\n\n[tokens: ${body.usage.prompt_tokens} in / ${body.usage.completion_tokens} out]`
      : "";
    return { content: [{ type: "text", text: text + usage }] };
  },
);

server.registerTool(
  "get_pricing",
  {
    title: "Get UnoRouter model pricing",
    description:
      "Look up per-token pricing for UnoRouter models from the public pricing endpoint. Prices are USD list prices per 1M tokens before per-group discounts (the account dashboard shows the exact effective rate). :free models are always 0.",
    inputSchema: {
      query: z.string().optional().describe("Substring filter on the model name"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results, default 25"),
    },
  },
  async (args) => {
    const res = await fetch(`${API_BASE}/api/pricing`);
    if (!res.ok) throw new Error(`GET /api/pricing failed: ${res.status}`);
    const body = (await res.json()) as { data: PricingModel[] };
    let models = body.data;
    if (args.query) {
      const q = args.query.toLowerCase();
      models = models.filter((m) => m.model_name.toLowerCase().includes(q));
    }
    // per-1M USD: ratio 1 = $2 per 1M input tokens (new-api convention)
    const lines = models.slice(0, args.limit ?? 25).map((m) => {
      if (m.model_name.endsWith(":free")) return `${m.model_name}: free`;
      if (m.quota_type === 1 && m.model_price != null)
        return `${m.model_name}: $${m.model_price} per call`;
      const input = (m.model_ratio ?? 0) * 2;
      const output = input * (m.completion_ratio ?? 1);
      return `${m.model_name}: $${input.toFixed(4)} in / $${output.toFixed(4)} out per 1M tokens`;
    });
    return { content: [{ type: "text", text: lines.join("\n") || "no models matched" }] };
  },
);

  return server;
}
