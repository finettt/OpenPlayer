'use strict';

module.exports = function () {
  return {
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
  };
};
