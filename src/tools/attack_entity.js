'use strict';

/**
 * attack_entity tool — Attack a nearby entity using mineflayer-pvp.
 *
 * Target selectors:
 *   - "nearest"         → closest entity of the given type filter
 *   - "nearest_hostile" → closest hostile mob
 *   - "nearest_passive" → closest passive mob
 *   - entity name       → e.g. "zombie", "skeleton", "cow"
 *   - username          → player username
 *
 * The bot will use mineflayer-pvp to pursue and attack the target.
 * Works with swords, axes, or bare hand — pvp plugin handles equip logic.
 */

// Default attack range (blocks). The pvp plugin handles pathfinding + attack
// distance, but we use this for the initial range check to give early feedback.
const DEFAULT_ATTACK_RANGE = 6;

/**
 * Resolve an entity from the given target selector.
 * Returns { entity, label } or null if not found.
 */
function resolveTarget(bot, target, typeFilter) {
  const pos = bot.entity.position;
  const filter = (typeFilter ?? '').toLowerCase();

  // Helper: find nearest entity matching a predicate
  const findNearest = (pred) => {
    let best = null;
    let bestDist = Infinity;
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity.position) continue;
      if (!pred(entity)) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = entity;
      }
    }
    return best ? { entity: best, dist: bestDist } : null;
  };

  // 1. Player by username
  const player = bot.players[target];
  if (player?.entity) {
    return { entity: player.entity, label: `player ${target}` };
  }

  // 2. Named selectors
  const lower = target.toLowerCase().replace(/ /g, '_');

  if (lower === 'nearest' || lower === 'nearest_entity') {
    let pred;
    if (filter === 'hostile') pred = (e) => e.type === 'hostile';
    else if (filter === 'passive') pred = (e) => e.type === 'passive';
    else if (filter === 'mob') pred = (e) => e.type === 'hostile' || e.type === 'passive';
    else pred = () => true;

    const result = findNearest(pred);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_hostile') {
    const result = findNearest((e) => e.type === 'hostile');
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_passive') {
    const result = findNearest((e) => e.type === 'passive');
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  // 3. Entity name match (exact or partial)
  // First try exact match on name or displayName
  let result = findNearest((e) => {
    const eName = (e.name || e.displayName || '').toLowerCase().replace(/ /g, '_');
    return eName === lower;
  });
  if (result) {
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  // Partial/contains match
  result = findNearest((e) => {
    const eName = (e.name || e.displayName || '').toLowerCase().replace(/ /g, '_');
    return eName.includes(lower) || lower.includes(eName);
  });
  if (result) {
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m, partial match)` };
  }

  return null;
}

module.exports = function ({ goals, Movements }) {
  return {
    name: 'attack_entity',
    description:
      'Attack a nearby entity (mob or player). ' +
      'Target selectors: "nearest" (closest entity), "nearest_hostile", "nearest_passive", ' +
      'or an entity name like "zombie", "skeleton", "cow", or a player username. ' +
      'The bot will pursue and attack using the best available weapon (or bare hand). ' +
      'Returns an error if no matching entity is found or if the entity is out of range.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'Target selector: "nearest", "nearest_hostile", "nearest_passive", ' +
            'an entity name (e.g. "zombie", "blaze", "enderman", "cow"), ' +
            'or a player username.',
        },
        type_filter: {
          type: 'string',
          description:
            'Optional filter when using "nearest": "hostile", "passive", "mob", or omitted for any.',
        },
      },
      required: ['target'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;

      // Verify pvp plugin is loaded
      if (!bot.pvp) {
        return 'Error: PVP plugin is not loaded. Cannot attack.';
      }

      const resolved = resolveTarget(bot, args.target, args.type_filter);
      if (!resolved) {
        // Build helpful context about what entities are nearby
        const pos = bot.entity.position;
        const nearby = Object.values(bot.entities)
          .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(pos) < 32)
          .map((e) => {
            const name = e.name || e.displayName || 'unknown';
            const dist = Math.round(e.position.distanceTo(pos));
            return `${name}(${dist}m)`;
          })
          .slice(0, 15)
          .join(', ');
        return `Error: No entity matching "${args.target}" found. Nearby entities: ${nearby || 'none'}`;
      }

      const { entity, label } = resolved;
      const dist = entity.position.distanceTo(bot.entity.position);

      // Early range warning — the pvp plugin will pathfind, but if they're
      // very far away it's better to inform the agent up front.
      if (dist > 48) {
        return `Error: "${label}" is too far away (${Math.round(dist)}m). Move closer first with go_to or approach.`;
      }

      // Stop any current pvp target
      try {
        if (bot.pvp.target) {
          bot.pvp.stop();
        }
      } catch { /* ignore */ }

      // Configure pvp movements
      try {
        const movements = new Movements(bot);
        bot.pvp.movements = movements;
      } catch { /* ignore if already set */ }

      // Attack the entity
      try {
        bot.pvp.attack(entity);

        // Wait briefly for the attack to register, then check if target is valid
        await new Promise((r) => setTimeout(r, 500));

        // If the target immediately became invalid, report it
        if (!entity.isValid) {
          return `Target "${label}" disappeared or became invalid before attack could land.`;
        }

        const heldItem = bot.inventory.slots[bot.QUICK_BAR_START + bot.quickBarSlot];
        const weapon = heldItem ? heldItem.name : 'bare hand';

        return `Attacking ${label} with ${weapon}. ` +
          `Distance: ${Math.round(dist)}m. ` +
          `The bot will pursue and attack until the target dies, you call attack_entity again, or you call defence_mode(off).`;
      } catch (err) {
        return `Failed to attack ${label}: ${err.message}`;
      }
    },
  };
};