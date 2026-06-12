'use strict';

module.exports = function () {
  return {
    name: 'list_tools',
    description: 'List all available tools and their descriptions. Use when unsure what tools exist.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const fs = require('fs');
        return fs.readFileSync(ctx.config.storage.toolsFile, 'utf8').trim();
      } catch {
        return 'Error: could not load tools list.';
      }
    },
  };
};
