'use strict';

module.exports = function () {
  return {
    name: 'get_health_status',
    description:
      'Get current health, food level, and saturation. ' +
      'Use to check if you need to eat or heal.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      return [
        `Health: ${bot.health}/20 (${Math.round(bot.health / 2)} hearts)`,
        `Food: ${bot.food}/20`,
        `Saturation: ${bot.foodSaturation?.toFixed(1) ?? 'unknown'}`,
      ].join('\n');
    },
  };
};
