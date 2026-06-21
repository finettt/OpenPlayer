'use strict';

/**
 * defense_mode tool — Toggle automatic self-defense against hostile mobs.
 *
 * When ON, runs a tick loop that:
 *   - Scans for threats (hostile mobs OR recently-aggro'd entities) in range
 *   - Picks a strategy based on situation:
 *       * SOLO       — 1-2 threats: classic pvp-plugin chase + hit
 *       * SWARM_PILLAR — ≥3 threats + dirt/cobble in inventory: pillar up 2 blocks
 *                       and pelt them from above (zombies can't path up 2 jumps
 *                       without a block-up themselves)
 *       * SWARM_KITE — ≥3 threats but no pillar blocks: hit-and-run, pick the
 *                      *closest* threat every tick instead of locking on
 *       * RETREAT    — HP ≤ RETREAT_HP_THRESHOLD: pause attacks, pathfind away
 *                      from the centroid of threats until HP recovers to
 *                      RESUME_HP_THRESHOLD
 *   - Eats food mid-combat if `bot.food <= EAT_HUNGER_THRESHOLD` and there's
 *     a safe gap (no melee threat within 2 blocks during the 1.6s eat)
 *   - Auto-equip best weapon on enable AND every tick: scores swords/axes by
 *     base damage + tier + enchantments (Sharpness, Smite vs undead, Bane vs
 *     arthropods), and re-equips when a better option exists for the current
 *     target. Avoids weapons about to break (<20 durability left).
 *   - Equips shield in off-hand on enable if available
 *   - Crit manager: jumps before swings when target is in reach and on-ground,
 *     so the pvp-plugin's swing lands while we're falling → +50% damage
 *   - Shield manager: raises off-hand shield when archers (≤16m) or melee
 *     mobs (≤4m) are around; briefly lowers it before each swing so attacks
 *     register; always down while kiting/retreating (shield blocks sprint)
 *   - Creeper defense: detects hissing creepers, backpedals and places blocks
 *   - Fireball defense: tracks fireball trajectories, raises shield or dodges
 *   - Combat strafing: circle-strafes left/right during SOLO combat
 *
 * State is stored on the bot instance: bot._defenseMode
 */

const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// Debug toggle — set true to trace projectile detection/dodge decisions
const VERBOSE = true;

const DEBUG = (bot, msg) => {
  if (!VERBOSE) return;
  console.log(`${new Date().toISOString()} [INFO] [main:defence] ${msg}`);
};

// --- Tuning -----------------------------------------------------------------

const SCAN_INTERVAL_MS = 250;           // Tighter loop for crowd reactions
const DEFENSE_RANGE = 16;               // Blocks — engage threats within
const VIEW_DISTANCE = 24;               // Lose interest beyond
const RECENT_ATTACKER_TTL_MS = 10_000;  // How long aggro'd neutrals stay flagged

const SWARM_THRESHOLD = 3;              // ≥N threats within SWARM_RADIUS → swarm mode
const SWARM_RADIUS = 8;

// ===== Creeper Defense Tuning =====
const CREEPER_SCAN_RADIUS = 12;          // Scan for creepers within this range
const CREEPER_FUSE_WARN_TICKS = 25;      // ~1.25s before explosion → start escaping
const CREEPER_ESCAPE_DISTANCE = 7;       // Backpedal this many blocks when hissing
const CREEPER_BLOCK_PLACE_DISTANCE = 3;  // Place block between bot and creeper if ≤this

// ===== Fireball Defense Tuning =====
const FIREBALL_SCAN_RADIUS = 20;         // Detect fireballs within this range
const FIREBALL_PREDICT_TIME_MS = 800;    // How far ahead to predict fireball trajectory
const FIREBALL_SHIELD_RADIUS = 8;        // Raise shield if fireball aimed within this dist of bot
const FIREBALL_DODGE_LATERAL = 3;        // Strafe perpendicular this many blocks to dodge
const FIREBALL_DODGE_COOLDOWN_MS = 500;  // Min time between dodge attempts
const FIREBALL_ESCAPE_DISTANCE = 5;      // Run if fireball very close
const FIREBALL_TRACK_MAX_AGE_MS = 3000;  // Forget fireball after this long without update
const FIREBALL_MIN_SPEED = 0.008;        // Minimum velocity (blocks/tick) — filters static entities

const FIREBALL_ENTITY_NAMES = new Set([
  'fireball',
  'small_fireball',
  'dragon_fireball',
  'wither_skull',
]);

// ===== Arrow Defense Tuning =====
const ARROW_SCAN_RADIUS = 20;           // Detect arrows within this range
const ARROW_PREDICT_TIME_MS = 300;      // Arrows fly faster than fireballs — shorter lookahead
const ARROW_DODGE_LATERAL = 2;           // Strafe perpendicular this many blocks to dodge
const ARROW_DODGE_COOLDOWN_MS = 300;    // Min time between arrow dodge attempts
const ARROW_ESCAPE_DISTANCE = 8;        // Dodge if arrow within this range (generous — fast arrows cover ~15 blocks per 250ms scan tick)
const ARROW_TRACK_MAX_AGE_MS = 2000;    // Forget arrow after this long without update
const ARROW_MIN_SPEED = 0.5;            // Minimum velocity (blocks/tick) — arrows are fast, ~1-3 bt

const ARROW_ENTITY_NAMES = new Set([
  'arrow',
  'spectral_arrow',
]);

// ===== Combat Strafing Tuning =====
const STRAFE_ENABLED = true;             // Enable circle-strafing in SOLO mode
const STRAFE_CHANGE_INTERVAL_MS = 600;   // Switch strafe direction every N ms

// Blocks safe to use for pillaring (stable, not falling, won't burn). Order
// matters — earlier entries are preferred (cheap / abundant first).
const PILLAR_BLOCKS = [
  'dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'mud', 'dirt_path',
  'cobblestone', 'cobbled_deepslate', 'stone', 'deepslate', 'tuff',
  'andesite', 'granite', 'diorite', 'calcite', 'dripstone_block',
  'mossy_cobblestone', 'blackstone', 'basalt', 'smooth_basalt', 'netherrack',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'crimson_planks', 'warped_planks', 'bamboo_planks',
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log',
  'dark_oak_log', 'mangrove_log', 'cherry_log',
];
const PILLAR_HEIGHT = 2;                // 2 blocks puts us out of zombie reach
const PILLAR_STEP_TIMEOUT_MS = 1500;    // Max time for a single up-step
const PILLAR_COOLDOWN_MS = 5_000;       // Don't retry pillar this soon after a failure

const RETREAT_HP_THRESHOLD = 8;         // ≤8 HP → break off and run
const RESUME_HP_THRESHOLD = 14;         // ≥14 HP → re-engage
const RETREAT_DISTANCE = 24;            // Path that far from threat centroid

const EAT_HUNGER_THRESHOLD = 17;        // <=17/20 food → try to eat in combat
const EAT_SAFE_GAP_BLOCKS = 4;          // No melee threat within this radius to eat
const EAT_COOLDOWN_MS = 8_000;          // Min time between eat attempts

const KITE_RETREAT_BLOCKS = 3;          // Distance to step back when kiting
const TARGET_SWITCH_RATIO = 0.8;        // Switch if new target is < 0.8 × current dist

// --- Crit / shield tuning ---------------------------------------------------

const CRIT_REACH = 3.5;                 // Only crit-jump when target is within reach
const CRIT_COOLDOWN_TICKS = 12;         // Min ticks between crit-jumps (~600ms)
                                        // — sword cooldown is ~12.5 ticks at 1.6 atk speed
const SHIELD_RANGED_RADIUS = 16;        // Raise shield if archer within this range
const SHIELD_MELEE_RADIUS = 4;          // Raise shield if melee threat within this range
const SHIELD_LOWER_MS = 80;             // Lower shield this long before a swing (attack registers in ~50ms)
const RANGED_ATTACKER_NAMES = new Set([
  'skeleton', 'stray', 'wither_skeleton',
  'pillager', 'piglin',
]);
// blaze/ghast use fireballs — shield helps but they also burn from below
// players can be ranged too but we can't know without arrow tracking

// ===== Shield Durability Tuning =====
const SHIELD_LOW_DURABILITY = 60;       // Below this remaining durability → conserve shield
const SHIELD_CRITICAL_DURABILITY = 20;  // Below this → treat as about to break, swap if possible

// ===== Emergency Items Tuning =====
const TOTEM_HP_THRESHOLD = 4;           // ≤4 HP → equip totem of undying in off-hand
const GOLDEN_APPLE_HP_THRESHOLD = 8;    // ≤8 HP → eat golden apple for absorption + regen

// --- Recent attacker tracking -----------------------------------------------

