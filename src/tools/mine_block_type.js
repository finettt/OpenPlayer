'use strict';

const { mineBlocks, STOP_REASON_LABELS } = require('./mining_orchestrator');

module.exports = function ({ vec3, goals, Movements }) {
  return {
    name: 'mine_block_type',
    description:
      'Gather N blocks of a given type. Handles navigation, tool equipping, and item collection automatically. ' +
      'Use for resource gathering: wood, stone, coal, iron ore, etc. ' +
      'Supports partial name matching (e.g. "log" matches oak_log, birch_log, etc.). ' +
      'IMPORTANT: Does NOT auto-craft tools. If the output says a tool is needed or broke, ' +
      'you MUST craft and equip the required tool before calling this again.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Block type to mine (e.g. oak_log, stone, coal_ore, iron_ore). ' +
            'Partial names work: "log" matches any log variant.',
        },
        count: {
          type: 'number',
          description: 'Number of blocks to gather (1-64). Defaults to 1.',
        },
        radius: {
          type: 'number',
          description: 'Search radius in blocks (10-128). Defaults to 50.',
        },
        timeout: {
          type: 'number',
          description: 'Maximum seconds to spend mining (30-300). Defaults to 120.',
        },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const config = ctx.config;
      const mcData = require('minecraft-data')(bot.version);

      if (!bot.collectBlock) {
        return 'Error: mineflayer-collectblock plugin not loaded. Cannot collect blocks.';
      }

      const log = ctx.log || { info: () => {}, warn: console.warn, error: console.error };

      const result = await mineBlocks(bot, mcData, {
        type: args.type,
        count: args.count ?? 1,
        radius: args.radius ?? 50,
        timeout: args.timeout ?? 120,
      }, config, log);

      // Build summary using uniform label dispatch
      const label = STOP_REASON_LABELS[result.stopReason];
      const parts = [typeof label === 'function' ? label(result) : `Stopped: ${result.stopReason}.`];

      if (result.unreachable > 0) {
        parts.push(`${result.unreachable} block(s) were unreachable.`);
      }

      parts.push(`Time: ${result.elapsed}s.`);

      return parts.join(' ');
    },
  };
};