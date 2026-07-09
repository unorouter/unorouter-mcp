# unorouter-mcp

MCP server for [UnoRouter](https://unorouter.com), an open-source OpenAI-compatible gateway serving 200+ models (Claude, GPT, Gemini, DeepSeek, Kimi, GLM, Qwen and more) behind a single API key. Models with a `:free` suffix cost nothing.

Gives any MCP client (Claude Desktop, Claude Code, Cursor, Windsurf, and friends) three tools:

- `search_models`: filter the live catalog, optionally free models only
- `get_pricing`: USD per-1M-token list prices from the public pricing endpoint
- `chat`: send a prompt to any model and get the reply with token usage

## Setup

Create an API key at [unorouter.com/token](https://unorouter.com/token) (Discord or GitHub sign-in, no card required).

### Claude Desktop / any MCP client

```json
{
  "mcpServers": {
    "unorouter": {
      "command": "npx",
      "args": ["-y", "unorouter-mcp"],
      "env": {
        "UNOROUTER_API_KEY": "sk-your-key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add unorouter -e UNOROUTER_API_KEY=sk-your-key -- npx -y unorouter-mcp
```

## Environment

| Variable | Required | Default |
| --- | --- | --- |
| `UNOROUTER_API_KEY` | yes | none |
| `UNOROUTER_BASE_URL` | no | `https://api.unorouter.com` |

## Notes

- Free models run on shared pools with a light per-model rate limit (about 1 request per minute per model); rotate between free models or use paid ones for throughput.
- The whole UnoRouter stack is open source: [github.com/unorouter](https://github.com/unorouter).

## Development

```bash
bun install
bun run build
UNOROUTER_API_KEY=sk-... node dist/index.js
```
