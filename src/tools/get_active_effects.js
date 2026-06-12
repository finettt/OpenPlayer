'use strict';

module.exports = function () {
  return {
    name: 'get_active_effects',
    description:
      'List active potion effects with duration and amplifier. ' +
      'Use to track buffs/debuffs during combat or exploration.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const effects = bot.entity.effects;
      if (!effects || Object.keys(effects).length === 0) {
        return 'No active potion effects.';
      }

      const mcData = require('minecraft-data');
      const effectsMap = mcData(bot.version)?.effects || {};

      const lines = [];
      for (const id of Object.keys(effects)) {
        const eff = effects[id];
        const info = effectsMap[id] || { name: `Unknown(${id})`, type: '?' };
        const amp = eff.amplifier > 0 ? ` ${'Ⅰ'.repeat(eff.amplifier + 1)}` : '';
        const secs = Math.ceil(eff.duration / 20);
        lines.push(`${info.name}${amp}: ${secs}s (${info.type})`);
      }
      return lines.join('\n');
    },
  };
};
