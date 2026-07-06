'use strict';

/**
 * flee_from — Retreating tool for escaping danger.
 *
 * Usage:
 *   flee_from(target: "zombie" | "nearest_hostile" | "nearest", x?: number, y?: number, z?: number)
 *
 * The bot will pathfind to a safe position away from the specified target
 * (entity type, coordinates, or nearest hostile mob). It stops once it has
 * reached a safe distance (default 32 blocks) or the target is gone.
 *
 * Accepts the same entity resolution as attack_entity for backwards compat.
 */

const { goals, Movements } = require('mineflayer-pathfinder');

const DEFAULT_SAFE_DISTANCE = 32;
const DEFAULT_SEARCH_RADIUS = 64;

// --- Entity resolution (mirrors attack_entity) ------------------------------

function resolveTarget(bot, target, typeFilter, targetCoords) {
  const pos = bot.entity.position;
  const filter = (typeFilter ?? '').toLowerCase();

  // If coordinates are provided, use those instead of an entity
  if (targetCoords && targetCoords.x !== undefined && targetCoords.z !== undefined) {
    return {
      kind: 'coord',
      x: targetCoords.x,
      y: targetCoords.y ?? Math.round(pos.y),
      z: targetCoords.z,
      label: `(${targetCoords.x}, ${targetCoords.y ?? 'current'}, ${targetCoords.z})`,
    };
  }

  const findNearest = (pred, maxDist) => {
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

  // Player by username
  const player = bot.players[target];
  if (player?.entity) {
    return { kind: 'entity', entity: player.entity, label: `player ${target}` };
  }

  const lower = target.toLowerCase().replace(/ /g, '_');

  if (lower === 'nearest' || lower === 'nearest_entity') {
    let pred;
    if (filter === 'hostile') pred = (e) => e.type === 'hostile';
    else if (filter === 'passive') pred = (e) => e.type === 'passive';
    else if (filter === 'mob') pred = (e) => e.type === 'hostile' || e.type === 'passive';
    else pred = () => true;

    const result = findNearest(pred, DEFAULT_SEARCH_RADIUS);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_hostile') {
    const result = findNearest((e) => e.type === 'hostile', DEFAULT_SEARCH_RADIUS);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_passive') {
    const result = findNearest((e) => e.type === 'passive', DEFAULT_SEARCH_RADIUS);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  // Entity name match (exact or partial)
  let result = findNearest((e) => {
    const eName = (e.name || e.displayName || '').toLowerCase().replace(/ /g, '_');
    return eName === lower;
  });
  if (result) {
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

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

module.exports = function ({ vec3, goals: _goals, Movements: _Movements }) {
  return {
    name: 'flee_from',
    description:
      'Retreat from a threat by pathfinding to a safe distance away. ' +
      'Use when surrounded by hostile mobs, creeper is near, or you need to ' +
      'escape danger quickly. Supports fleeing from an entity type, ' +
      '"nearest_hostile", "nearest", or specific coordinates. Returns once ' +
      'safe distance is reached or target disappears.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'Threat to flee from. Options: "nearest_hostile" (default), ' +
            '"nearest", "nearest_passive", entity name (e.g. "zombie", "creeper"), ' +
            'or player username.',
        },
        type_filter: {
          type: 'string',
          description: 'When using "nearest": "hostile", "passive", or "mob".',
        },
        x: {
          type: 'number',
          description: 'Optional X coordinate to flee FROM (overrides target).',
        },
        y: {
          type: 'number',
          description: 'Optional Y coordinate to flee FROM.',
        },
        z: {
          type: 'number',
          description: 'Optional Z coordinate to flee FROM (overrides target).',
        },
        safe_distance: {
          type: 'number',
          description: 'Minimum distance to maintain from threat (5-64). Defaults to 32.',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time in seconds to spend fleeing (5-60). Defaults to 30.',
        },
      },
      required: [],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const safeDistance = Math.min(Math.max(args.safe_distance ?? DEFAULT_SAFE_DISTANCE, 5), 64);
      const timeout = Math.min(Math.max(args.timeout ?? 30, 5), 60) * 1000;

      // Build target coords if provided
      const targetCoords = (args.x !== undefined || args.z !== undefined)
        ? { x: args.x, y: args.y, z: args.z }
        : null;

      let target = resolveTarget(bot, args.target ?? 'nearest_hostile', args.type_filter, targetCoords);

      if (!target) {
        // Build helpful context
        const pos = bot.entity.position;
        const nearby = Object.values(bot.entities)
          .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(pos) < 32)
          .map((e) => {
            const name = e.name || e.displayName || 'unknown';
            const dist = Math.round(e.position.distanceTo(pos));
            return `${name}(${dist}m)`;
          })
          .slice(0, 10)
          .join(', ');

        const query = targetCoords ? `coords (${targetCoords.x}, ${targetCoords.y ?? 'current'}, ${targetCoords.z})` : args.target || 'nearest hostile';
        return `No matching threat for "${query}" found within ${DEFAULT_SEARCH_RADIUS} blocks. Nearby entities: ${nearby || 'none'}. Nothing to flee from.`;
      }

      // Initial distance check
      const initialDist = target.kind === 'coord'
        ? bot.entity.position.distanceTo(vec3(target.x, target.y, target.z))
        : bot.entity.position.distanceTo(target.entity.position);

      if (initialDist >= safeDistance) {
        return `Already at safe distance (${Math.round(initialDist)}m ≥ ${safeDistance}m). No need to flee from ${target.label}.`;
      }

      try {
        bot.pathfinder.setMovements(new Movements(bot));
      } catch { /* ignore */ }

      const started = Date.now();

      while (Date.now() - started < timeout) {
        // Re-resolve target each tick (entity might die/move)
        target = resolveTarget(bot, args.target ?? 'nearest_hostile', args.type_filter, targetCoords);

        if (!target) {
          bot.pathfinder.setGoal(null);
          const pos = bot.entity.position;
          return `No threat found. Fleeing complete. Now at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
        }

        const currentDist = target.kind === 'coord'
          ? bot.entity.position.distanceTo(vec3(target.x, target.y, target.z))
          : bot.entity.position.distanceTo(target.entity.position);

        // Already safe?
        if (currentDist >= safeDistance) {
          bot.pathfinder.setGoal(null);
          const pos = bot.entity.position;
          return `Escaped ${target.label}. Reached safe distance (${Math.round(currentDist)}m). Now at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
        }

        // Compute flee direction (away from threat)
        const me = bot.entity.position;
        let awayX, awayY, awayZ;

        if (target.kind === 'coord') {
          awayX = me.x - target.x;
          awayY = me.y - target.y;
          awayZ = me.z - target.z;
        } else {
          awayX = me.x - target.entity.position.x;
          awayY = me.y - target.entity.position.y;
          awayZ = me.z - target.entity.position.z;
        }

        // Normalize and extend to safe distance
        const len = Math.hypot(awayX, awayY, awayZ) || 1;
        const targetX = me.x + (awayX / len) * safeDistance;
        const targetY = me.y + (awayY / len) * safeDistance;
        const targetZ = me.z + (awayZ / len) * safeDistance;

        // Use GoalGetToBlock for safer pathfinding (avoids lava, etc.)
        try {
          bot.pathfinder.setGoal(
            new goals.GoalGetToBlock(
              Math.round(targetX),
              Math.round(targetY),
              Math.round(targetZ),
              1
            ),
            true
          );
        } catch {
          // Fallback to GoalNear
          try {
            bot.pathfinder.setGoal(
              new goals.GoalNear(
                Math.round(targetX),
                Math.round(targetY),
                Math.round(targetZ),
                2
              ),
              true
            );
          } catch {
            bot.pathfinder.setGoal(null);
            return `Pathfinding failed. Stuck at x=${Math.round(me.x)}, y=${Math.round(me.y)}, z=${Math.round(me.z)}.`;
          }
        }

        // Wait a bit and check progress
        await new Promise((r) => setTimeout(r, 500));
      }

      // Timeout
      bot.pathfinder.setGoal(null);
      const pos = bot.entity.position;
      return `Flee timeout after ${Math.round(timeout / 1000)}s. Stopped at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}. Still ${Math.round(currentDist)}m from ${target.label}.`;
    },
  };
};
