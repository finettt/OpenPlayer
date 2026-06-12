'use strict';

module.exports = function () {
  return {
    name: 'take_screenshot',
    description:
      'Take a screenshot of what is in front of you. After receiving the photo, respond to the player via send_message.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const base64 = await ctx.camera.screenshot();
      return { type: 'image', base64, note: 'Screenshot taken, image in the next message.' };
    },
  };
};