function getRecentAttackers(bot) {
  if (!bot._recentAttackers) bot._recentAttackers = new Map();
  return bot._recentAttackers;
}

function markRecentAttacker(bot, entity) {
  if (!entity || entity === bot.entity) return;
  getRecentAttackers(bot).set(entity.id, Date.now() + RECENT_ATTACKER_TTL_MS);
}

function pruneRecentAttackers(bot) {
  const map = getRecentAttackers(bot);
  const now = Date.now();
  for (const [id, expires] of map) {
    if (expires <= now) map.delete(id);
  }
}

// ===== Creeper tracking =====

function getCreeperState(bot) {
  if (!bot._creeperState) bot._creeperState = { hissingSince: 0, lastCreeperId: null };
  return bot._creeperState;
}

/**
 * Check if any nearby creeper is in fuse/hissing state.
 * In MC, creepers hiss when about to explode — they become dangerous.
 * We detect this via the entity metadata or by checking for 'splash' particles.
 */
function detectHissingCreeper(bot) {
  const pos = bot.entity.position;
  const state = getCreeperState(bot);

  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity || !entity.position) continue;
    if (entity.name !== 'creeper') continue;

    const dist = entity.position.distanceTo(pos);
    if (dist > CREEPER_SCAN_RADIUS) continue;

    // Check creeper state via metadata
    // mineflayer exposes entity.state or entity.data for creeper fuse state
    // A creeper in fuse state has Fuse > 0 (ticks until explode)
    const fuse = entity.fuse ?? entity.state?.fuse ?? entity.metadata?.fuse ?? -1;

    if (fuse > 0 && fuse <= CREEPER_FUSE_WARN_TICKS) {
      // Creeper is about to explode!
      return { entity, dist, fuse };
    }

    // Fallback: track creeper that just started hissing via sound event
    // (The sound event "creeper" is fired when a creeper begins fusing)
    if (entity.id === state.lastCreeperId && state.hissingSince > 0) {
      const elapsed = (Date.now() - state.hissingSince);
      if (elapsed < 1500) { // Still within fuse window
        return { entity, dist, fuse: Math.max(0, 30 - Math.floor(elapsed / 50)) };
      }
    }
  }
  return null;
}

/**
 * Register hiss event when we hear creeper priming sound.
 * Call this from the bot's sound event listener.
 */
function onCreeperHiss(bot, creeperEntity) {
  const state = getCreeperState(bot);
  state.hissingSince = Date.now();
  state.lastCreeperId = creeperEntity?.id ?? null;
}

// ===== Fireball tracking =====

function getFireballTracker(bot) {
  if (!bot._fireballTracker) bot._fireballTracker = { active: new Map(), lastDodgeAt: 0 };
  return bot._fireballTracker;
}

/**
 * Predict where a fireball will be in `predictMs` milliseconds.
 * Returns { x, y, z } predicted position, or null if entity has no velocity.
 *
 * NOTE: mineflayer's entity.velocity is in blocks/tick (via fromNotchVelocity
 * which divides protocol units by 8000). A game tick is 50ms. So to convert
 * to block displacement, multiply by (predictMs / 50) ticks.
 */
function predictFireballPosition(bot, entity, predictMs) {
  const vel = entity.velocity;
  if (!vel || typeof vel.x !== 'number') {
    return null;
  }
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < FIREBALL_MIN_SPEED) {
    return null;
  }

  const ticks = predictMs / 50; // 50 ms per game tick
  const pos = entity.position;
  const pred = {
    x: pos.x + vel.x * ticks,
    y: pos.y + vel.y * ticks,
    z: pos.z + vel.z * ticks,
  };
  // (prediction debug omitted — too noisy per-tick)
  return pred;
}

/**
 * Check if a fireball trajectory will intersect near the bot.
 * Returns true if the fireball will land within `radius` of bot.
 */
function fireballAimsAtBot(bot, fireballEntity, radius) {
  const predicted = predictFireballPosition(bot, fireballEntity, FIREBALL_PREDICT_TIME_MS);
  if (!predicted) return false;

  const botPos = bot.entity.position;
  const horizontalDist = Math.hypot(predicted.x - botPos.x, predicted.z - botPos.z);
  const verticalDist = Math.abs(predicted.y - botPos.y);

  // Fireball explosion radius is ~1 block in MC
  // Predict as hitting if within `radius` horizontally and ~2 blocks vertically
  return horizontalDist <= radius && verticalDist <= 3;
}

/**
 * Get perpendicular direction to strafe away from fireball.
 */
function getDodgeDirection(bot, fireballEntity) {
  const vel = fireballEntity.velocity;
  if (!vel) return null;

  const botPos = bot.entity.position;

  // Cross product: velocity × up = perpendicular direction
  const cross = new Vec3(vel.z, 0, -vel.x);
  const len = Math.hypot(cross.x, cross.z);
  if (len < 0.1) return null;

  // Choose the side that's further from the threat
  const side1 = new Vec3(cross.x / len, 0, cross.z / len);
  const side2 = new Vec3(-cross.x / len, 0, -cross.z / len);
  const dist1 = Math.hypot(side1.x * FIREBALL_DODGE_LATERAL + botPos.x - fireballEntity.position.x,
                           side1.z * FIREBALL_DODGE_LATERAL + botPos.z - fireballEntity.position.z);
  const dist2 = Math.hypot(side2.x * FIREBALL_DODGE_LATERAL + botPos.x - fireballEntity.position.x,
                           side2.z * FIREBALL_DODGE_LATERAL + botPos.z - fireballEntity.position.z);

  return dist1 > dist2 ? side1 : side2;
}

/**
 * Scan for active fireballs and update tracker.
 */
function scanFireballs(bot, state) {
  const tracker = getFireballTracker(bot);
  const now = Date.now();

  // Prune old fireballs
  for (const [id, data] of tracker.active) {
    if (now - data.lastSeen > FIREBALL_TRACK_MAX_AGE_MS) {
      tracker.active.delete(id);
    }
  }

  // Scan for fireballs in range
  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position) continue;
    if (!FIREBALL_ENTITY_NAMES.has(entity.name)) continue;

    const dist = entity.position.distanceTo(bot.entity.position);
    if (dist > FIREBALL_SCAN_RADIUS) continue;

    const existing = tracker.active.get(entity.id);
    if (existing) {
      existing.lastSeen = now;
      existing.pos = entity.position;
      existing.vel = entity.velocity;
    } else {
      tracker.active.set(entity.id, {
        lastSeen: now,
        pos: entity.position,
        vel: entity.velocity,
      });
    }
  }
}

// ===== Creeper escape logic =====

/**
 * Execute creeper escape: backpedal, optionally place block.
 * Note: Shield does NOT block creeper explosion (TNT-type damage).
 */
async function escapeCreeper(bot, creeperData, state) {
  const { entity: creeper, dist } = creeperData;
  const now = Date.now();

  // Throttle
  if (state._lastCreeperEscape && now - state._lastCreeperEscape < 1000) return false;
  state._lastCreeperEscape = now;

  // Stop combat — creeper escape takes priority
  try { bot.pvp.stop(); } catch { /* ignore */ }
  bot.clearControlStates();

  // Calculate escape direction (back away from creeper)
  const botPos = bot.entity.position;
  const creeperPos = creeper.position;
  const dx = botPos.x - creeperPos.x;
  const dz = botPos.z - creeperPos.z;
  const len = Math.hypot(dx, dz) || 1;

  // Backpedal
  try {
    const escapeGoal = new goals.GoalNear(
      botPos.x + (dx / len) * CREEPER_ESCAPE_DISTANCE,
      botPos.y,
      botPos.z + (dz / len) * CREEPER_ESCAPE_DISTANCE,
      1
    );
    bot.pathfinder.setGoal(escapeGoal);
  } catch { /* ignore */ }

  // Place block between us and creeper if very close
  if (dist <= CREEPER_BLOCK_PLACE_DISTANCE) {
    const pillarBlock = findPillarBlock(bot);
    if (pillarBlock) {
      try {
        await bot.equip(pillarBlock, 'hand');
        // Place block at creeper's feet to create barrier
        const placeRef = bot.blockAt(creeperPos.floored());
        if (placeRef && placeRef.boundingBox === 'block') {
          await bot.placeBlock(placeRef, new Vec3(0, 1, 0));
        }
      } catch { /* ignore */ }
    }
  }

  return true;
}

// ===== Fireball dodge/escape logic =====

