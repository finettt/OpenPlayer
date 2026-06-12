'use strict';

module.exports = function ({ goals, Movements }) {
  return {
    name: 'approach',
    description:
      'Navigate adjacent to a specific block. ' +
      'Use for chests, crafting tables, doors, furnaces, levers — anything you need to interact with.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Block X coordinate.' },
        y: { type: 'number', description: 'Block Y coordinate (optional, uses current Y).' },
        z: { type: 'number', description: 'Block Z coordinate.' },
      },
      required: ['x', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const blockY = args.y ?? Math.round(bot.entity.position.y);

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalGetToBlock(args.x, blockY, args.z), true);

        const timeout = 30000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const pos = bot.entity.position;
          const dist = Math.sqrt(
            Math.pow(pos.x - args.x, 2) +
            Math.pow(pos.z - args.z, 2)
          );
          if (dist < 2.5) {
            bot.pathfinder.setGoal(null);
            return `Approached block at x=${args.x}, y=${blockY}, z=${args.z}. Ready to interact.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at x=${Math.round(pos.x)}, z=${Math.round(pos.z)}. Could not approach target (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  };
};
