'use strict';

module.exports = function ({ goals, Movements }) {
  return {
    name: 'go_to_y',
    description:
      'Navigate to a specific Y level (height). ' +
      'Use for going up mountains, down caves, or to bedrock/sky limit. ' +
      'Pathfinder will find the closest reachable Y at any X/Z.',
    parameters: {
      type: 'object',
      properties: {
        y: { type: 'number', description: 'Target Y level (height). Min: 1, Max: 319.' },
      },
      required: ['y'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const targetY = Math.min(Math.max(args.y, 1), 319);

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalY(targetY), true);

        const timeout = 45000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const currentY = Math.round(bot.entity.position.y);
          if (Math.abs(currentY - targetY) <= 1) {
            bot.pathfinder.setGoal(null);
            const pos = bot.entity.position;
            return `Reached Y=${currentY} at x=${Math.round(pos.x)}, z=${Math.round(pos.z)}.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at Y=${Math.round(pos.y)}. Could not reach Y=${targetY} (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  };
};
