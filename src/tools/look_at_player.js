'use strict';

module.exports = function () {
  return {
    name: 'look_at_player',
    description: 'Turn to face a player (useful before taking a screenshot to see what they are showing).',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username.' },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const player = ctx.bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby (out of range).`;
      }
      const pos = player.entity.position.offset(0, player.entity.height, 0);
      await ctx.bot.lookAt(pos);
      return `Turned to face player ${args.username}.`;
    },
  };
};
