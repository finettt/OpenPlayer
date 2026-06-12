'use strict';

module.exports = function ({ vec3 }) {
  return {
    name: 'interact',
    description:
      'Right-click a block. Use for doors, levers, buttons, chests, crafting tables, furnaces, beds, etc.',
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
        return `No block found at x=${args.x}, y=${args.y}, z=${args.z}.`;
      }

      const dist = bot.entity.position.distanceTo(pos);
      if (dist > 5) {
        return `Block too far (${Math.round(dist)}m). Move closer first.`;
      }

      try {
        await bot.activateBlock(block);
        return `Right-clicked ${block.name} at x=${args.x}, y=${args.y}, z=${args.z}.`;
      } catch (err) {
        return `Failed to interact with ${block.name}: ${err.message}`;
      }
    },
  };
};
