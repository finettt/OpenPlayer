'use strict';

module.exports = function () {
  return {
    name: 'cancel_lock_view',
    description: 'Stop locking your view on a player.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      if (bot._lockViewInterval) {
        clearInterval(bot._lockViewInterval);
        bot._lockViewInterval = null;
      }
      return 'Unlocked view.';
    },
  };
};