async function dodgeFireballs(bot, state) {
  const tracker = getFireballTracker(bot);
  const now = Date.now();

  if (now - tracker.lastDodgeAt < FIREBALL_DODGE_COOLDOWN_MS) return false;
  if (!state.active) return false;

  for (const [id, fb] of tracker.active) {
    const entityObj = Object.values(bot.entities).find(e => e && e.id === id);
    if (!entityObj) continue;

    // Check if aimed at bot
    const willHit = fireballAimsAtBot(bot, entityObj, FIREBALL_SHIELD_RADIUS);
    const dist = entityObj.position.distanceTo(bot.entity.position);

    // Very close fireball → face it + instant jump-strafe, then keep fighting.
    // Uses setControlState just like arrows — no pathfinder override so combat
    // pathfinding is NOT interrupted. Returns false so the main loop continues.
    if (dist < FIREBALL_ESCAPE_DISTANCE) {
      faceProjectile(bot, entityObj);
      const dodgeDir = getDodgeDirection(bot, entityObj);
      if (dodgeDir) {
        bot.clearControlStates();
        const strafeLeft = (-dodgeDir.x * Math.sin(bot.entity.yaw) + dodgeDir.z * Math.cos(bot.entity.yaw)) > 0;
        bot.setControlState('left', strafeLeft);
        bot.setControlState('right', !strafeLeft);
        bot.setControlState('jump', true);
        setTimeout(() => {
          bot.setControlState('left', false);
          bot.setControlState('right', false);
          bot.setControlState('jump', false);
        }, 150);
        tracker.lastDodgeAt = now;
      }
    }

    // Fireball heading toward us → face it + raise shield
    if (willHit && dist < FIREBALL_SCAN_RADIUS) {
      faceProjectile(bot, entityObj);
      if (hasShieldInOffHand(bot) && !isOffHandActive(bot)) {
        try { bot.activateItem(true); bot._shieldRaised = true; } catch { /* ignore */ }
      }
    }
  }
  return false;
}

// ===== Arrow tracking =====

function getArrowTracker(bot) {
  if (!bot._arrowTracker) bot._arrowTracker = { active: new Map(), lastDodgeAt: 0 };
  return bot._arrowTracker;
}

/**
 * Scan for active arrows and update tracker.
 */
function scanArrows(bot) {
  const tracker = getArrowTracker(bot);
  const now = Date.now();

  // Prune old arrows
  for (const [id, data] of tracker.active) {
    if (now - data.lastSeen > ARROW_TRACK_MAX_AGE_MS) {
      tracker.active.delete(id);
    }
  }

  // Scan for arrows in range
  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position) continue;
    if (!ARROW_ENTITY_NAMES.has(entity.name)) continue;

    const dist = entity.position.distanceTo(bot.entity.position);
    if (dist > ARROW_SCAN_RADIUS) continue;

    const existing = tracker.active.get(entity.id);
    if (existing) {
      existing.lastSeen = now;
      existing.pos = entity.position;
      existing.vel = entity.velocity;
    } else {
      const vel = entity.velocity;
      const speed = vel ? Math.hypot(vel.x, vel.y, vel.z) : 0;
      tracker.active.set(entity.id, {
        lastSeen: now,
        pos: entity.position,
        vel: entity.velocity,
      });
    }
  }
}

/**
 * Dodge incoming arrows by strafing perpendicular to their trajectory.
 *
 * Strategy (two tiers):
 *   1. Close arrow (≤ARROW_ESCAPE_DISTANCE) → instant setControlState strafe burst.
 *      Uses raw distance, NOT trajectory prediction — arrows fly ~60 blocks/s,
 *      so by the time we compute a predicted pathfinder goal the arrow has already
 *      arrived. A 80ms strafe pulse is instant and doesn't block the main loop.
 *   2. Distant arrow heading toward bot → trajectory prediction to reinforce shield.
 *      This supplements the shield manager's general ranged-threat check.
 *
 * Returns false (never blocks the defense loop) — dodge is fire-and-forget.
 */
async function dodgeArrows(bot, state) {
  const tracker = getArrowTracker(bot);
  const now = Date.now();

  if (now - tracker.lastDodgeAt < ARROW_DODGE_COOLDOWN_MS) return false;
  if (!state.active) return false;

  for (const [id, arrowData] of tracker.active) {
    const entityObj = Object.values(bot.entities).find(e => e && e.id === id);
    if (!entityObj) continue;

    const dist = entityObj.position.distanceTo(bot.entity.position);

    // --- Tier 1: Close arrow → instant jump-strafe ---
    // Pure strafe for 80ms doesn't move the bot far enough (arrows at 60 blk/s
    // cover 4.8 blocks in that time). Jump + strafe is more effective because:
    //   a) The bot's hitbox rises ~1.2 blocks, so center-mass arrows fly under
    //   b) Strafe moves us laterally at the same time
    //   c) The jump also resets any fall-scheduling that might interfere
    // Using distance directly (not prediction) so we react immediately even
    // if trajectory estimation fails (zero velocity data, prediction edge case).
    if (dist < ARROW_ESCAPE_DISTANCE) {
      // Face the arrow so shield blocks it (shield has no effect on back hits)
      faceProjectile(bot, entityObj);
      const dodgeDir = getDodgeDirection(bot, entityObj);
      if (dodgeDir) {
        bot.clearControlStates();
        // Map the perpendicular direction to left/right controls relative to
        // the bot's current facing — instant, no pathfinding needed.
        //   dot with ( -sin(yaw), cos(yaw) )  →  left if positive, right if negative
        const strafeLeft = (-dodgeDir.x * Math.sin(bot.entity.yaw) + dodgeDir.z * Math.cos(bot.entity.yaw)) > 0;
        bot.setControlState('left', strafeLeft);
        bot.setControlState('right', !strafeLeft);
        bot.setControlState('jump', true);          // jump lifts hitbox ~1.2 blk
        setTimeout(() => {
          bot.setControlState('left', false);
          bot.setControlState('right', false);
          bot.setControlState('jump', false);
        }, 150);                                     // hold strafe longer for more displacement
      }
      tracker.lastDodgeAt = now;
      break; // handled one arrow per cooldown window — don't block the loop
    }

    // --- Tier 2: Distant arrow → trajectory-based shield reinforcement ---
    const predicted = predictFireballPosition(bot, entityObj, ARROW_PREDICT_TIME_MS);
    if (predicted) {
      const botPos = bot.entity.position;
      const hDist = Math.hypot(predicted.x - botPos.x, predicted.z - botPos.z);
      const vDist = Math.abs(predicted.y - botPos.y);
      if (hDist <= 3 && vDist <= 3) {
        if (hasShieldInOffHand(bot) && !isOffHandActive(bot)) {
          try { bot.activateItem(true); bot._shieldRaised = true; } catch { /* ignore */ }
        }
      }
    }
  }
  return false; // fire-and-forget — never block the defense loop
}

/**
 * Quick check: is an arrow heading toward the bot within `range` blocks?
 * Used by the shield manager to avoid dropping the shield when a projectile
 * is about to arrive — dropping opens a window the arrow can slip through.
 */
function isArrowIncoming(bot, range = 10) {
  const tracker = bot._arrowTracker;
  if (!tracker || !tracker.active.size) return false;
  for (const [id] of tracker.active) {
    const entity = Object.values(bot.entities).find(e => e && e.id === id);
    if (!entity) continue;
    if (entity.position.distanceTo(bot.entity.position) < range) return true;
  }
  return false;
}

/**
 * Quick check: is a fireball heading toward the bot within `range` blocks?
 * Mirrors isArrowIncoming for the shield manager's independent raise logic.
 */
function isFireballIncoming(bot, range = 10) {
  const tracker = bot._fireballTracker;
  if (!tracker || !tracker.active.size) return false;
  for (const [id] of tracker.active) {
    const entity = Object.values(bot.entities).find(e => e && e.id === id);
    if (!entity) continue;
    if (entity.position.distanceTo(bot.entity.position) < range) return true;
  }
  return false;
}

/**
 * Face an incoming projectile so the shield blocks it.
 * Shield only protects the direction you're looking — a fireball/arrow from
 * behind hits even with shield raised. Instant rotation, no pathfinding.
 */
function faceProjectile(bot, entity) {
  if (!entity || !entity.position) return;
  try {
    const target = entity.position.offset(0, entity.height ?? 0.5, 0);
    bot.lookAt(target, true); // true = instant, no smoothing
  } catch { /* ignore */ }
}

// ===== Shield durability helpers =====

/**
 * Read shield durability remaining. Returns { remaining, max } or null
 * if durability information is unavailable.
 */
