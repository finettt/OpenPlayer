'use strict';

/**
 * hazard_reflex.js — Tick-level survival reflexes (no LLM involved).
 *
 * The damage aggregator in index.js *reports* environmental damage to the
 * LLM, but reporting takes a reasoning round-trip (~10-20s) and lava kills in
 * ~4 seconds. This module acts immediately, on physicsTick:
 *
 *   1. LAVA EXIT — if the bot is in lava: jump + swim toward the direction of
 *      its last on-ground position (or opposite of movement), pathfind out,
 *      drink fire resistance potion if available.
 *   2. FIRE EXTINGUISH — if burning with no fire-resistance effect: seek the
 *      nearest loaded water within reach; otherwise stop moving (drops roll
 *      damage) and wait it out. Fire resistance potion if available.
 *   3. AUTO POTION — drinks fire resistance when entering lava/fire while
 *      one is in inventory.
 *
 * Installs ONE physicsTick listener per bot; idempotent.
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const REFLEX_TICK_INTERVAL = 4;        // run logic every N physics ticks (200ms)
const LAVA_PATHFIND_COOLDOWN_MS = 1500;
const BURN_STOP_MS = 4000;             // stand still while burning for this long

// Piglin appeasement: piglins attack unless the player wears ≥1 gold armor
// piece. Check periodically while in the Nether.
const PIGLIN_SCAN_INTERVAL_TICKS = 40; // ~2s between piglin checks
const PIGLIN_WARN_RADIUS = 24;
const GOLD_ARMOR_SLOTS = [
  ['golden_helmet', 5], ['golden_chestplate', 6],
  ['golden_leggings', 7], ['golden_boots', 8],
];

function hasGoldArmorEquipped(bot) {
  return GOLD_ARMOR_SLOTS.some(([, slot]) => {
    const item = bot.inventory.slots[slot];
    return item && item.name.startsWith('golden_');
  });
}

/**
 * If piglins are nearby and no gold armor is equipped, equip any golden piece.
 */
async function appeasePiglins(bot) {
  const pos = bot.entity.position;
  const piglinNearby = Object.values(bot.entities).some((e) =>
    e && e.position && e !== bot.entity &&
    (e.name === 'piglin' || e.name === 'piglin_brute') &&
    e.position.distanceTo(pos) <= PIGLIN_WARN_RADIUS
  );
  if (!piglinNearby || hasGoldArmorEquipped(bot)) return;

  for (const [name] of GOLD_ARMOR_SLOTS) {
    const piece = bot.inventory.items().find((i) => i.name === name);
    if (!piece) continue;
    try {
      await bot.equip(piece, 'torso');
      return;
    } catch { /* try next piece */ }
  }
}

function getState(bot) {
  if (!bot._hazardReflex) {
    bot._hazardReflex = {
      lastSafeGround: null,            // Vec3 of last solid-ground position
      lastLavaPathAt: 0,
      burnStartedAt: 0,
      tickCounter: 0,
    };
  }
  return bot._hazardReflex;
}

function findFireResistancePotion(bot) {
  return bot.inventory.items().find(
    (i) => i.name === 'potion' && i.nbtValue?.value?.Potion?.value === 'minecraft:fire_resistance'
  ) || bot.inventory.items().find((i) =>
    i.name === 'potion' && JSON.stringify(i.nbt ?? {}).includes('fire_resistance')
  );
}

async function drinkFireRes(bot) {
  const potion = findFireResistancePotion(bot);
  if (!potion) return false;
  try {
    await bot.equip(potion, 'hand');
    await bot.consume();
    // restore previous held item is left to higher-level logic
    return true;
  } catch {
    return false;
  }
}

/**
 * Nearest loaded water block within radius (BFS-free coarse scan).
 */
function findNearestWater(bot, radius = 24) {
  const pos = bot.entity.position.floored();
  let best = null;
  let bestDist = Infinity;
  for (let dx = -radius; dx <= radius; dx += 2) {
    for (let dy = -6; dy <= 6; dy += 2) {
      for (let dz = -radius; dz <= radius; dz += 2) {
        const p = pos.offset(dx, dy, dz);
        const b = bot.blockAt(p);
        if (b && b.name === 'water') {
          const d = p.distanceTo(pos);
          if (d < bestDist) { bestDist = d; best = p; }
        }
      }
    }
  }
  return best;
}

