'use strict';

module.exports = function () {
  return {
    name: 'drop_item',
    description:
      'Drop items from your inventory. ' +
      'Use to free inventory space, give items to players, or discard junk. ' +
      'If a target player is provided, or exactly one nearby player is detected, face them before dropping.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to drop (e.g. cobblestone, raw_iron, oak_planks).',
        },
        count: {
          type: 'number',
          description: 'How many to drop. Defaults to all matching items in inventory.',
        },
        username: {
          type: 'string',
          description: 'Optional player username to face before dropping the item to them.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const matchingItems = bot.inventory.items().filter((i) => i.name === itemName);

      if (matchingItems.length === 0) {
        return `Error: "${args.item}" not found in inventory. Use get_inventory to check.`;
      }

      const totalCount = matchingItems.reduce((sum, item) => sum + item.count, 0);
      const requestedCount = args.count == null ? totalCount : Math.floor(Number(args.count));
      if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
        return `Error: invalid count "${args.count}". Count must be a positive number.`;
      }

      const toDrop = Math.min(requestedCount, totalCount);
      const item = matchingItems[0];

      let targetPlayer = null;
      if (args.username) {
        targetPlayer = bot.players[args.username];
        if (!targetPlayer?.entity) {
          return `Error: player ${args.username} not found nearby.`;
        }
      } else {
        const nearbyPlayers = Object.values(bot.players).filter(
          (player) =>
            player.username !== bot.username &&
            player.entity &&
            player.entity.position.distanceTo(bot.entity.position) <= 6
        );
        if (nearbyPlayers.length === 1) {
          targetPlayer = nearbyPlayers[0];
        }
      }

      try {
        if (targetPlayer?.entity) {
          await bot.lookAt(targetPlayer.entity.position.offset(0, targetPlayer.entity.height * 0.6, 0), true);
          await new Promise((r) => setTimeout(r, 150));
        }

        await bot.toss(item.type, item.metadata ?? null, toDrop);
        await new Promise((r) => setTimeout(r, 300));

        const left = bot.inventory.items()
          .filter((i) => i.name === itemName)
          .reduce((sum, stack) => sum + stack.count, 0);

        const targetNote = targetPlayer?.username ? ` toward ${targetPlayer.username}` : '';
        return `Dropped ${toDrop}x ${itemName}${targetNote}. ${left > 0 ? `Still have ${left}x left.` : 'None left.'}`;
      } catch (err) {
        return `Failed to drop ${itemName}: ${err.message}`;
      }
    },
  };
};
