'use strict';

module.exports = function () {
  return {
    name: 'lock_view',
    description:
      'Lock your view on a player, continuously looking at them. Use cancel_lock_view to stop.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to look at.' },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;

      // Cancel any existing lock_view
      if (bot._lockViewInterval) {
        clearInterval(bot._lockViewInterval);
        bot._lockViewInterval = null;
      }

      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby.`;
      }

      bot._lockViewInterval = setInterval(() => {
        const entity = bot.players[args.username]?.entity;
        if (!entity) {
          clearInterval(bot._lockViewInterval);
          bot._lockViewInterval = null;
          return;
        }
        try {
          bot.lookAt(entity.position.offset(0, entity.height, 0));
        } catch {
          // lookAt may fail, continue trying
        }
      }, 200);

      return `Now locking view on ${args.username}. Use cancel_lock_view to stop.`;
    },
  };
};
