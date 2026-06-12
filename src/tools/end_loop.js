'use strict';

module.exports = function () {
  return {
    name: 'end_loop',
    description:
      'Finish the current reasoning loop. Call this only when you are completely done with all actions and messages for the current user request.',
    parameters: { type: 'object', properties: {} },
    final: true,
    async execute() {
      return 'Loop ended.';
    },
  };
};
