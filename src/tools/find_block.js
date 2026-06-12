'use strict';

module.exports = function () {
  return {
    name: 'find_block',
    description:
      'Find the nearest block of a given type in loaded chunks. ' +
      'Use to locate chests, ores, trees, doors, etc. near your current position. ' +
      'Supports partial name matching (e.g. "log" matches oak_log, birch_log, etc.).',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Block type name (e.g. chest, oak_log, diamond_ore, stone_bricks).',
        },
        radius: {
          type: 'number',
          description: 'Search radius in blocks (10-100). Defaults to 50.',
        },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);
      const radius = Math.min(Math.max(args.radius ?? 50, 10), 100);
      const blockType = args.type.toLowerCase();

      // Resolve block IDs from the registry: exact match first, then substring
      const matchingIds = [];
      const exactBlock = mcData.blocksByName[blockType];
      if (exactBlock) {
        matchingIds.push(exactBlock.id);
      } else {
        for (const [name, block] of Object.entries(mcData.blocksByName)) {
          if (name.includes(blockType)) {
            matchingIds.push(block.id);
          }
        }
      }

      if (matchingIds.length === 0) {
        return `No block type matching "${args.type}" found in registry. Check the block name.`;
      }

      // Use mineflayer's built-in findBlocks — searches loaded chunks via block
      // state index instead of brute-force grid scanning
      const results = bot.findBlocks({
        matching: (block) => matchedNames.includes(block.name),
        maxDistance: radius,
        count: 1,
      });

      if (!results || results.length === 0) {
        return `No ${args.type} found within ${radius} blocks. Try increasing radius or moving closer.`;
      }

      const found = results[0];
      const dist = Math.round(bot.entity.position.distanceTo(found));

      return `Found ${args.type} at x=${found.x}, y=${found.y}, z=${found.z} (${dist}m away). Use approach() to get there.`;
    },
  };
};
