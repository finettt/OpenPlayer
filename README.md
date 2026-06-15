# Minebot

Minecraft bot powered by LLM with vision support. Join any server, chat with players, explore, craft, fight, and manage tasks — all autonomously.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Architecture

```
intake → context → model → tools → repeat → persist
```

Inspired by OpenClaw. Same loop pattern, wrapped around a Minecraft bot.

## Structure

```
minebot/
├── index.js              # Entry: bot events, heartbeat, reconnect, shutdown
├── config.js             # Configuration (overridable via .env)
├── .env.example          # Environment template
├── SOUL.md               # Agent personality (editable without restart)
├── TOOLS.md              # Tool reference (shown to LLM)
├── wiki.md               # Game knowledge reference (shown to LLM)
├── src/
│   ├── agent.js          # Agent loop
│   ├── llm.js            # LLM client: retries + fallback chain
│   ├── session.js        # Session: JSONL transcript, MEMORY.md
│   ├── queue.js          # Command queue (serialized runs)
│   ├── camera.js         # prismarine-viewer + puppeteer
│   ├── logger.js         # Structured logger with levels
│   └── tools/
│       ├── registry.js   # Tool registry
│       └── *.js          # 40+ tool implementations
└── data/
    ├── transcript.jsonl  # History (images redacted)
    └── MEMORY.md         # Long-term memory
```

## Features

| Feature | Details |
|---|---|
| Vision | Screenshots via prismarine-viewer + headless Firefox |
| Chat | Rate-limited chat, whispers, auto-response |
| Movement | Pathfinding, go-to coords, follow players |
| Combat | Auto-defence, attack entities, PVP |
| Crafting | 3×3 recipes, smelting, workbench auto-creation |
| Inventory | Equip, hold, drop, consume food/potions |
| Storage | Open chests, deposit/withdraw items |
| Memory | Persistent MEMORY.md + JSONL transcript |
| Tasks | Persistent todo list for multi-step goals |
| Reconnect | Auto-reconnect with exponential backoff |
| Heartbeat | Periodic awareness pulse when players nearby |

## Quick Start

```bash
# 1. Install
git clone https://github.com/finettt/OpenPlayer.git
cd OpenPlayer
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your LLM and server details

# 3. Run
npm start
```

### NixOS

```bash
nix-shell   # loads native libs (cairo, freetype, etc.)
npm start
```

## Configuration

Copy `.env.example` to `.env` and fill in your values. All settings fall back to `config.js` defaults if not set.

| Variable | Default | Description |
|---|---|---|
| `LLM_BASE_URL` | `http://localhost:8080/v1` | OpenAI-compatible API endpoint |
| `LLM_API_KEY` | `sk-null` | API key (use `sk-null` for local LLMs) |
| `LLM_MODEL` | `qwen3-8b` | Model name |
| `MC_HOST` | `localhost` | Minecraft server address |
| `MC_PORT` | `25565` | Minecraft server port |
| `MC_USERNAME` | `Agent` | Bot username |
| `BROWSER_PATH` | `firefox` | Path to Firefox binary (for vision) |
| `HEARTBEAT` | `true` | Enable periodic awareness pulse |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

## Tools

40+ built-in tools. Full reference: [TOOLS.md](TOOLS.md)

**Communication:** `send_message`, `remember`
**Vision:** `take_screenshot`, `look_at_player`, `get_surroundings`, `scan_area`
**Movement:** `go_to`, `go_to_y`, `approach`, `find_block`, `move`, `jump`
**Players:** `goto_player`, `follow_player`, `lock_view`
**Combat:** `attack_entity`, `defence_mode`
**Crafting:** `create_workbench`, `craft`, `smelt`, `get_recipe`
**Blocks:** `break_block`, `mine_block_type`, `place_block`, `interact`
**Items:** `collect_drops`, `hold_item`, `equip`, `consume`, `drop_item`
**Inventory:** `get_inventory`, `get_health_status`, `get_active_effects`
**Storage:** `open_chest`, `deposit_item`, `withdraw_item`
**Tasks:** `todo`
**Flow:** `end_loop`, `list_tools`

## Personality

Edit `SOUL.md` to change bot behavior. Changes apply immediately — no restart needed.

## License

MIT
