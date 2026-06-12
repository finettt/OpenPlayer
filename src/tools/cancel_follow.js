'use strict';

module.exports = function () {
  return {
    name: 'cancel_follow',
    description: 'Stop following a player.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      if (bot._followInterval) {
        clearInterval(bot._followInterval);
        bot._followInterval = null;
      }
      bot.pathfinder.setGoal(null);
      return 'Stopped following.';
    },
  };
};
