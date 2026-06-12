'use strict';

module.exports = function ({ vec3 }) {
  return {
    name: 'find_block',
    description:
      'Find the nearest block of a given type in loaded chunks. ' +
      'Use to locate chests, ores, trees, doors, etc. near your current position.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Block type name (e.g. chest, oak_log, diamond_ore, stone_bricks).',
        },
        radius: {
          type: 'number',
          description: 'Search radius in blocks (10-100). Defaults to 50.',
        },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const radius = Math.min(Math.max(args.radius ?? 50, 10), 100);
      const pos = bot.entity.position;

      const blockType = args.type.toLowerCase();
      let nearest = null;
      let nearestDist = Infinity;

      // Search in a grid pattern for efficiency
      const step = 2;
      for (let x = -radius; x <= radius; x += step) {
        for (let z = -radius; z <= radius; z += step) {
          if (x * x + z * z > radius * radius) continue;

          for (let y = -10; y <= 10; y += 2) {
            const checkPos = vec3(
              Math.round(pos.x + x),
              Math.round(pos.y + y),
              Math.round(pos.z + z)
            );
            const block = bot.blockAt(checkPos);
            if (block && block.name.includes(blockType)) {
              const dist = pos.distanceTo(checkPos);
              if (dist < nearestDist) {
                nearestDist = dist;
                nearest = checkPos;
              }
            }
          }
        }
      }

      if (!nearest) {
        return `No ${args.type} found within ${radius} blocks. Try increasing radius or moving closer.`;
      }

      return `Found ${args.type} at x=${nearest.x}, y=${nearest.y}, z=${nearest.z} (${Math.round(nearestDist)}m away). Use approach() to get there.`;
    },
  };
};
