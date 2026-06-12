'use strict';

module.exports = function ({ vec3 }) {
  return {
    name: 'break_block',
    description:
      'Break a block at given coordinates. Auto-selects best tool from inventory. ' +
      'Use for mining ores, gathering wood, clearing paths, etc.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Block X coordinate.' },
        y: { type: 'number', description: 'Block Y coordinate.' },
        z: { type: 'number', description: 'Block Z coordinate.' },
      },
      required: ['x', 'y', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const pos = vec3(args.x, args.y, args.z);
      const block = bot.blockAt(pos);
      if (!block) {
        return `No block found at x=${args.x}, y=${args.y}, z=${args.z} (chunk not loaded?).`;
      }

      // Check distance
      const dist = bot.entity.position.distanceTo(pos);
      if (dist > 6) {
        return `Block too far (${Math.round(dist)}m). Move closer first (max ~6m).`;
      }

      try {
        await bot.dig(block);
        return `Broke ${block.name} at x=${args.x}, y=${args.y}, z=${args.z}.`;
      } catch (err) {
        return `Failed to break ${block.name}: ${err.message}`;
      }
    },
  };
};
