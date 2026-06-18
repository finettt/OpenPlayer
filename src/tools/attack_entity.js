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
// Range cap for `nearest*` selectors. Without this the bot can target an
// enderman 35m away when the LLM asks for "nearest_hostile" but really
// meant "the zombie that's hitting me right now".
const NEAREST_SELECTOR_MAX_DIST = 24;

/**
 * Resolve an entity from the given target selector.
 * Returns { entity, label } or null if not found.
 */
function resolveTarget(bot, target, typeFilter) {
  const pos = bot.entity.position;
  const filter = (typeFilter ?? '').toLowerCase();

  // Helper: find nearest entity matching a predicate, optionally capped by range
  const findNearest = (pred, maxDist = Infinity) => {
    let best = null;
    let bestDist = Infinity;
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity.position) continue;
      if (!pred(entity)) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist > maxDist) continue;
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

    const result = findNearest(pred, NEAREST_SELECTOR_MAX_DIST);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_hostile') {
    const result = findNearest((e) => e.type === 'hostile', NEAREST_SELECTOR_MAX_DIST);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_passive') {
    const result = findNearest((e) => e.type === 'passive', NEAREST_SELECTOR_MAX_DIST);
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

      // Soft notice: if defense_mode is already handling this fight, the LLM
      // is probably wasting a turn. We still proceed (LLM might want to
      // re-target on purpose), but make sure it knows what's going on.
      const defenseActive = !!bot._defenseMode?.active;
      const defenseBusyOnHostile = defenseActive
        && bot.pvp?.target?.isValid
        && bot.pvp.target.type === 'hostile';
      let defenseNotice = '';
      if (defenseBusyOnHostile) {
        const cur = bot.pvp.target;
        const curName = cur.name || cur.displayName || 'unknown';
        const curDist = Math.round(cur.position.distanceTo(bot.entity.position));
        defenseNotice =
          `Note: defense_mode is already attacking ${curName} (${curDist}m). ` +
          `Calling attack_entity here will override its target to ${label}. ` +
          `If that wasn't intended, you can let defense_mode handle combat itself. `;
      }

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

      // Configure pvp movements. Cache the Movements instance on the bot —
      // constructing a new one allocates the full block-cost table every call,
      // which is wasteful when combat is re-engaged frequently.
      try {
        if (!bot._combatMovements) {
          bot._combatMovements = new Movements(bot);
        }
        bot.pvp.movements = bot._combatMovements;
      } catch { /* ignore if already set */ }

      // Auto-select the best weapon for this target (Smite vs undead, Bane vs
      // arthropods, otherwise highest Sharpness/tier). Shares logic with
      // defense_mode so behaviour is consistent across the two entry points.
      try {
        const { equipBestWeapon } = require('./defense_mode');
        await equipBestWeapon(bot, entity);
      } catch { /* fall back to whatever is in hand */ }

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

        return `${defenseNotice}Attacking ${label} with ${weapon}. ` +
          `Distance: ${Math.round(dist)}m. ` +
          `The bot will pursue and attack until the target dies, you call attack_entity again, or you call defense_mode(off).`;
      } catch (err) {
        return `Failed to attack ${label}: ${err.message}`;
      }
    },
  };
};