function updateLastSafeGround(bot, state) {
  const e = bot.entity;
  if (e.onGround && !e.isInLava && !e.isInWater) {
    const ground = bot.entity.position.floored();
    // Only remember positions standing on something solid.
    const below = bot.blockAt(ground.offset(0, -1, 0));
    if (below && below.boundingBox === 'block') {
      state.lastSafeGround = ground.clone();
    }
  }
}

/**
 * Install reflexes. Idempotent — safe to call multiple times per bot.
 */
function installHazardReflex(bot) {
  if (bot._hazardReflexInstalled) return;
  bot._hazardReflexInstalled = true;
  const state = getState(bot);

  bot.on('physicsTick', () => {
    state.tickCounter++;
    if (state.tickCounter % REFLEX_TICK_INTERVAL !== 0) return;
    if (!bot.entity) return;

    updateLastSafeGround(bot, state);
    const e = bot.entity;

    // ── Priority 0 (Nether only): piglin appeasement, every ~2s ─────────
    const inNether = (bot.game?.dimension ?? '').includes('nether');
    if (inNether && state.tickCounter % PIGLIN_SCAN_INTERVAL_TICKS === 0) {
      appeasePiglins(bot).catch(() => {});
    }

    // ── Priority 1: in lava → get OUT now ──────────────────────────────
    if (e.isInLava) {
      // Drink fire resistance immediately if we have one (buy 8 min of grace)
      if (!bot.entity.effects || !Object.keys(bot.entity.effects).some(
        (k) => String(k).includes('fire_resistance') || String(k) === '12'
      )) {
        drinkFireRes(bot).catch(() => {});
      }

      // Jump to keep head above the surface.
      bot.setControlState('jump', true);

      // Pathfind toward last safe ground (or straight line back) at most
      // every LAVA_PATHFIND_COOLDOWN_MS so we don't spam the pathfinder.
      const now = Date.now();
      if (now - state.lastLavaPathAt > LAVA_PATHFIND_COOLDOWN_MS) {
        state.lastLavaPathAt = now;
        const target = state.lastSafeGround;
        try {
          if (target && target.distanceTo(e.position) < 48) {
            bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 1), true);
          } else {
            // No known safe ground — swim against velocity (toward where we came from).
            const v = e.velocity;
            const away = new Vec3(-v.x, 0, -v.z);
            if (away.norm() < 0.01) away.set(1, 0, 1); // arbitrary fallback direction... rarely hit
            bot.pathfinder.setGoal(
              new goals.GoalNear(
                Math.round(e.position.x + away.x * 8), e.position.y + 1,
                Math.round(e.position.z + away.z * 8), 1),
              true
            );
          }
        } catch { /* pathfinder may refuse mid-lava; control-state swimming still helps */ }
      }
      state.burnStartedAt = Date.now(); // treat as burning
      return;
    }

    bot.setControlState('jump', false);

    // ── Priority 2: standing in/on fire blocks → extinguish ────────────
    // (entity.metadata[0].fire is unreliable on modern protocol versions;
    // block-based signals are exact: fire/soul_fire at feet, magma below.)
    const feet = bot.blockAt(e.position.floored());
    const below = bot.blockAt(e.position.floored().offset(0, -1, 0));
    const inFire = !!feet && (feet.name === 'fire' || feet.name === 'soul_fire');
    const onMagma = !!below && below.name === 'magma_block';
    const hasFireRes = Object.keys(bot.entity.effects ?? {}).some(
      (k) => String(k).includes('fire_resistance') || String(k) === '12'
    );
    if ((inFire || onMagma) && !hasFireRes && !e.isInWater && !e.isInLava) {
      if (state.burnStartedAt === 0) {
        state.burnStartedAt = Date.now();
        drinkFireRes(bot).catch(() => {});
      }
      // If water nearby, go stand in it; otherwise stop moving (fall damage
      // while burning is how bots die twice).
      const water = findNearestWater(bot, 16);
      if (water) {
        try {
          bot.pathfinder.setGoal(new goals.GoalNear(water.x, water.y, water.z, 1), true);
        } catch { /* ignore */ }
      } else if (onMagma && !inFire) {
        // Magma underfoot: step off — jump forward toward last safe ground.
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        setTimeout(() => {
          bot.setControlState('jump', false);
          bot.setControlState('forward', false);
        }, 300);
      } else {
        bot.clearControlStates();
      }
    } else if (!inFire && !onMagma && !e.isInLava) {
      state.burnStartedAt = 0;
    }
  });
}

module.exports = {
  installHazardReflex,
  findFireResistancePotion,
  drinkFireRes,
  findNearestWater,
};