function getShieldDurability(bot) {
  const shield = bot.inventory.slots[45];
  if (!shield) return null;
  if (typeof shield.durabilityUsed === 'number' && typeof shield.maxDurability === 'number') {
    return { remaining: shield.maxDurability - shield.durabilityUsed, max: shield.maxDurability };
  }
  // Try NBT-based durability as fallback
  try {
    const dmg = shield.nbt?.value?.Damage?.value;
    const maxDmg = shield.nbt?.value?.maxDamage?.value;
    if (typeof dmg === 'number' && typeof maxDmg === 'number') {
      return { remaining: maxDmg - dmg, max: maxDmg };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Try to find a spare shield in inventory and swap it in.
 * Only acts if the off-hand shield is critically low on durability.
 */
function trySwapShield(bot) {
  const currentDurability = getShieldDurability(bot);
  if (!currentDurability) return false;
  if (currentDurability.remaining > SHIELD_CRITICAL_DURABILITY) return false;

  // Find a backup shield with more durability
  const spare = bot.inventory.items().find(i =>
    i.name === 'shield' && i.slot !== 45 &&
    typeof i.durabilityUsed === 'number' &&
    i.maxDurability - i.durabilityUsed > currentDurability.remaining + 20
  );
  if (!spare) return false;

  try { bot.equip(spare, 'off-hand').catch(() => {}); return true; }
  catch { return false; }
}

// ===== Emergency items: totem of undying + golden apple =====

function hasTotemInInventory(bot) {
  return bot.inventory.items().some(i => i.name === 'totem_of_undying');
}

function findGoldenApple(bot) {
  return bot.inventory.items().find(i => i.name === 'golden_apple' || i.name === 'enchanted_golden_apple');
}

/**
 * Try to use emergency items at critical HP:
 *   1. ≤ TOTEM_HP_THRESHOLD (4): Equip totem of undying in off-hand (replaces shield)
 *   2. ≤ GOLDEN_APPLE_HP_THRESHOLD (8): Eat golden apple for absorption + regen
 *   3. HP recovered with totem in off-hand: swap back to shield
 */
async function tryEmergencyItems(bot, state) {
  const hp = bot.health;
  const offHand = bot.inventory.slots[45];

  // --- HP recovered — swap totem back to shield ---
  if (offHand && offHand.name === 'totem_of_undying' && hp > TOTEM_HP_THRESHOLD + 4) {
    await equipShield(bot).catch(() => {});
    return true;
  }

  // --- Critical: automaticaly equip totem in off-hand ---
  if (hp <= TOTEM_HP_THRESHOLD) {
    const totem = bot.inventory.items().find(i => i.name === 'totem_of_undying');
    if (totem && (!offHand || offHand.name !== 'totem_of_undying')) {
      try {
        await bot.equip(totem, 'off-hand');
        return true;
      } catch { /* ignore */ }
    }
  }

  // --- Low HP: eat golden apple if no melee threat nearby ---
  if (hp <= GOLDEN_APPLE_HP_THRESHOLD) {
    // Only eat if there's a safe gap (no melee threat within 3 blocks)
    const closeThreats = listThreats(bot, 3);
    if (closeThreats.length === 0 && bot.food > 0) {
      const apple = findGoldenApple(bot);
      if (apple) {
        state.lastEatAt = Date.now(); // Use same cooldown as regular eating
        try {
          await bot.equip(apple, 'hand');
          await bot.consume();
          return true;
        } catch { /* ignore */ }
      }
    }
  }

  return false;
}

// ===== Strafing state =====

/**
 * Face the closest tracked projectile within 15m so the shield always
 * points at incoming threats, even before they reach dodge range.
 */
function faceNearestProjectile(bot) {
  let closest = null;
  let closestDist = Infinity;

  // Check arrow tracker
  const at = bot._arrowTracker;
  if (at && at.active.size) {
    for (const [id] of at.active) {
      const e = Object.values(bot.entities).find(e => e && e.id === id);
      if (!e) continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d < closestDist) { closestDist = d; closest = e; }
    }
  }

  // Check fireball tracker
  const ft = bot._fireballTracker;
  if (ft && ft.active.size) {
    for (const [id] of ft.active) {
      const e = Object.values(bot.entities).find(e => e && e.id === id);
      if (!e) continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d < closestDist) { closestDist = d; closest = e; }
    }
  }

  if (closest && closestDist < 15) {
    faceProjectile(bot, closest);
  }
}

function getStrafeState(bot) {
  if (!bot._strafeState) {
    bot._strafeState = {
      direction: Math.random() > 0.5 ? 'left' : 'right',
      lastSwitchAt: 0,
    };
  }
  return bot._strafeState;
}

/**
 * Apply strafing movement while in SOLO combat mode.
 */
function applyStrafing(bot, state) {
  if (!STRAFE_ENABLED) return;
  if (state.retreating || state.pillarInProgress) return;
  if (!bot.pvp?.target || !bot.pvp.target.isValid) return;

  const strafe = getStrafeState(bot);
  const now = Date.now();

  // Periodically switch direction to avoid being predictable
  if (now - strafe.lastSwitchAt > STRAFE_CHANGE_INTERVAL_MS) {
    strafe.direction = strafe.direction === 'left' ? 'right' : 'left';
    strafe.lastSwitchAt = now;
  }

  // Apply lateral movement (brief 150ms burst)
  bot.setControlState(strafe.direction, true);
  setTimeout(() => {
    bot.setControlState('left', false);
    bot.setControlState('right', false);
  }, 150);
}

function isThreat(bot, entity) {
  if (entity === bot.entity || !entity.position) return false;
  if (entity.type === 'hostile') return true;
  const map = getRecentAttackers(bot);
  const expires = map.get(entity.id);
  if (expires && expires > Date.now()) return true;
  return false;
}

// --- Threat scanning --------------------------------------------------------

function listThreats(bot, range) {
  pruneRecentAttackers(bot);
  const pos = bot.entity.position;
  const out = [];

  // Note: creepers are NOT added to threats list here.
  // They are handled separately via creeper defense (highest priority).

  for (const e of Object.values(bot.entities)) {
    if (!isThreat(bot, e)) continue;
    const d = e.position.distanceTo(pos);
    if (d > range) continue;
    out.push({ entity: e, dist: d });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

function findNearestHostile(bot, range) {
  const all = listThreats(bot, range);
  return all[0] || null;
}

function threatCentroid(threats) {
  if (!threats.length) return null;
  let x = 0, y = 0, z = 0;
  for (const t of threats) {
    x += t.entity.position.x;
    y += t.entity.position.y;
    z += t.entity.position.z;
  }
  return new Vec3(x / threats.length, y / threats.length, z / threats.length);
}

// --- Equip helpers ----------------------------------------------------------

const TOOL_TIERS = ['wooden', 'stone', 'golden', 'iron', 'diamond', 'netherite'];

// Base sword/axe damage in MC Java (without enchantments).
// Pulled from the wiki — used to compare swords vs axes of the same tier.
// Axes hit harder per swing but swing slower; for our purposes (mineflayer-pvp
// fires on cooldown, not max-DPS) the per-hit number is what matters.
const BASE_DAMAGE = {
  wooden_sword: 4,    stone_sword: 5,    iron_sword: 6,    golden_sword: 4,    diamond_sword: 7,    netherite_sword: 8,
  wooden_axe:   7,    stone_axe:   9,    iron_axe:   9,    golden_axe:   7,    diamond_axe:   9,    netherite_axe:   10,
};

// Enemies that take bonus damage from Smite (undead) or Bane of Arthropods.
const UNDEAD_MOBS = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin',
  'skeleton', 'stray', 'wither_skeleton', 'phantom', 'zoglin', 'wither',
]);
const ARTHROPOD_MOBS = new Set([
  'spider', 'cave_spider', 'silverfish', 'endermite', 'bee',
]);

function tierOf(name) {
  for (let i = TOOL_TIERS.length - 1; i >= 0; i--) {
    if (name.startsWith(TOOL_TIERS[i] + '_')) return i;
  }
  return -1;
}

/**
 * Read enchantment levels off an item. Works on both NBT shapes that mineflayer
 * produces (1.13+: item.nbt.value.Enchantments.value.value array; older:
 * item.enchants). Returns { sharpness, smite, bane, knockback, fireAspect, looting }.
 */
function readEnchants(item) {
  const out = { sharpness: 0, smite: 0, bane: 0, knockback: 0, fireAspect: 0, looting: 0 };
  if (!item) return out;

  // Convenient shortcut some mineflayer versions expose
  if (Array.isArray(item.enchants)) {
    for (const e of item.enchants) {
      const id = (e.name || '').replace(/^minecraft:/, '');
      const lvl = e.lvl ?? e.level ?? 0;
      if (id === 'sharpness') out.sharpness = lvl;
      else if (id === 'smite') out.smite = lvl;
      else if (id === 'bane_of_arthropods') out.bane = lvl;
      else if (id === 'knockback') out.knockback = lvl;
      else if (id === 'fire_aspect') out.fireAspect = lvl;
      else if (id === 'looting') out.looting = lvl;
    }
    return out;
  }

  // Raw NBT path
  try {
    const ench = item.nbt?.value?.Enchantments?.value?.value
              || item.nbt?.value?.ench?.value?.value;
    if (Array.isArray(ench)) {
      for (const e of ench) {
        const id = String(e.id?.value || '').replace(/^minecraft:/, '');
        const lvl = e.lvl?.value ?? 0;
        if (id === 'sharpness') out.sharpness = lvl;
        else if (id === 'smite') out.smite = lvl;
        else if (id === 'bane_of_arthropods') out.bane = lvl;
        else if (id === 'knockback') out.knockback = lvl;
        else if (id === 'fire_aspect') out.fireAspect = lvl;
        else if (id === 'looting') out.looting = lvl;
      }
    }
  } catch { /* ignore — fall through with zeros */ }
  return out;
}

/**
 * Score a weapon against a specific target. Higher = better.
 * Accounts for base damage, tier, enchantments, and mob-type bonuses.
 * If targetName is null, returns a generic score (used when picking on enable).
 */
function scoreWeapon(item, targetName) {
  if (!item) return -Infinity;
  const name = item.name;
  if (!name.endsWith('_sword') && !name.endsWith('_axe')) return -Infinity;

  let score = BASE_DAMAGE[name] ?? 0;
  // Tier as tiebreaker — important for non-standard weapons (mods, etc.)
  score += tierOf(name) * 0.1;

  const ench = readEnchants(item);

  // Sharpness: +0.5 per level after the first (which is +1) in modern MC
  if (ench.sharpness > 0) score += 0.5 + 0.5 * ench.sharpness;

  // Smite vs undead: +2.5 per level
  if (ench.smite > 0 && targetName && UNDEAD_MOBS.has(targetName)) {
    score += 2.5 * ench.smite;
  }
  // Bane vs arthropods: +2.5 per level
  if (ench.bane > 0 && targetName && ARTHROPOD_MOBS.has(targetName)) {
    score += 2.5 * ench.bane;
  }

  // Fire Aspect — minor bonus, irrelevant if the bot is meleeing in water
  if (ench.fireAspect > 0) score += 0.5;

  // Knockback: usually unwanted in swarm (pushes mob away mid-combo), but
  // useful for archers / creepers. We do NOT add a bonus here — neutral.

  // Durability tiebreaker: prefer the more-used item so we keep a fresh
  // backup, but only as a fractional nudge so it never overrides damage.
  if (typeof item.durabilityUsed === 'number' && typeof item.maxDurability === 'number') {
    const remaining = item.maxDurability - item.durabilityUsed;
    // Penalty if almost broken so we don't snap our weapon mid-fight
    if (remaining < 20) score -= 5;
  }

  return score;
}

/**
 * Pick the best weapon in inventory for the given target entity.
 * If no target, picks the generally-best weapon.
 * Returns the inventory item, or null if no weapon found.
 */
function pickBestWeapon(bot, targetEntity) {
  const targetName = targetEntity?.name || null;
  const items = bot.inventory.items().filter((i) =>
    i.name.endsWith('_sword') || i.name.endsWith('_axe')
  );
  if (!items.length) return null;
  // Also consider currently held item (might be in main-hand slot only)
  if (bot.heldItem && (bot.heldItem.name.endsWith('_sword') || bot.heldItem.name.endsWith('_axe'))) {
    if (!items.includes(bot.heldItem)) items.push(bot.heldItem);
  }
  let best = items[0];
  let bestScore = scoreWeapon(best, targetName);
  for (let i = 1; i < items.length; i++) {
    const s = scoreWeapon(items[i], targetName);
    if (s > bestScore) { bestScore = s; best = items[i]; }
  }
  return best;
}

/**
 * Equip the best weapon for the given target. Safe to call every tick — only
 * issues an equip packet when the held item actually needs to change.
 *
 * Optional `state` object lets us throttle equip attempts (avoid packet spam
 * if the equip races with mineflayer-pvp's own slot management).
 */
async function equipBestWeapon(bot, targetEntity, state) {
  const best = pickBestWeapon(bot, targetEntity);
  if (!best) return false;
  if (bot.heldItem?.name === best.name && bot.heldItem?.slot === best.slot) {
    return true;
  }
  // Throttle to once per 500ms — equipping mid-swing can desync mineflayer-pvp
  if (state) {
    const now = Date.now();
    if (now - (state.lastEquipAt || 0) < 500) return false;
    state.lastEquipAt = now;
  }
  try { await bot.equip(best, 'hand'); return true; }
  catch { return false; }
}

async function equipShield(bot) {
  const shield = bot.inventory.items().find((i) => i.name === 'shield');
  if (!shield) return false;
  // Already in off-hand?
  const offHand = bot.inventory.slots[45]; // 1.9+ off-hand slot
  if (offHand && offHand.name === 'shield') return true;
  try { await bot.equip(shield, 'off-hand'); return true; }
  catch { return false; }
}

function findPillarBlock(bot) {
  for (const name of PILLAR_BLOCKS) {
    const item = bot.inventory.items().find((i) => i.name === name);
    if (item) return item;
  }
  return null;
}

function findFood(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const foods = bot.inventory.items().filter((i) => mcData.foodsByName[i.name]);
  if (!foods.length) return null;
  // Prefer high-saturation, non-poisonous food
  const bad = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato',
    'pufferfish', 'chicken']); // raw chicken is bad; cooked is fine
  foods.sort((a, b) => {
    const aBad = bad.has(a.name) ? 1 : 0;
    const bBad = bad.has(b.name) ? 1 : 0;
    if (aBad !== bBad) return aBad - bBad;
    const aSat = mcData.foodsByName[a.name].saturation || 0;
    const bSat = mcData.foodsByName[b.name].saturation || 0;
    return bSat - aSat;
  });
  return foods[0];
}

