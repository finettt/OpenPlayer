'use strict';

module.exports = function ({ goals, Movements }) {
  return {
    name: 'follow_player',
    description:
      'Start following a player continuously. Use cancel_follow to stop.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to follow.' },
        distance: {
          type: 'number',
          description: 'Following distance in blocks (2-10). Defaults to 3.',
        },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const distance = Math.min(Math.max(args.distance ?? 3, 2), 10);

      // Cancel any existing follow
      if (bot._followInterval) {
        clearInterval(bot._followInterval);
        bot._followInterval = null;
      }
      bot.pathfinder.setGoal(null);

      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby.`;
      }

      bot.pathfinder.setMovements(new Movements(bot));
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, distance), true);

      bot._followInterval = setInterval(() => {
        const entity = bot.players[args.username]?.entity;
        if (!entity) {
          clearInterval(bot._followInterval);
          bot._followInterval = null;
          bot.pathfinder.setGoal(null);
          bot.emit('chat', bot.username, `[bot] Player ${args.username} went out of range. Stopped following.`);
          return;
        }
        // Update goal to track player's new position
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, distance), true);
      }, 500);

      return `Now following ${args.username}. Use cancel_follow to stop.`;
    },
  };
};
