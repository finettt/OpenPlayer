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

module.exports = function (deps) {
  return {
    name: 'send_message',
    description:
      'Send a message to the game chat. MUST use this to be heard by players. ' +
      'No more than 1-2 sentences. This does NOT end the reasoning loop.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message text (1-2 sentences).' },
      },
      required: ['message'],
    },
    async execute(args, ctx) {
      if (!args.message || !args.message.trim()) {
        return 'Error: empty message not sent.';
      }
      await ctx.sendChat(args.message);
      return 'Message sent to chat.';
    },
  };
};

module.exports.makeChatSender = makeChatSender;
