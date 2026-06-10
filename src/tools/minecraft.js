'use strict';

function makeChatSender(bot, config, logger) {
  let lastSentAt = 0;
  return async (text) => {
    const now = Date.now();
    const wait = config.agent.chatRateLimitMs - (now - lastSentAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSentAt = Date.now();

    const trimmed = String(text).slice(0, config.agent.chatMaxLength);
    if (trimmed.length < String(text).length) {
      logger.debug('Message truncated to chat limit');
    }
    bot.chat(trimmed);
  };
}

function registerTools(registry, config) {
  registry.register({
    name: 'send_message',
    description:
      'Send a message to the game chat. MUST use this to be heard by players. ' +
      'No more than 1-2 sentences.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message text (1-2 sentences).' },
      },
      required: ['message'],
    },
    final: true,
    async execute(args, ctx) {
      if (!args.message || !args.message.trim()) {
        return 'Error: empty message not sent.';
      }
      await ctx.sendChat(args.message);
      return 'Message sent to chat.';
    },
  });

  registry.register({
    name: 'take_screenshot',
    description:
      'Take a screenshot of what is in front of you. After receiving the photo, respond to the player via send_message.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const base64 = await ctx.camera.screenshot();
      return { type: 'image', base64, note: 'Screenshot taken, image in the next message.' };
    },
  });

  registry.register({
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
  });

  registry.register({
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
  });

  registry.register({
    name: 'remember',
    description:
      'Save an important fact to long-term memory (survives restart). ' +
      'Use for player facts, building coordinates, etc.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'Fact to remember.' },
      },
      required: ['fact'],
    },
    async execute(args, ctx) {
      ctx.session.remember(args.fact);
      return 'Fact saved to long-term memory.';
    },
  });
}

module.exports = { registerTools, makeChatSender };
