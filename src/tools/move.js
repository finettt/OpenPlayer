'use strict';

module.exports = function () {
  return {
    name: 'move',
    description:
      'Move in a direction for a duration. ' +
      'Use for short movements like stepping forward, backing away, strafing.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['forward', 'backward', 'left', 'right'],
          description: 'Direction to move relative to where you are looking.',
        },
        duration: {
          type: 'number',
          description: 'How long to move in seconds (0.5-5).',
        },
      },
      required: ['direction', 'duration'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const duration = Math.min(Math.max(args.duration, 0.5), 5) * 1000;

      if (args.direction === 'left' || args.direction === 'right') {
        // Strafe: turn 90 degrees, move forward, turn back
        const yaw = bot.entity.yaw;
        if (args.direction === 'left') {
          await bot.look(null, yaw + Math.PI / 2);
        } else {
          await bot.look(null, yaw - Math.PI / 2);
        }
      }

      bot.setControlState(args.direction === 'backward' ? 'back' : 'forward', true);
      await new Promise((r) => setTimeout(r, duration));
      bot.setControlState('forward', false);
      bot.setControlState('back', false);

      const pos = bot.entity.position;
      return `Moved ${args.direction} for ${args.duration}s. Now at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
    },
  };
};
