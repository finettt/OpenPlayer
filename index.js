'use strict';

require('dotenv').config({ override: true });
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
const { enableDefense, disableDefense, markRecentAttacker } = require('./src/tools/defense_mode');

// Maximum distance (blocks) at which a hostile is considered a plausible
// attacker for auto-defense. Beyond this, damage is assumed to be
// environmental (fall, fire, drown, suffocation, cactus, etc.) and the
// defense loop is NOT auto-enabled.
const PLAUSIBLE_ATTACKER_RANGE = 6;

// Damage event aggregation. The Minecraft server can fire `entityHurt` many
// times per second — and if the LLM is mid-reasoning, each event becomes a
// separate message in its next context window. That blows up context fast
// (we saw 14 near-identical damage messages in one run).
//
// Strategy: instead of pushing one queue event per hit, we maintain a single
// rolling "combat report" entry. If a damage event arrives while the LLM is
// busy, OR while an unread damage event is already in the pending queue, we
// MERGE into that entry instead of appending a new one. The merged entry
// records min HP seen, total hits, and per-mob-type tallies — so the LLM
// gets one rich summary instead of 14 redundant lines.
const HEALTH_DROP_THRESHOLD = 2;              // Re-notify if HP fell ≥N since last notify
const _damage = {
  prevHealth: 20,
  pendingEventRef: null,                      // Reference to the queue event we're merging into
  windowStart: 0,                             // Epoch ms when this aggregation window started
  hits: 0,
  byMob: new Map(),                           // mob name → hit count
  minHp: 20,
  maxHp: 20,
  lastNotifyHp: 20,
  lastAttacker: null,                         // { name, dist }
  envHits: 0,                                 // Count of environmental hits in window
};

/** Reset the aggregation window when the queue handler consumes the event. */
function resetDamageWindow() {
  _damage.pendingEventRef = null;
  _damage.windowStart = 0;
  _damage.hits = 0;
  _damage.byMob.clear();
  _damage.envHits = 0;
  _damage.minHp = bot?.health ?? 20;
  _damage.maxHp = bot?.health ?? 20;
  _damage.lastNotifyHp = bot?.health ?? 20;
  _damage.lastAttacker = null;
}