// --- Strategies -------------------------------------------------------------

/**
 * Check if the column above the bot is clear enough for a pillar.
 * Returns { ok, reason }.
 */
function checkPillarClearance(bot, height) {
  const me = bot.entity.position.floored();
  // Bot occupies y and y+1. We need y+2..y+1+height to be air/replaceable.
  for (let dy = 2; dy <= 1 + height; dy++) {
    const b = bot.blockAt(me.offset(0, dy, 0));
    if (b && b.boundingBox === 'block') {
      return { ok: false, reason: `ceiling at +${dy}: ${b.name}` };
    }
  }
  return { ok: true };
}

/**
 * Pillar up `height` blocks. Returns { ok, placed, reason }.
 *
 * This is fragile if mineflayer-pvp or pathfinder is fighting us for control —
 * the caller MUST stop pvp + pathfinder first, and gate the main loop on
 * state.pillarInProgress so we get exclusive control of jump + look.
 */
async function pillarUp(bot, item, height = PILLAR_HEIGHT) {
  // Hard stop anything that drives controls
  try { bot.pvp.stop(); } catch { /* ignore */ }
  try { bot.pathfinder.stop(); } catch { /* ignore */ }
  bot.clearControlStates();

  const clear = checkPillarClearance(bot, height);
  if (!clear.ok) return { ok: false, placed: 0, reason: clear.reason };

  try {
    await bot.equip(item, 'hand');
  } catch (err) {
    return { ok: false, placed: 0, reason: `equip failed: ${err.message}` };
  }

  let placed = 0;

  for (let i = 0; i < height; i++) {
    const startY = Math.floor(bot.entity.position.y);
    // The block we want to place is at startY (where the bot's feet are).
    // After placing it'll push the bot up one block — we need to be on top.
    // Reference block is the one currently below the bot's feet (startY - 1).
    // Face vector (0,1,0) means "place on the top face of the reference".
    const refPos = bot.entity.position.floored().offset(0, -1, 0);
    const refBlock = bot.blockAt(refPos);
    if (!refBlock || refBlock.boundingBox !== 'block') {
      return { ok: false, placed, reason: `no solid block below at ${refPos}` };
    }

    // Look down so the place hits the top face cleanly
    try { await bot.look(bot.entity.yaw, Math.PI / 2, true); }
    catch { /* ignore */ }

    // Start jump
    bot.setControlState('jump', true);

    // Wait until we're airborne and above the current floor, then place
    const t0 = Date.now();
    let placedThisStep = false;
    while (Date.now() - t0 < PILLAR_STEP_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 50));
      // Are we high enough that placing on top of refBlock will land us on it?
      // We need to be airborne (off the original ground) AND our y >= startY + 0.5
      if (bot.entity.position.y >= startY + 0.5 && !bot.entity.onGround) {
        try {
          await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
          placedThisStep = true;
          placed++;
        } catch { /* try again next loop iteration */ }
        break;
      }
    }

    bot.setControlState('jump', false);

    if (!placedThisStep) {
      return { ok: false, placed, reason: 'jump+place window missed' };
    }

    // Wait until we land on the new block (onGround true and y advanced)
    const settleStart = Date.now();
    while (Date.now() - settleStart < 1000) {
      if (bot.entity.onGround && Math.floor(bot.entity.position.y) >= startY + 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return { ok: placed === height, placed, reason: null };
}

async function kiteStep(bot, threat) {
  // Step backwards relative to the threat's position.
  const me = bot.entity.position;
  const dx = me.x - threat.entity.position.x;
  const dz = me.z - threat.entity.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const goal = new goals.GoalNear(
    me.x + (dx / len) * KITE_RETREAT_BLOCKS,
    me.y,
    me.z + (dz / len) * KITE_RETREAT_BLOCKS,
    1,
  );
  try {
    // Don't block the loop — fire and forget, the next tick will reassess
    bot.pathfinder.setGoal(goal);
  } catch { /* ignore */ }
}

async function retreatFrom(bot, centroid) {
  const me = bot.entity.position;
  const dx = me.x - centroid.x;
  const dz = me.z - centroid.z;
  const len = Math.hypot(dx, dz) || 1;
  const tx = me.x + (dx / len) * RETREAT_DISTANCE;
  const tz = me.z + (dz / len) * RETREAT_DISTANCE;
  try {
    bot.pathfinder.setGoal(new goals.GoalNear(tx, me.y, tz, 2));
  } catch { /* ignore */ }
}

async function tryEat(bot, state) {
  const now = Date.now();
  if (now - state.lastEatAt < EAT_COOLDOWN_MS) return false;
  if (bot.food > EAT_HUNGER_THRESHOLD) return false;
  // Safe gap check
  const close = listThreats(bot, EAT_SAFE_GAP_BLOCKS);
  if (close.length > 0) return false;
  const food = findFood(bot);
  if (!food) return false;

  state.lastEatAt = now;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    return true;
  } catch {
    return false;
  }
}

