'use strict';

module.exports = function ({ vec3, goals, Movements }) {
  return {
    name: 'go_to',
    description:
      'Navigate to target coordinates using pathfinding. ' +
      'Use for going to specific locations, buildings, players, etc.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Target X coordinate.' },
        y: { type: 'number', description: 'Target Y coordinate (optional, uses current Y if omitted).' },
        z: { type: 'number', description: 'Target Z coordinate.' },
      },
      required: ['x', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const currentY = args.y ?? Math.round(bot.entity.position.y);
      const target = vec3(args.x, currentY, args.z);

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalNear(args.x, currentY, args.z, 2), true);

        const timeout = 30000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const dist = bot.entity.position.distanceTo(target);
          if (dist < 3) {
            bot.pathfinder.setGoal(null);
            const pos = bot.entity.position;
            return `Arrived at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}. Could not reach target (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  };
};
