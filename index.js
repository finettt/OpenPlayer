'use strict';

require('dotenv').config();
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const pvp = require('mineflayer-pvp').plugin;
const toolPlugin = require('mineflayer-tool').plugin;
const collectBlockPlugin = require('mineflayer-collectblock').plugin;

const config = require('./config');
const { Logger } = require('./src/logger');
const { LLMClient } = require('./src/llm');
const { SessionManager } = require('./src/session');
const { ToolRegistry } = require('./src/tools/registry');
const { registerTools, makeChatSender } = require('./src/tools');
const { enableDefence } = require('./src/tools/defence_mode');
const { Camera } = require('./src/camera');
const { CommandQueue } = require('./src/queue');
const { Agent } = require('./src/agent');

const log = new Logger('main', config.logging.level);

const llm = new LLMClient(config, log.child('llm'));
const session = new SessionManager(config, log.child('session'));
const registry = new ToolRegistry(log.child('tools'));
const camera = new Camera(config, log.child('camera'));
const queue = new CommandQueue(log.child('queue'));

registerTools(registry, config);

let bot = null;
let agent = null;
let heartbeatTimer = null;
let reconnectAttempts = 0;
let shuttingDown = false;

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

  const sendChat = makeChatSender(bot, config, log.child('chat'));

  agent = new Agent({
    config,
    logger: log.child('agent'),
    llm,
    session,
    registry,
    queue,
    toolContext: { bot, camera, session, sendChat, config },
  });

  bot.once('spawn', async () => {
    reconnectAttempts = 0;
    log.info('Bot joined the server!');
    try {
      await camera.init(bot);
    } catch (err) {
      log.error(`Camera failed to start: ${err.message}. Running without vision.`);
    }
    session.push({
      role: 'user',
      content: '[SYSTEM]: You have joined the server. Wait until someone talks to you.',
    });
    startHeartbeat();
    log.info('Bot ready and waiting for messages...');
  });

  bot.on('chat', (username, message, translate, jsonMsg, matches) => {
    // Only process actual player-typed chat messages.
    // System notifications (teleports, deaths, joins, etc.) use different
    // translate keys (e.g. "chat.type.announcement") and must be ignored.
    if (translate !== 'chat.type.text') {
      return;
    }

    if (!username || username === bot.username) return;

    log.info(`[Chat] ${username}: ${message}`);
    queue.push({
      type: 'chat',
      source: `chat username=${username}`,
      content: `[Chat] Player ${username} says: "${message}"`,
    });
  });

  bot.on('whisper', (username, message) => {
    if (username === bot.username || !username) return;
    log.info(`[Whisper] ${username}: ${message}`);
    queue.push({
      type: 'chat',
      source: `whisper username=${username}`,
      content: `[Private message] Player ${username} whispers: "${message}"`,
    });
  });

  bot.on('health', () => {
    if (bot.health > 0 && bot.health <= 6) {
      queue.push({
        type: 'event',
        source: 'health',
        content: `[SYSTEM]: WARNING! Your health is critically low: ${bot.health}/20.`,
      });
    }
  });

  bot.on('entityHurt', (entity) => {
    // Only care if the bot itself is hurt
    if (entity !== bot.entity) return;

    // Find nearest hostile to report who is likely attacking
    const pos = bot.entity.position;
    let attacker = null;
    let attackerDist = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (e.type !== 'hostile' || !e.position || e === bot.entity) continue;
      const d = e.position.distanceTo(pos);
      if (d < attackerDist) {
        attackerDist = d;
        attacker = e;
      }
    }

    // Auto-enable defence mode if not already active — reacts instantly
    // without waiting for the LLM to decide. The agent can disable later
    // with defence_mode(enabled=false).
    if (bot.pvp && !bot._defenceMode?.active) {
      try {
        enableDefence(bot);
        log.info('Defence mode auto-enabled due to damage');
      } catch (err) {
        log.error(`Auto-defence enable failed: ${err.message}`);
      }
    }

    // Notify the agent so it's aware of the situation
    const attackerName = attacker
      ? `${attacker.name || attacker.displayName || 'unknown'} (${Math.round(attackerDist)}m away)`
      : 'unknown source';
    queue.push({
      type: 'event',
      source: 'damage',
      content: `[SYSTEM]: You took damage from ${attackerName}! Health: ${bot.health}/20. Defence mode has been auto-enabled. Use defence_mode(enabled=false) to stop fighting.`,
    });
  });

  bot.on('kicked', (reason) => log.warn(`Kicked: ${JSON.stringify(reason)}`));
  bot.on('error', (err) => log.error(`Bot error: ${err.message}`));

  bot.on('end', async (reason) => {
    log.warn(`Disconnected from server (${reason ?? 'unknown'})`);
    stopHeartbeat();
    await camera.close();
    if (shuttingDown || !config.bot.reconnect.enabled) return;

    reconnectAttempts++;
    const delay = Math.min(
      config.bot.reconnect.baseDelayMs * 2 ** (reconnectAttempts - 1),
      config.bot.reconnect.maxDelayMs
    );
    log.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
    setTimeout(createBot, delay);
  });
}

function startHeartbeat() {
  if (!config.agent.heartbeat.enabled) return;
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!bot?.entity) return;

    if (config.agent.heartbeat.onlyIfPlayersNearby) {
      const nearby = Object.values(bot.players).some(
        (p) =>
          p.username !== bot.username &&
          p.entity &&
          p.entity.position.distanceTo(bot.entity.position) <=
            config.agent.heartbeat.nearbyRadius
      );
      if (!nearby) {
        log.debug('Heartbeat: no players nearby, skipping');
        return;
      }
    }

    queue.push({
      type: 'heartbeat',
      source: 'heartbeat',
      content:
        '[SYSTEM HEARTBEAT]: Periodic check. Look around (get_surroundings or take_screenshot). ' +
        'If something interesting or dangerous is happening — tell players via send_message. ' +
        'If everything is calm — do NOT write to chat, just do nothing.',
    });
  }, config.agent.heartbeat.intervalMs);
  log.info(`Heartbeat started (every ${config.agent.heartbeat.intervalMs / 60000} min)`);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}, shutting down...`);
  stopHeartbeat();
  try {
    await camera.close();
  } catch { /* ignore */ }
  try {
    bot?.quit('Agent shutting down');
  } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log.error(`Uncaught error: ${err.stack ?? err.message}`);
});
process.on('unhandledRejection', (reason) => {
  log.error(`Unhandled rejection: ${reason}`);
});

createBot();