// --- Crit & shield managers -------------------------------------------------

/**
 * Returns true if the held item is a sword/axe — only then are crits valuable.
 */
function holdingMeleeWeapon(bot) {
  const n = bot.heldItem?.name;
  if (!n) return false;
  return n.endsWith('_sword') || n.endsWith('_axe');
}

/**
 * Has the bot got a shield in off-hand?
 */
function hasShieldInOffHand(bot) {
  const off = bot.inventory.slots[45];
  return !!(off && off.name === 'shield');
}

/**
 * Is the off-hand item currently being used (right-click held)?
 * mineflayer tracks this in bot.usingHeldItem / bot._client state. We probe
 * via the activatedItem path which is reliable across versions.
 */
function isOffHandActive(bot) {
  // bot.activatedItem returns the slot index of the actively-used item, if any
  // For off-hand right-click, slot is 45.
  // Fallback: track our own flag (set/cleared by raiseShield/lowerShield).
  return !!bot._shieldRaised;
}

/**
 * Crit manager — installs a physicsTick listener that jumps when the bot is
 * about to swing at a melee target. mineflayer-pvp swings at fixed intervals
 * once attack() is set; we can't perfectly sync to its internal timer, so we
 * use a simpler heuristic: while pvp.target is in reach and on-ground and the
 * crit cooldown elapsed, do a tiny jump. The next pvp swing will land while
 * we're falling → crit. False crits (mid-cooldown) are harmless.
 *
 * Returns a cleanup function.
 */
function installCritManager(bot, state) {
  state.lastCritTick = 0;

  const onTick = () => {
    if (!state.active) return;
    if (state.retreating || state.pillarInProgress) return;
    if (!bot.pvp?.target || !bot.pvp.target.isValid) return;
    if (!holdingMeleeWeapon(bot)) return;
    if (!bot.entity.onGround) return;
    if (bot.entity.isInWater || bot.entity.isInLava) return;
    if (bot.entity.isOnLadder) return;
    if (bot.entity.effects && bot.entity.effects[25]) return; // Levitation
    if (bot.entity.effects && bot.entity.effects[28]) return; // Slow Falling — breaks crits

    const dist = bot.pvp.target.position.distanceTo(bot.entity.position);
    if (dist > CRIT_REACH || dist < 1.5) return;

    // Throttle: don't jump more often than the sword can swing
    const now = bot._tickCounter || 0;
    if (now - state.lastCritTick < CRIT_COOLDOWN_TICKS) return;
    state.lastCritTick = now;

    // One-tick jump impulse. The bot will leave ground next physics step;
    // mineflayer-pvp's swing within the next few ticks will be a crit.
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 50);
  };

  // Maintain a tick counter so we can throttle independently of clock time.
  const onTickCount = () => { bot._tickCounter = (bot._tickCounter || 0) + 1; };

  bot.on('physicsTick', onTick);
  bot.on('physicsTick', onTickCount);

  return () => {
    bot.removeListener('physicsTick', onTick);
    bot.removeListener('physicsTick', onTickCount);
  };
}

/**
 * Shield manager — raises the off-hand shield when ranged or melee threats are
 * around, and briefly lowers it just before each swing so attacks register.
 *
 * Strategy:
 *   - If shield in off-hand AND (ranged threat in 16m OR melee threat in 4m):
 *       keep right-click held on off-hand (activateItem(true))
 *   - When pvp.target exists and we're about to swing (within reach), lower
 *     the shield for SHIELD_LOWER_MS to let the swing through, then re-raise.
 *   - Always lower while moving via pathfinder (kiting) — shield blocks sprint.
 *
 * Returns a cleanup function.
 */
function installShieldManager(bot, state) {
  state.shieldLoweredUntil = 0;

  const raise = () => {
    if (bot._shieldRaised) return;
    try {
      bot.activateItem(true);
      bot._shieldRaised = true;
    } catch { /* ignore */ }
  };

  const lower = () => {
    if (!bot._shieldRaised) return;
    try {
      bot.deactivateItem();
      bot._shieldRaised = false;
    } catch { /* ignore */ }
  };

  const onTick = () => {
    if (!state.active) {
      lower();
      return;
    }
    if (state.pillarInProgress) {
      lower();
      return;
    }
    if (!hasShieldInOffHand(bot)) {
      lower();
      return;
    }

    // Shield durability management: auto-swap at critical durability
    trySwapShield(bot);
    const dur = getShieldDurability(bot);

    // Lower while kiting (need sprint) or retreating (need to run)
    if (state.retreating || state.mode === 'SWARM_KITE') {
      lower();
      return;
    }

    // Lower briefly around swings so they register.
    // BUT if an arrow is incoming (<10 blocks away), cancel the drop —
    // arrows fly at ~60 blocks/s and can easily slip through the 80ms window.
    const now = Date.now();
    if (now < state.shieldLoweredUntil) {
      if (isArrowIncoming(bot)) {
        state.shieldLoweredUntil = 0; // cancel drop, keep shield raised
      } else {
        lower();
        return;
      }
    }

    // Decide whether a threat warrants the shield
    const threats = listThreats(bot, SHIELD_RANGED_RADIUS);
    const recent = getRecentAttackers(bot);
    let want = false;
    for (const t of threats) {
      if (t.dist <= SHIELD_MELEE_RADIUS) { want = true; break; }
      if (t.dist <= SHIELD_RANGED_RADIUS &&
          (RANGED_ATTACKER_NAMES.has(t.entity.name) || recent.has(t.entity.id))) {
        want = true;
        break;
      }
    }

    // Conserve shield when durability is low: only raise for melee threats
    if (want && dur && dur.remaining <= SHIELD_LOW_DURABILITY) {
      // Check if the threat is a melee-range danger (not distant archer wasting shield)
      const meleeImminent = threats.some(t => t.dist <= SHIELD_MELEE_RADIUS);
      if (!meleeImminent) want = false;
    }

    // Independent check: if an arrow or fireball is within 8 blocks, raise
    // shield regardless of threat distance. The shooter might be outside
    // SHIELD_RANGED_RADIUS (16m) but the projectile is already here.
    if (!want && (isArrowIncoming(bot, 8) || isFireballIncoming(bot, 8))) {
      want = true;
    }

    if (want) raise(); else lower();
  };

  // Lower shield just before a swing. mineflayer-pvp emits 'attack' on each
  // swing in some versions; we hook the generic stoppedAttacking + a tick
  // pre-check. Easier: any time pvp.target is in reach, schedule a shield
  // lower window so the imminent swing connects.
  const onSwingPrep = () => {
    if (!state.active) return;
    if (!bot.pvp?.target || !bot.pvp.target.isValid) return;
    const dist = bot.pvp.target.position.distanceTo(bot.entity.position);
    if (dist <= CRIT_REACH) {
      state.shieldLoweredUntil = Date.now() + SHIELD_LOWER_MS;
    }
  };

  // Run swing-prep at a coarser cadence so we don't constantly drop the shield
  const swingPrepTimer = setInterval(onSwingPrep, 500);

  bot.on('physicsTick', onTick);

  return () => {
    clearInterval(swingPrepTimer);
    bot.removeListener('physicsTick', onTick);
    lower();
  };
}

