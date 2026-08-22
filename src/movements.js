'use strict';

/**
 * movements.js — Shared pathfinder Movements factory.
 *
 * Every movement tool used to build `new Movements(bot)` with defaults, which
 * is fine in the Overworld and lethal in the Nether: default movements treat
 * magma blocks as walkable floor even though standing on them sets you on
 * fire. This factory centralizes hazard avoidance so all tools (go_to,
 * approach, go_to_y, flee_from) and the defense loop share one tuned config.
 *
 * Usage:
 *   const { makeMovements } = require('./movements');
 *   bot.pathfinder.setMovements(makeMovements(bot));
 */

const { Movements } = require('mineflayer-pathfinder');

// Block names the pathfinder must refuse to walk through / stand in.
const AVOID_BLOCKS = [
  // Fire & heat
  'fire', 'soul_fire', 'lava', 'magma_block',
  // Traps / damage
  'cobweb', 'web', 'sweet_berry_bush', 'pointed_dripstone',
  'cactus', 'campfire', 'soul_campfire',
  // Stranding hazards
  'powder_snow',
];

function makeMovements(bot) {
  const mov = new Movements(bot);
  for (const name of AVOID_BLOCKS) {
    const block = bot.registry.blocksByName[name];
    if (!block) continue; // version differences: block may not exist in this registry
    mov.blocksToAvoid.add(block.id);
  }
  return mov;
}

module.exports = { makeMovements, AVOID_BLOCKS };
