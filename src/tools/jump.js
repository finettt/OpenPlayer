'use strict';

module.exports = function () {
  return {
    name: 'jump',
    description: 'Jump. Use for getting over obstacles, blocks, or gaps.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 400));
      bot.setControlState('jump', false);
      return 'Jumped.';
    },
  };
};
