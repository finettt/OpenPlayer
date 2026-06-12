'use strict';

module.exports = function ({ vec3, goals, Movements }) {
  return {
    name: 'goto_player',
    description:
      'Navigate to a player and automatically stop when you reach them. ' +
      'Unlike follow_player, this is a one-shot move — it arrives and stops. ' +
      'Use for walking up to someone to talk, trade, or give items.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to go to.' },
        distance: {
          type: 'number',
          description: 'How close to get (in blocks, 1-10). Defaults to 2.',
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to spend navigating (5-60). Defaults to 30.',
        },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby (out of range or not online).`;
      }

      const distance = Math.min(Math.max(args.distance ?? 2, 1), 10);
      const timeout = Math.min(Math.max(args.timeout ?? 30, 5), 60) * 1000;

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(
          new goals.GoalNear(
            player.entity.position.x,
            player.entity.position.y,
            player.entity.position.z,
            distance
          ),
          true
        );

        const started = Date.now();
        while (Date.now() - started < timeout) {
          // Re-fetch entity in case they moved
          const entity = bot.players[args.username]?.entity;
          if (!entity) {
            bot.pathfinder.setGoal(null);
            return `Player ${args.username} went out of range while navigating.`;
          }

          const dist = bot.entity.position.distanceTo(entity.position);
          if (dist <= distance + 0.5) {
            bot.pathfinder.setGoal(null);
            // Face the player on arrival
            await bot.lookAt(entity.position.offset(0, entity.height, 0));
            const pos = bot.entity.position;
            return `Arrived at player ${args.username} (${Math.round(dist)}m away) at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
          }

          // Update goal to track player movement
          bot.pathfinder.setGoal(
            new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, distance),
            true
          );
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        const entity = bot.players[args.username]?.entity;
        const remaining = entity ? Math.round(bot.entity.position.distanceTo(entity.position)) : '?';
        return `Timed out navigating to ${args.username}. Stopped at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)} (${remaining}m away). Try again or move manually.`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation to ${args.username} failed: ${err.message}`;
      }
    },
  };
};