// --- Creeper sound listener installer ---------------------------------------

/**
 * Install sound listeners for creeper hissing detection.
 * Returns cleanup function.
 */
function installCreeperListener(bot, state) {
  const onHiss = (soundName) => {
    if (soundName === 'entity.creeper.primed' || soundName === 'creeper') {
      onCreeperHiss(bot, null);
    }
  };
  bot.on('soundEffect', onHiss);
  state._creeperSoundCleanup = () => {
    bot.removeListener('soundEffect', onHiss);
  };
}

// --- Main enable ------------------------------------------------------------

function enableDefense(bot) {
  if (bot._defenseMode?.active) {
    return `Defense mode is already ON. Currently ${bot._defenseMode.currentTarget ? `fighting ${bot._defenseMode.currentTarget}` : 'scanning for hostiles'}.`;
  }

  try { bot.pvp.stop(); } catch { /* ignore */ }

  try {
    if (!bot._combatMovements) bot._combatMovements = new Movements(bot);
    bot.pvp.movements = bot._combatMovements;
  } catch { /* ignore */ }

  const state = {
    active: true,
    currentTarget: null,
    interval: null,
    killCount: 0,
    mode: 'SOLO',         // SOLO | SWARM_PILLAR | SWARM_KITE | RETREAT
    retreating: false,
    lastEatAt: 0,
    lastModeSwitchAt: 0,
    pillarInProgress: false,
    lastPillarFailAt: 0,
    pillarHeight: 0,      // How many blocks we've pillared up so far
  };
  bot._defenseMode = state;

  // Fire-and-forget: equip best generic weapon + shield asynchronously.
  // The defense loop will re-equip with target-specific weapon once a threat
  // is identified (e.g. swap to Smite-V sword vs zombies).
  equipBestWeapon(bot, null, state).catch(() => {});
  equipShield(bot).catch(() => {});

  // Warn immediately if no shield is available — the LLM should craft one
  const hasShield = bot.inventory.items().some(i => i.name === 'shield');
  if (!hasShield) {
    DEBUG(bot, 'NO SHIELD IN INVENTORY — arrow/fireball defense severely limited');
  }

  const onStoppedAttacking = () => {
    if (state.active) state.currentTarget = null;
  };
  bot.removeAllListeners('stoppedAttacking');
  bot.on('stoppedAttacking', onStoppedAttacking);

  // Patch the PVP plugin's attemptAttack to never deactivate the shield.
  // The PVP plugin independently drops the shield for 100ms before every swing
  // (+150ms to re-raise), creating a ~250ms window where projectiles slip
  // through. The attack packet (bot.attack) is sent at the protocol level and
  // works regardless of shield state — the deactivation is unnecessary.
  //
  // Our shield manager (installShieldManager) is the sole controller.
  if (bot.pvp && !bot._pvpPatchInstalled) {
    bot._originalPvpAttack = bot.pvp.attemptAttack.bind(bot.pvp);
    bot._originalPvpHasShield = bot.pvp.hasShield.bind(bot.pvp);
    bot.pvp.hasShield = () => false; // PVP skips deactivate/reactivate entirely
    bot.pvp.attemptAttack = function patchedAttemptAttack() {
      bot._originalPvpAttack();
    };
    bot._pvpPatchInstalled = true;
  }

  // Install crit + shield managers. These run on physicsTick (20 Hz).
  const stopCritMgr = installCritManager(bot, state);
  const stopShieldMgr = installShieldManager(bot, state);

  // Install creeper sound listener
  installCreeperListener(bot, state);

  // Main loop
  state.interval = setInterval(async () => {
    if (!state.active || !bot.entity) {
      clearInterval(state.interval);
      return;
    }

    // Hard guard: if a pillar attempt is in flight, do nothing this tick.
    // pillarUp owns jump/look/equip/pvp/pathfinder while it runs.
    if (state.pillarInProgress) return;

    // === PRIORITY 1: Creeper escape (highest — one shot kills) ===
    const hissCreeper = detectHissingCreeper(bot);
    if (hissCreeper) {
      await escapeCreeper(bot, hissCreeper, state).catch(() => {});
      return;
    }

    // === PRIORITY 2: Fireball defense ===
    scanFireballs(bot, state);
    await dodgeFireballs(bot, state); // fire-and-forget — no more pathfinder, no early return

    // === PRIORITY 3: Arrow defense (common threat, fast projectiles) ===
    scanArrows(bot);
    // Face the closest tracked projectile (<15m) so shield blocks it.
    // Runs every tick so the bot faces arrows/fireballs early, not just at
    // dodge range. This prevents "arrow in the back" scenarios.
    faceNearestProjectile(bot);
    await dodgeArrows(bot, state); // fire-and-forget — returns false, never blocks

    // === PRIORITY 4: Emergency items (totem / golden apple) ===
    // Check at the start of each combat tick so totem swaps in before
    // the next hit lands. The function handles both equip and restore.
    await tryEmergencyItems(bot, state).catch(() => {});

    const threats = listThreats(bot, DEFENSE_RANGE);
    const swarmCount = threats.filter((t) => t.dist <= SWARM_RADIUS).length;
    const hp = bot.health;

    // ---- RETREAT mode (overrides everything) -------------------------------
    if (state.retreating) {
      if (hp >= RESUME_HP_THRESHOLD || threats.length === 0) {
        state.retreating = false;
        state.mode = 'SOLO';
        try { bot.pathfinder.stop(); } catch { /* ignore */ }
      } else {
        // Keep retreating; periodically refresh the goal
        const c = threatCentroid(threats);
        if (c) await retreatFrom(bot, c);
        // Try to eat if it's safe
        await tryEat(bot, state).catch(() => {});
        return;
      }
    }

    if (hp <= RETREAT_HP_THRESHOLD && threats.length > 0) {
      state.retreating = true;
      state.mode = 'RETREAT';
      try { bot.pvp.stop(); } catch { /* ignore */ }
      const c = threatCentroid(threats);
      if (c) await retreatFrom(bot, c);
      return;
    }

    // ---- No threats: idle -------------------------------------------------
    if (!threats.length) {
      if (bot.pvp.target) {
        try { bot.pvp.stop(); } catch { /* ignore */ }
      }
      state.currentTarget = null;
      // Combat over: reset pillar tracker so the next ambush starts fresh.
      // (We don't auto-mine the pillar down — the agent can do that itself.)
      state.pillarHeight = 0;
      state.mode = 'SOLO';
      // Top up hunger in calm moments
      await tryEat(bot, state).catch(() => {});
      return;
    }

    // ---- Eat in lulls -----------------------------------------------------
    await tryEat(bot, state).catch(() => {});

    // ---- Mode selection ---------------------------------------------------
    const now = Date.now();
    const pillarOnCooldown = now - state.lastPillarFailAt < PILLAR_COOLDOWN_MS;
    if (swarmCount >= SWARM_THRESHOLD) {
      if (state.mode !== 'SWARM_PILLAR' && state.mode !== 'SWARM_KITE') {
        const pillarBlock = findPillarBlock(bot);
        const clearance = checkPillarClearance(bot, PILLAR_HEIGHT);
        if (pillarBlock && clearance.ok && !pillarOnCooldown) {
          state.mode = 'SWARM_PILLAR';
          state.lastModeSwitchAt = now;
        } else {
          state.mode = 'SWARM_KITE';
          state.lastModeSwitchAt = now;
        }
      }
    } else {
      if (state.mode !== 'SOLO') {
        state.mode = 'SOLO';
        state.lastModeSwitchAt = now;
      }
    }

    const nearest = threats[0];

    // ---- SWARM_PILLAR -----------------------------------------------------
    if (state.mode === 'SWARM_PILLAR' && state.pillarHeight < PILLAR_HEIGHT) {
      const pillarBlock = findPillarBlock(bot);
      if (!pillarBlock) {
        state.mode = 'SWARM_KITE'; // ran out of blocks mid-fight
      } else {
        state.pillarInProgress = true;
        const remaining = PILLAR_HEIGHT - state.pillarHeight;
        let result = { ok: false, placed: 0, reason: 'unknown' };
        try {
          result = await pillarUp(bot, pillarBlock, remaining);
        } catch (err) {
          result = { ok: false, placed: 0, reason: err.message };
        }
        state.pillarHeight += result.placed;
        if (!result.ok) {
          state.lastPillarFailAt = Date.now();
          state.mode = 'SWARM_KITE';
        }
        // After pillaring we placed blocks (not a weapon) in hand — re-equip
        // a weapon, biased toward the nearest threat below us.
        await equipBestWeapon(bot, threats[0]?.entity, state).catch(() => {});
        state.pillarInProgress = false;
        return; // Let next tick reassess from on top of the pillar
      }
    }

    // If we successfully pillared, drop back to SOLO so we fire pvp at mobs
    // below us. The crit manager handles jump-attacks from the pillar top.
    if (state.mode === 'SWARM_PILLAR' && state.pillarHeight >= PILLAR_HEIGHT) {
      state.mode = 'SOLO';
    }

    // ---- SWARM_KITE -------------------------------------------------------
    if (state.mode === 'SWARM_KITE') {
      // Always re-target the nearest threat — don't lock on
      if (bot.pvp.target !== nearest.entity) {
        // Re-equip for the new target before swinging (Smite vs zombies etc.)
        await equipBestWeapon(bot, nearest.entity, state).catch(() => {});
        try { bot.pvp.attack(nearest.entity); } catch { /* ignore */ }
        state.currentTarget = nearest.entity.name || 'unknown';
      }
      // Step back if a threat is in melee range
      if (nearest.dist < 2.5) {
        await kiteStep(bot, nearest).catch(() => {});
      }
      return;
    }

    // ---- SOLO -------------------------------------------------------------
    if (bot.pvp.target) {
      const t = bot.pvp.target;
      if (!t.isValid) {
        state.currentTarget = null;
        try { bot.pvp.stop(); } catch { /* ignore */ }
      } else {
        const tDist = t.position.distanceTo(bot.entity.position);
        if (tDist > VIEW_DISTANCE) {
          state.currentTarget = null;
          try { bot.pvp.stop(); } catch { /* ignore */ }
        } else if (nearest.entity !== t && nearest.dist < tDist * TARGET_SWITCH_RATIO) {
          state.currentTarget = nearest.entity.name || 'unknown';
          // Switching targets — re-pick weapon (new target may be a different mob type)
          await equipBestWeapon(bot, nearest.entity, state).catch(() => {});
          try { bot.pvp.attack(nearest.entity); } catch { /* ignore */ }
        } else {
          // Same target, but defensively re-check weapon every tick.
          // Cheap: equipBestWeapon is a no-op if the held item is still best.
          // This catches cases where the LLM swapped item slots mid-fight or
          // the previous best weapon broke (durability hit 0).
          await equipBestWeapon(bot, t, state).catch(() => {});
        }
        // Apply strafing for better melee evasion
        applyStrafing(bot, state);
        return;
      }
    }

    state.currentTarget = nearest.entity.name || 'unknown';
    // First engagement with this target — pick the right weapon for it
    await equipBestWeapon(bot, nearest.entity, state).catch(() => {});
    try { bot.pvp.attack(nearest.entity); }
    catch { state.currentTarget = null; }
  }, SCAN_INTERVAL_MS);

  state._cleanup = () => {
    bot.removeListener('stoppedAttacking', onStoppedAttacking);
    if (bot.listenerCount('stoppedAttacking') > 0) {
      bot.removeAllListeners('stoppedAttacking');
    }
    try { stopCritMgr(); } catch { /* ignore */ }
    try { stopShieldMgr(); } catch { /* ignore */ }
    // Clean up creeper sound listener
    if (state._creeperSoundCleanup) {
      try { state._creeperSoundCleanup(); } catch { /* ignore */ }
    }
    // Restore PVP plugin's original methods
    if (bot.pvp) {
      if (bot._originalPvpAttack) bot.pvp.attemptAttack = bot._originalPvpAttack;
      if (bot._originalPvpHasShield) bot.pvp.hasShield = bot._originalPvpHasShield;
    }
    bot._pvpPatchInstalled = false;
    // Make sure shield isn't stuck raised
    if (bot._shieldRaised) {
      try { bot.deactivateItem(); } catch { /* ignore */ }
      bot._shieldRaised = false;
    }
    // Clear lingering jump control
    try { bot.setControlState('jump', false); } catch { /* ignore */ }
    // Reset creeper/fireball/strafe state trackers
    if (bot._creeperState) bot._creeperState = { hissingSince: 0, lastCreeperId: null };
    if (bot._fireballTracker) bot._fireballTracker = { active: new Map(), lastDodgeAt: 0 };
    if (bot._arrowTracker) bot._arrowTracker = { active: new Map(), lastDodgeAt: 0 };
    if (bot._strafeState) bot._strafeState = { direction: 'left', lastSwitchAt: 0 };
  };

  const shieldMissing = !bot.inventory.items().some(i => i.name === 'shield');
  const baseMsg = 'Defense mode ON. Auto-fighting hostile mobs with swarm/kite/retreat tactics, creeper escape, fireball dodge, and arrow jump-strafe.';
  if (shieldMissing) {
    return `${baseMsg} WARNING: No shield in inventory — arrow/fireball defense severely limited. Craft a shield (1 iron ingot + 6 planks) and equip it to off-hand.`;
  }
  return `${baseMsg} Shield raised in off-hand. Use defense_mode(enabled=false) to disable.`;
}

