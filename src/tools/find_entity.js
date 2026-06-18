'use strict';

/**
 * find_entity tool — Locate nearby entities by name/type within a radius.
 *
 * Supports:
 *   - Exact or partial name matching (e.g. "enderman", "zombie", "cow")
 *   - Named selectors: "nearest_hostile", "nearest_passive", "nearest_mob"
 *   - Optional count to return multiple results (default 1)
 *   - Returns coordinates, distance, and health info
 */

const DEFAULT_RADIUS = 64;
const MIN_RADIUS = 5;
const MAX_RADIUS = 200;
const DEFAULT_COUNT = 1;
const MAX_COUNT = 20;

/**
 * Find entities matching a predicate, sorted by distance.
 */
function findEntities(bot, predicate, radius, count) {
  const pos = bot.entity.position;
  const results = [];

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity.position) continue;
    const dist = entity.position.distanceTo(pos);
    if (dist > radius) continue;
    if (!predicate(entity)) continue;
    results.push({ entity, dist });
  }

  results.sort((a, b) => a.dist - b.dist);
  return results.slice(0, count);
}

/**
 * Build a predicate from the given type string and optional type_filter.
 */
function buildPredicate(type, typeFilter) {
  const lower = (type ?? '').toLowerCase().replace(/ /g, '_');
  const filter = (typeFilter ?? '').toLowerCase();

  // Named selectors
  if (lower === 'nearest_hostile' || lower === 'hostile') {
    return (e) => e.type === 'hostile';
  }
  if (lower === 'nearest_passive' || lower === 'passive') {
    return (e) => e.type === 'passive';
  }
  if (lower === 'nearest_mob' || lower === 'mob') {
    return (e) => e.type === 'hostile' || e.type === 'passive';
  }
  if (lower === 'nearest' || lower === 'nearest_entity' || lower === '') {
    if (filter === 'hostile') return (e) => e.type === 'hostile';
    if (filter === 'passive') return (e) => e.type === 'passive';
    if (filter === 'mob') return (e) => e.type === 'hostile' || e.type === 'passive';
    return () => true;
  }

  // Player by username — check bot.players first
  return (e) => {
    const eName = (e.name || e.displayName || '').toLowerCase().replace(/ /g, '_');
    return eName === lower || eName.includes(lower) || lower.includes(eName);
  };
}

/**
 * Format a single entity result.
 */
function formatEntity(result) {
  const { entity, dist } = result;
  const name = entity.name || entity.displayName || 'unknown';
  const type = entity.type || 'unknown';
  const x = Math.round(entity.position.x * 10) / 10;
  const y = Math.round(entity.position.y * 10) / 10;
  const z = Math.round(entity.position.z * 10) / 10;

  let health = '';
  if (entity.health && entity.maxHealth) {
    health = `, health: ${Math.round(entity.health * 10) / 10}/${entity.maxHealth}`;
  }

  return `${name} (${type}) at x=${x}, y=${y}, z=${z} — ${Math.round(dist)}m away${health}`;
}

module.exports = function () {
  return {
    name: 'find_entity',
    description:
      'Find nearby entities (mobs, players, animals) by name or type within a radius. ' +
      'Returns coordinates, distance, and health info. ' +
      'Supports exact/partial name matching (e.g. "enderman", "zombie", "cow") ' +
      'and selectors ("hostile", "passive", "mob", "nearest"). ' +
      'Use to locate threats, resources, or NPCs before approaching or attacking.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Entity name or selector. Examples: "enderman", "zombie", "blaze", "villager", "cow", ' +
            '"hostile", "passive", "mob", "nearest". Partial matches work (e.g. "log" → logging entities).',
        },
        radius: {
          type: 'number',
          description: 'Search radius in blocks (5-200). Defaults to 64.',
        },
        count: {
          type: 'number',
          description: 'Max results to return (1-20). Defaults to 1.',
        },
      },
      required: [],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const radius = Math.min(Math.max(args.radius ?? DEFAULT_RADIUS, MIN_RADIUS), MAX_RADIUS);
      const count = Math.min(Math.max(args.count ?? DEFAULT_COUNT, 1), MAX_COUNT);

      const predicate = buildPredicate(args.type, args.type_filter);
      const results = findEntities(bot, predicate, radius, count);

      if (results.length === 0) {
        // List nearby entities for context
        const pos = bot.entity.position;
        const nearby = Object.values(bot.entities)
          .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(pos) < radius)
          .map((e) => {
            const name = e.name || e.displayName || 'unknown';
            const dist = Math.round(e.position.distanceTo(pos));
            return `${name}(${dist}m)`;
          })
          .slice(0, 10)
          .join(', ');

        const query = args.type || 'any entity';
        return `No "${query}" found within ${radius} blocks. Nearby entities: ${nearby || 'none'}. Try increasing radius or moving closer.`;
      }

      const lines = results.map((r, i) => `${i + 1}. ${formatEntity(r)}`);
      const header = `Found ${results.length} entr${results.length === 1 ? 'y' : 'ies'}:`;

      return `${header}\n${lines.join('\n')}\nUse approach() or attack_entity() with the entity name.`;
    },
  };
};
