'use strict';

module.exports = function () {
  return {
    name: 'get_surroundings',
    description:
      'Get a text summary of surroundings: position, time of day, health, nearby players and mobs. ' +
      'Cheaper alternative to a screenshot when an image is not needed.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const pos = bot.entity.position;
      const players = Object.values(bot.players)
        .filter((p) => p.username !== bot.username && p.entity)
        .map((p) => `${p.username} (${Math.round(p.entity.position.distanceTo(pos))}m)`);
      const mobs = Object.values(bot.entities)
        .filter((e) => e.type === 'hostile' && e.position.distanceTo(pos) < 16)
        .map((e) => e.name);

      return [
        `Position: x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}`,
        `Health: ${bot.health}/20, food: ${bot.food}/20`,
        `Time: ${bot.time.isDay ? 'day' : 'night'}`,
        `Nearby players: ${players.length ? players.join(', ') : 'none'}`,
        `Hostile mobs (<16m): ${mobs.length ? mobs.join(', ') : 'none'}`,
      ].join('\n');
    },
  };
};