/** Build the human-readable summary of the current aggregation window. */
function renderDamageSummary() {
  const parts = [];
  const defenseActive = !!bot?._defenseMode?.active;

  if (_damage.envHits > 0 && _damage.hits === 0) {
    // Pure environmental window
    parts.push(`[SYSTEM]: Environmental damage ×${_damage.envHits}.`);
    parts.push(`HP ${_damage.minHp.toFixed(1)}/20 (was ${_damage.maxHp.toFixed(1)}).`);
    parts.push('Likely cause: fire, lava, drowning, fall, cactus, suffocation, or starvation. Defense_mode cannot help — move away from the hazard.');
    return parts.join(' ');
  }
  const mobTallies = [..._damage.byMob.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => c > 1 ? `${n}×${c}` : n)
    .join(', ');
  const hitsTotal = _damage.hits + _damage.envHits;
  const winSec = ((Date.now() - _damage.windowStart) / 1000).toFixed(1);
  parts.push(`[SYSTEM]: Combat: ${hitsTotal} hits in ${winSec}s from {${mobTallies || 'unknown'}}.`);
  parts.push(`HP ${_damage.minHp.toFixed(1)}/20 (was ${_damage.maxHp.toFixed(1)}).`);

  // Nearby threat snapshot — helps the LLM decide flee vs fight vs eat
  let nearbyCount = 0;
  if (bot && bot.entity) {
    const here = bot.entity.position;
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity || !e.position) continue;
      if (e.type !== 'hostile') continue;
      const d = e.position.distanceTo(here);
      if (d > 12) continue;
      nearbyCount++;
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    if (nearbyCount > 0 && nearest) {
      const nName = nearest.name || nearest.displayName || 'unknown';
      parts.push(`${nearbyCount} hostile${nearbyCount > 1 ? 's' : ''} within 12m, closest: ${nName} (${Math.round(nearestDist)}m).`);
    } else {
      parts.push('No hostiles in 12m now — combat may be over.');
    }
  }

  // The critical bit: tell the LLM what is being handled automatically and
  // what (if anything) it actually needs to do. Use a 2D matrix on (HP × swarm
  // size) to avoid both extremes:
  //   - "do nothing" when the bot is actively dying to a horde
  //   - "panic and call 5 tools" in a routine 1-zombie fight
  // The autopilot handles solo fights well; humans (or LLM) need to step in
  // for outnumbered or low-HP situations.
  const SWARM = 5;                      // ≥N enemies = autopilot can't keep up
  const HP_LOW = 14;
  const HP_CRIT = 6;
  const mode = bot?._defenseMode?.mode;  // SOLO | SWARM_PILLAR | SWARM_KITE | RETREAT
  const defenseInRetreat = mode === 'RETREAT' || bot?._defenseMode?.retreating;

  if (!defenseActive) {
    parts.push('Defense_mode is OFF. Call defense_mode(enabled=true) so the bot fights back automatically.');
  } else if (nearbyCount === 0) {
    parts.push('Defense_mode is ON but no nearby threats — it will idle. You can ignore this alert.');
  } else if (_damage.minHp <= HP_CRIT) {
    // Critical HP — defense cannot save us by itself
    parts.push(
      `CRITICAL: HP ${_damage.minHp.toFixed(1)}/20 and still under attack. ` +
      'ACT NOW: (1) consume golden_apple or enchanted_golden_apple if you have one, ' +
      '(2) go_to to a wall/water 30+ blocks away, ' +
      '(3) pillar up with place_block(dirt/cobble) under your feet. ' +
      'Defense_mode alone WILL NOT save you here.'
    );
  } else if (nearbyCount >= SWARM && _damage.minHp <= HP_LOW) {
    // Outnumbered AND being hurt — urgent help required
    parts.push(
      `URGENT: outnumbered (${nearbyCount} hostiles) and taking damage (HP ${_damage.minHp.toFixed(1)}). ` +
      'Defense_mode is overwhelmed. ACT: pillar up with place_block under feet, ' +
      'or flee via go_to to safe terrain 30+ blocks away. ' +
      'Defense_mode will keep attacking, you focus on positioning.'
    );
  } else if (nearbyCount >= SWARM) {
    // Outnumbered but still healthy — proactive but not panic
    parts.push(
      `Defense_mode is handling but outnumbered (${nearbyCount} hostiles). ` +
      'Consider helping: pillar up with place_block, retreat via go_to, or find chokepoint. ' +
      'Do NOT call attack_entity / defense_mode (they fight the autopilot).'
    );
  } else if (defenseInRetreat) {
    // Defense itself signalled retreat — listen
    parts.push(
      `Defense_mode is RETREATING (it judged the fight unwinnable). ` +
      'Help by: place_block to pillar/wall off, or go_to to a known safe spot. ' +
      'Eating beats fighting right now.'
    );
  } else {
    parts.push('Defense_mode is handling combat (auto-attacks, auto-equips weapon/shield, auto-eats when safe). Do NOT call attack_entity, consume, hold_item or defense_mode — they will fight the autopilot.');
  }

  if (_damage.envHits > 0) {
    parts.push(`(${_damage.envHits} environmental hit${_damage.envHits > 1 ? 's' : ''} included.)`);
  }
  return parts.join(' ');
}

/**
 * Push or merge a damage event. If there's already an unread damage entry in
 * the queue's pending list, we mutate its `content` in-place instead of
 * adding a new entry.
 */
function pushDamageEvent({ attacker, attackerDist, environmental }) {
  const hp = bot.health;
  // Open a new window if there's no in-flight aggregated event
  if (!_damage.pendingEventRef) {
    _damage.windowStart = Date.now();
    _damage.minHp = hp;
    _damage.maxHp = hp;
    _damage.lastNotifyHp = hp;
    _damage.byMob.clear();
    _damage.hits = 0;
    _damage.envHits = 0;
  }
  // Update stats
  if (environmental) {
    _damage.envHits++;
  } else {
    _damage.hits++;
    const name = attacker?.name || attacker?.displayName || 'unknown';
    _damage.byMob.set(name, (_damage.byMob.get(name) || 0) + 1);
    _damage.lastAttacker = { name, dist: attackerDist };
  }
  if (hp < _damage.minHp) _damage.minHp = hp;
  if (hp > _damage.maxHp) _damage.maxHp = hp;

  if (_damage.pendingEventRef) {
    // Merge into existing pending event
    _damage.pendingEventRef.content = renderDamageSummary();
    return;
  }
  // Otherwise create a new event and remember the ref so future damage merges in.
  const event = {
    type: 'event',
    source: 'damage',
    content: renderDamageSummary(),
    // Hook called by the queue when this event is consumed by the handler:
    _onConsume: () => { resetDamageWindow(); },
  };
  _damage.pendingEventRef = event;
  queue.push(event);
}
const { Camera } = require('./src/camera');
const { CommandQueue } = require('./src/queue');
const { Agent } = require('./src/agent');

