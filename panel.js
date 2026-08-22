'use strict';

/**
 * panel.js — Operator control plane (no LLM required).
 *
 * Runs the SAME bot stack as index.js: mineflayer bot + all 45 registered
 * tools + camera. Instead of the LLM agent loop, it exposes a local HTTP API
 * so an external operator can:
 *
 *   GET  /status          — live game state (pos, dim, HP, food, held, hostiles)
 *   GET  /tools           — tool names + schemas
 *   POST /tool            — { "name": "go_to", "args": {"x": 100, "z": 200} }
 *   GET  /logs?since=N    — log ring buffer tail
 *   POST /chat            — { "text": "hello" }  (rate-limited, same as agent)
 *   POST /inject          — { "text": "[SYSTEM]: ..." } → LLM-visible event
 *   GET  /health          — liveness probe
 *
 * Security: binds to 127.0.0.1 only. This is a debug/ops surface, not a product.
 */

const http = require('http');
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const pvp = require('mineflayer-pvp').plugin;
const toolPlugin = require('mineflayer-tool').plugin;
const collectBlockPlugin = require('mineflayer-collectblock').plugin;

const config = require('./config');
const { Logger } = require('./src/logger');
const { SessionManager } = require('./src/session');
const { ToolRegistry } = require('./src/tools/registry');
const { registerTools, makeChatSender } = require('./src/tools');
const { Camera } = require('./src/camera');
const { installHazardReflex } = require('./src/hazard_reflex');

const PANEL_PORT = parseInt(process.env.PANEL_PORT || '8787', 10);

const log = new Logger('panel', config.logging.level);
const session = new SessionManager(config, log.child('session'));
const registry = new ToolRegistry(log.child('tools'));
registerTools(registry, config);

let bot = null;
let sendChat = null;
const camera = new Camera(config, log.child('camera'));

function createBot() {
  log.info(`Connecting to ${config.bot.host}:${config.bot.port} as ${config.bot.username}...`);
  bot = mineflayer.createBot({
    host: config.bot.host,
    port: config.bot.port,
    username: config.bot.username,
  });
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(toolPlugin);
  bot.loadPlugin(collectBlockPlugin);

  sendChat = makeChatSender(bot, config, log.child('chat'));

  const toolContext = { bot, camera, session, sendChat, config, log: log.child('ctx') };

  bot.once('spawn', () => {
    log.info(`Bot spawned in ${bot.game?.dimension ?? 'unknown'}`);
    installHazardReflex(bot);
    camera.init(bot).catch((err) => log.error(`Camera failed: ${err.message}. Vision disabled.`));
  });

  bot.on('kicked', (reason) => log.warn(`Kicked: ${JSON.stringify(reason)}`));
  bot.on('error', (err) => log.error(`Bot error: ${err.message}`));
  bot.on('end', (reason) => {
    log.warn(`Disconnected (${reason ?? 'unknown'})`);
    // Panel mode: no auto-reconnect loop — the operator restarts the process.
  });
}

// ── HTTP API ────────────────────────────────────────────────────────────────

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

function statusSnapshot() {
  if (!bot || !bot.entity) return { connected: false };
  const pos = bot.entity.position;
  const hostiles = Object.values(bot.entities || {})
    .filter((e) => e.type === 'hostile' && e.position && pos.distanceTo(e.position) <= 16)
    .map((e) => ({ name: e.name ?? e.displayName ?? 'mob', dist: Math.round(pos.distanceTo(e.position)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);
  const players = Object.values(bot.players || {})
    .filter((p) => p.username !== bot.username && p.entity)
    .map((p) => ({ name: p.username, dist: Math.round(p.entity.position.distanceTo(pos)) }));
  const held = bot.heldItem;
  const effects = Object.entries(bot.entity.effects ?? {}).map(
    ([id, eff]) => `${id}(amp${eff.amplifier}, ${Math.max(0, Math.round((eff.end - Date.now()) / 1000))}s)`
  );
  return {
    connected: true,
    username: bot.username,
    dimension: bot.game?.dimension?.replace('minecraft:', '') ?? 'overworld',
    pos: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
    health: Math.round(bot.health * 10) / 10,
    food: Math.round(bot.food),
    onGround: bot.entity.onGround,
    isInLava: !!bot.entity.isInLava,
    isInWater: !!bot.entity.isInWater,
    held: held ? `${held.name} x${held.count}` : 'empty',
    inventorySlots: bot.inventory.items().length,
    effects,
    hostiles,
    players,
    defenseMode: !!bot._defenseMode?.active,
    registeredTools: registry.tools.size,
  };
}

let inflight = 0;
const MAX_INFLIGHT = 1;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PANEL_PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, connected: !!(bot && bot.entity) });
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      return json(res, 200, statusSnapshot());
    }

    if (req.method === 'GET' && url.pathname === '/tools') {
      return json(res, 200, registry.getSchemas());
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const since = parseInt(url.searchParams.get('since') ?? '0', 10);
      const all = Logger.ring;
      return json(res, 200, all.slice(Math.max(0, since)));
    }

    if (req.method === 'POST' && url.pathname === '/chat') {
      const body = await readBody(req);
      if (!sendChat) return json(res, 503, { error: 'bot not ready' });
      await sendChat(String(body.text ?? ''));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/inject') {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { error: 'text required' });
      session.push({ role: 'user', content: text });
      return json(res, 200, { ok: true, note: 'stored in session (visible to future LLM runs)' });
    }

    if (req.method === 'POST' && url.pathname === '/tool') {
      if (!bot || !bot.entity) return json(res, 503, { error: 'bot not spawned yet' });
      if (inflight >= MAX_INFLIGHT) return json(res, 429, { error: 'a tool call is already running' });
      const body = await readBody(req);
      const name = String(body.name ?? '');
      inflight++;
      try {
        const result = await registry.execute(name, JSON.stringify(body.args ?? {}), {
          bot, camera, session, sendChat, config, log: log.child('ctx'),
        });
        return json(res, result.ok ? 200 : 400, result);
      } finally {
        inflight--;
      }
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

createBot();
server.listen(PANEL_PORT, '127.0.0.1', () => {
  log.info(`Panel listening on http://127.0.0.1:${PANEL_PORT}`);
});

process.on('SIGINT', async () => {
  try { await camera.close(); } catch {}
  try { bot?.quit('panel shutdown'); } catch {}
  setTimeout(() => process.exit(0), 1500).unref();
});
