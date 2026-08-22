'use strict';

/**
 * digging.js — Shared dig-time / tool-selection helpers.
 *
 * Single source of truth for "how long would this block take to break with
 * item X, and does X actually harvest it". Used by break_block (equip before
 * dig) and mine_block_type (verify orchestrator picks a real tool).
 */

/**
 * Milliseconds to break `block` while holding item type `heldItemId`
 * (null = bare hand), under current entity conditions.
 */
function digTimeMs(bot, block, heldItemId) {
  return block.digTime(
    heldItemId ?? null,
    bot.game?.gameMode === 'creative',
    false, // inWater — handled by prismarine-block via eye level upstream; keep simple
    !bot.entity.onGround,
    [],
    bot.entity.effects ?? {}
  );
}

/**
 * Can the given item type harvest this block (i.e. will it drop)?
 */
function canHarvest(bot, block, heldItemId) {
  try {
    return block.canHarvest(heldItemId ?? null);
  } catch {
    // Older versions may not expose canHarvest on plain instances — fall back
    // to harvestTools presence: blocks without harvestTools always drop.
    const ht = block.harvestTools;
    return !ht || Object.keys(ht).length === 0;
  }
}

/**
 * Best inventory item for breaking `block` by raw speed.
 * Returns the Item or null (bare hands if nothing helps).
 */
function bestToolForBlock(bot, block) {
  let best = null;
  let bestTime = digTimeMs(bot, block, null);
  for (const item of bot.inventory.items()) {
    const t = digTimeMs(bot, block, item.type);
    if (t < bestTime) {
      best = item;
      bestTime = t;
    }
  }
  return best;
}

/**
 * Equip the best tool and dig the block.
 * Refuses (returns error string) when no equipped option can HARVEST the
 * block — digging stone with a log wastes 7.5s and drops nothing; the caller
 * should hear about that instead of silently spinning.
 *
 * Returns { ok, content } style result string.
 */
async function smartDig(bot, block, { vec3Pos } = {}) {
  const bareHandHarvest = canHarvest(bot, block, null);
  const candidate = bestToolForBlock(bot, block);

  if (!bareHandHarvest && !candidate) {
    return `Cannot harvest ${block.name}: it requires a proper tool and you have none in inventory. Craft the right tool first.`;
  }

  if (candidate && !canHarvest(bot, block, candidate.type)) {
    return `${block.name} needs a harvesting tool (e.g. pickaxe); your best candidate ${candidate.name} cannot harvest it. Craft the right tier first.`;
  }

  if (candidate) {
    await bot.equip(candidate, 'hand');
  }

  await bot.dig(block);
  return null; // success
}

module.exports = { digTimeMs, canHarvest, bestToolForBlock, smartDig };
