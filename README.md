# Minecraft Vision Agent

LLM agent for Minecraft with vision support. Architecture inspired by OpenClaw:
same pattern `intake → context → model → tools → repeat → persist`,
wrapped around a Minecraft bot.

## Structure

```
minecraft-agent/
├── index.js              # Entry: bot events, heartbeat, reconnect, shutdown
├── config.js             # Configuration (overridable via env)
├── SOUL.md               # Agent personality (editable without restart)
├── src/
│   ├── agent.js          # Agent loop
│   ├── llm.js            # LLM client: retries + fallback chain
│   ├── session.js        # Session: JSONL transcript, compaction, MEMORY.md
│   ├── queue.js          # Command queue (serialized runs)
│   ├── camera.js         # prismarine-viewer + puppeteer
│   ├── logger.js         # Structured logger with levels
│   └── tools/
│       ├── registry.js   # Tool registry
│       └── minecraft.js  # Tool implementations
└── data/
    ├── transcript.jsonl  # History (images redacted)
    └── MEMORY.md         # Long-term memory
```

## Patterns

| Pattern | Implementation |
|---|---|
| Command queue | `queue.js` — runs serialized, messages during "thinking" are batched |
| Files as state (SOUL.md, MEMORY.md) | Personality in `SOUL.md`, long-term memory in `data/MEMORY.md`, `remember` tool |
| Persistent sessions | JSONL transcript, tail restored after restart |
| Compaction | LLM summarization of old history instead of hard slicing |
| Heartbeat | Periodic pulse: agent looks around, speaks only if needed and players are nearby |
| Fallback chain + backoff | `llm.js`: retries with exponential backoff, fallback to next model |
| Tool registry | Tool = `{name, description, parameters, execute}`; add without modifying agent loop |
| Image redaction | base64 images not written to transcript/logs |
| Graceful shutdown | SIGINT/SIGTERM: close browser, quit bot, flush transcript |

## Tools

- `send_message` — chat (with rate-limit and truncation)
- `take_screenshot` — vision
- `look_at_player` — turn to face a player
- `get_surroundings` — text summary (position, hp, mobs, players)
- `remember` — long-term memory

## Running

```bash
npm install
# NixOS / nix-shell users: enter the dev shell first so all native
# libraries (libuuid, cairo, freetype, …) are on LD_LIBRARY_PATH:
nix-shell

# configure via env (or edit config.js):
MC_HOST=localhost MC_PORT=1488 MC_USERNAME=VisionAgent \
LLM_BASE_URL=http://localhost:1234/v1 \
LLM_MODEL=huihui-qwen3.5-9b-claude-4.6-opus-abliterated \
BROWSER_PATH=$(which firefox) \
npm start
```