const log = new Logger('main', config.logging.level);

const llm = new LLMClient(config, log.child('llm'));
const session = new SessionManager(config, log.child('session'));
const registry = new ToolRegistry(log.child('tools'));
const camera = new Camera(config, log.child('camera'));
const queue = new CommandQueue({ config, logger: log.child('queue') });

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

    // If the bot spawns in the Nether, enable defense mode immediately
    const spawnDim = bot.game?.dimension ?? '';
    if ((spawnDim.includes('nether') || spawnDim === 'minecraft:the_nether') &&
        bot.pvp && !bot._defenseMode?.active) {
      try {
        enableDefense(bot);
        log.info('Defense mode auto-enabled — initial spawn in Nether');
      } catch (err) {
        log.error(`Auto-defense enable (Nether spawn) failed: ${err.message}`);
      }
    }

    try {
      await camera.init(bot);
    } catch (err) {
      log.error(`Camera failed to start: ${err.message}. Running without vision.`);
    }
    session.push({
      role: 'user',
      content:
        '[SYSTEM]: You have joined the server. Idle until a player talks to you, ' +
        'BUT always act to preserve your own life and recover from emergencies: ' +
        'fight or flee from hostiles, eat when hungry, pillar up if swarmed, ' +
        'and after death — recover items if safe, then re-establish a safe base. ' +
        'Survival overrides "wait for chat".',
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

  // NOTE: No separate `health` event listener — HP is reported inside the
  // aggregated damage summary. A dedicated low-HP warning would just duplicate
  // information the agent already has and cost extra context tokens.

  bot.on('entityHurt', (entity) => {
    // Only care if the bot itself is hurt
    if (entity !== bot.entity) return;

    // Identify a plausible attacker. We look for any entity within
    // melee/short-range whose swing or aim could explain the hit:
    //   - Hostile mobs within PLAUSIBLE_ATTACKER_RANGE
    //   - Players within PLAUSIBLE_ATTACKER_RANGE (could be PvP)
    //   - Skeletons / blazes / ghasts within 24 blocks (ranged attackers)
    //
    // Anything else is treated as environmental damage (fall, fire, drown,
    // cactus, suffocation, starvation) and does NOT trigger auto-defense.
    const RANGED_ATTACKER_NAMES = new Set([
      'skeleton', 'stray', 'wither_skeleton',
      'blaze', 'ghast', 'pillager', 'piglin',
    ]);
    const pos = bot.entity.position;
    let attacker = null;
    let attackerDist = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (!e.position || e === bot.entity) continue;
      const d = e.position.distanceTo(pos);

      const isMelee =
        (e.type === 'hostile' || e.type === 'player') &&
        d <= PLAUSIBLE_ATTACKER_RANGE;
      const isRanged =
        RANGED_ATTACKER_NAMES.has(e.name) && d <= 24;
      if (!isMelee && !isRanged) continue;

      if (d < attackerDist) {
        attackerDist = d;
        attacker = e;
      }
    }

    // Environmental damage path — aggregate without enabling defense.
    if (!attacker) {
      pushDamageEvent({ environmental: true });
      return;
    }

    // Remember this attacker so the defense loop will engage it even if its
    // entity.type isn't `'hostile'` (angered wolves, iron golems, zombified
    // piglins, players in PvP, etc.).
    markRecentAttacker(bot, attacker);

    // Auto-enable defense mode if not already active.
    if (bot.pvp && !bot._defenseMode?.active) {
      try {
        enableDefense(bot);
        log.info('Defense mode auto-enabled due to damage');
      } catch (err) {
        log.error(`Auto-defense enable failed: ${err.message}`);
      }
    }

    pushDamageEvent({ attacker, attackerDist, environmental: false });
  });

  // Death and respawn — without these the LLM hallucinates "I survived" after
  // its HP went to 0 and it respawned somewhere else with full bars. We push
  // an explicit, high-signal message so the model knows the run reset.
  // Auto-enable defense mode in the Nether — it's inherently dangerous there
  // (ghasts, blazes, wither skeletons, piglins). Trigger on game state changes
  // which fire when the bot's dimension changes (portal travel, respawn).
  bot.on('game', () => {
    const dim = bot.game?.dimension ?? '';
    if (dim.includes('nether') || dim === 'minecraft:the_nether') {
      if (bot.pvp && !bot._defenseMode?.active) {
        try {
          enableDefense(bot);
          log.info('Defense mode auto-enabled — bot entered the Nether');
        } catch (err) {
          log.error(`Auto-defense enable (Nether) failed: ${err.message}`);
        }
      }
    }
  });

  bot.on('death', () => {
    // Capture death context BEFORE the respawn wipes positional state.
    const deathPos = bot.entity ? bot.entity.position.clone() : null;
    const deathDim = bot.game?.dimension || 'unknown';
    const deathTime = bot.time?.timeOfDay ?? null;
    // Last attacker / damage context comes from the aggregator
    const cause = _damage.lastAttacker
      ? `killed by ${_damage.lastAttacker.name}`
      : (_damage.envHits > 0 && _damage.hits === 0
        ? 'killed by environmental damage (fire/lava/drown/fall/cactus/suffocation)'
        : 'cause of death unknown');
    const lastAttackers = [..._damage.byMob.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => c > 1 ? `${n}×${c}` : n)
      .join(', ') || (_damage.envHits > 0 ? 'environment' : 'unknown');

    // Remember for the respawn message
    bot._lastDeath = {
      at: Date.now(),
      pos: deathPos,
      dimension: deathDim,
      timeOfDay: deathTime,
      cause,
      attackers: lastAttackers,
      inventoryWasNonEmpty: bot.inventory?.items()?.length > 0,
    };
    bot._deathCount = (bot._deathCount || 0) + 1;

    // Defense mode is meaningless after death — disable so we don't try to
    // resume attacking a phantom target post-respawn.
    try { disableDefense(bot); } catch { /* ignore */ }

    // Reset damage aggregation — old HP / hit counts are stale now.
    resetDamageWindow();

    // Push an unambiguous death notification. Use a fresh event (not the
    // aggregator) so it can't get merged into a stale combat summary.
    const posStr = deathPos
      ? `(${Math.round(deathPos.x)}, ${Math.round(deathPos.y)}, ${Math.round(deathPos.z)})`
      : 'unknown location';
    queue.push({
      type: 'event',
      source: 'death',
      content:
        `[SYSTEM]: YOU DIED. Cause: ${cause}. Recent damage: {${lastAttackers}}. ` +
        `Death location: ${posStr} in ${deathDim}. ` +
        `Death count this session: ${bot._deathCount}. ` +
        `You will respawn shortly. Inventory may be dropped at the death location ` +
        `(unless server has /keepInventory). Defense_mode has been disabled. ` +
        `When you respawn you will be at full HP/food in a new location — ` +
        `do NOT claim you "survived" or "escaped"; you actually died. ` +
        `Treat respawn as a hard reset: re-orient (get_surroundings), ` +
        `recover items if you can reach the death point safely (else abandon them), ` +
        `then re-establish basic survival (food, tools, shelter) BEFORE returning to that area.`,
    });
  });

  bot.on('respawn', () => {
    const last = bot._lastDeath;
    if (!last) {
      // Initial spawn or reconnection — not a death respawn
      return;
    }
    const newPos = bot.entity ? bot.entity.position : null;
    const newPosStr = newPos
      ? `(${Math.round(newPos.x)}, ${Math.round(newPos.y)}, ${Math.round(newPos.z)})`
      : 'unknown';
    const oldPosStr = last.pos
      ? `(${Math.round(last.pos.x)}, ${Math.round(last.pos.y)}, ${Math.round(last.pos.z)})`
      : 'unknown';
    // Compute drift between death and respawn
    let driftNote = '';
    if (newPos && last.pos && last.dimension === (bot.game?.dimension || 'unknown')) {
      const dx = newPos.x - last.pos.x;
      const dz = newPos.z - last.pos.z;
      const drift = Math.hypot(dx, dz);
      driftNote = drift > 4
        ? ` Respawn is ${Math.round(drift)}m from death point.`
        : ' Respawn is near the death point.';
    } else {
      driftNote = ' Dimension/world may have changed.';
    }
    const itemsHint = last.inventoryWasNonEmpty
      ? ` Items may still be at ${oldPosStr} (despawn in ~5 minutes) — consider recovering them if safe.`
      : '';

    queue.push({
      type: 'event',
      source: 'respawn',
      content:
        `[SYSTEM]: Respawned at ${newPosStr} after dying to ${last.attackers}.` +
        driftNote +
        itemsHint +
        ' HP/food are reset. Plan accordingly — your previous goals may need re-evaluating.',
    });

    // Clear the death record so subsequent respawn events (e.g. reconnects)
    // don't double-fire.
    bot._lastDeath = null;
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