function disableDefense(bot) {
  if (!bot._defenseMode?.active) return 'Defense mode is already OFF.';
  const state = bot._defenseMode;
  state.active = false;
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  try { bot.pvp.stop(); } catch { /* ignore */ }
  try { bot.pathfinder.stop(); } catch { /* ignore */ }
  if (state._cleanup) state._cleanup();
  state.currentTarget = null;
  state.retreating = false;
  state.mode = 'SOLO';
  state.pillarHeight = 0;
  state.pillarInProgress = false;
  return 'Defense mode OFF. Stopped auto-attacking.';
}

module.exports = function ({ goals: _goals, Movements: _Movements }) {
  return {
    name: 'defense_mode',
    description:
      'Toggle automatic self-defense mode. When ON, the bot fights hostile mobs ' +
      'using situation-aware tactics: 1-on-1 melee, swarm-pillar (build up out of reach), ' +
      'swarm-kite (hit-and-run), or retreat (when HP is low). Auto-selects the best ' +
      'weapon for each target (Smite vs undead, Bane vs spiders, Sharpness otherwise) ' +
      'and re-equips on target switch or if the weapon is about to break. Auto-equips ' +
      'shield in off-hand, jumps for critical hits, raises shield against archers and ' +
      'melee threats, and eats food mid-combat when safe. Also detects creeper fuse ' +
      'warnings and fireball trajectories for emergency escape and shield deflection. ' +
      'Uses circle-strafing in melee to make the bot harder to hit. Use ' +
      'defense_mode(enabled=false) to disable.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable defense mode, false to disable.',
        },
      },
      required: ['enabled'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      if (!bot.pvp) return 'Error: PVP plugin is not loaded. Cannot use defense mode.';

      // Soft warning when disabling defense while threats are nearby — the LLM
      // was repeatedly turning autopilot off mid-fight in earlier sessions.
      // We still honour the call (the user might want manual control), but
      // surface the consequence.
      if (args.enabled === false && bot._defenseMode?.active) {
        const here = bot.entity.position;
        let nearby = 0;
        let nearest = null;
        let nearestDist = Infinity;
        for (const e of Object.values(bot.entities)) {
          if (!e || e === bot.entity || !e.position) continue;
          if (e.type !== 'hostile') continue;
          const d = e.position.distanceTo(here);
          if (d > 16) continue;
          nearby++;
          if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        if (nearby > 0 && nearest) {
          const nName = nearest.name || nearest.displayName || 'unknown';
          const result = disableDefense(bot);
          return `${result} Warning: ${nearby} hostile${nearby > 1 ? 's' : ''} still within 16m (closest: ${nName} ${Math.round(nearestDist)}m). You are now exposed — re-enable with defense_mode(enabled=true) or fight manually with attack_entity.`;
        }
      }

      return args.enabled === true ? enableDefense(bot) : disableDefense(bot);
    },
  };
};

module.exports.enableDefense = enableDefense;
module.exports.disableDefense = disableDefense;
module.exports.markRecentAttacker = markRecentAttacker;
module.exports.isThreat = isThreat;
module.exports.equipBestWeapon = equipBestWeapon;
module.exports.pickBestWeapon = pickBestWeapon;
module.exports.detectHissingCreeper = detectHissingCreeper;
module.exports.escapeCreeper = escapeCreeper;
module.exports.dodgeFireballs = dodgeFireballs;
module.exports.scanFireballs = scanFireballs;
module.exports.applyStrafing = applyStrafing;
module.exports.predictFireballPosition = predictFireballPosition;
module.exports.fireballAimsAtBot = fireballAimsAtBot;
module.exports.scanArrows = scanArrows;
module.exports.dodgeArrows = dodgeArrows;
module.exports.tryEmergencyItems = tryEmergencyItems;
module.exports.hasTotemInInventory = hasTotemInInventory;
module.exports.findGoldenApple = findGoldenApple;
module.exports.getShieldDurability = getShieldDurability;
module.exports.trySwapShield = trySwapShield;