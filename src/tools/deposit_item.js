'use strict';

/**
 * Known tool/weapon material tiers in ascending order of quality.
 */
const TOOL_TIERS = ['wooden', 'stone', 'golden', 'iron', 'diamond', 'netherite'];
const ARMOR_TIERS = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite'];

function tierScore(name) {
  let score = 0;
  for (let i = 0; i < TOOL_TIERS.length; i++) {
    if (name.startsWith(TOOL_TIERS[i] + '_')) score += i;
  }
  for (let i = 0; i < ARMOR_TIERS.length; i++) {
    if (name.startsWith(ARMOR_TIERS[i] + '_')) score += i;
  }
  return score;
}

function findBestMatch(items, searchName) {
  const norm = searchName.toLowerCase().replace(/ /g, '_');

  const exact = items.filter((i) => i.name === norm);
  if (exact.length > 0) {
    return exact.reduce((best, cur) =>
      tierScore(cur.name) > tierScore(best.name) ? cur : best,
    );
  }

  const suffix = items.filter((i) => i.name.endsWith('_' + norm));
  if (suffix.length > 0) {
    return suffix.reduce((best, cur) =>
      tierScore(cur.name) > tierScore(best.name) ? cur : best,
    );
  }

  const contains = items.filter((i) => i.name.includes(norm));
  if (contains.length > 0) {
    return contains.reduce((best, cur) =>
      tierScore(cur.name) > tierScore(best.name) ? cur : best,
    );
  }

  return null;
}

module.exports = function () {
  return {
    name: 'deposit_item',
    description:
      'Deposit items from your inventory into a nearby chest. ' +
      'Finds the closest chest, opens it, and moves the specified item(s) inside. ' +
      'Partial item names work (e.g. "sword" deposits the best matching sword). ' +
      'If count is not specified, deposits all matching items. ' +
      'Respects inventory stack limits and merges where possible.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'Item name to deposit (e.g. dirt, iron_ingot, oak_planks). ' +
            'Partial names work (e.g. "pickaxe" deposits the best pickaxe).',
        },
        count: {
          type: 'number',
          description:
            'How many to deposit (defaults to all matching items). ' +
            'Respects stack sizes — will use multiple slots if needed.',
        },
        radius: {
          type: 'number',
          description: 'Search radius for chest in blocks (1-64). Defaults to 16.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const requestedCount = args.count ?? null;
      const radius = Math.min(Math.max(args.radius ?? 16, 1), 64);

      // Find item in inventory
      const invItems = bot.inventory.items();
      const match = findBestMatch(invItems, itemName);
      if (!match) {
        const available = invItems.map((i) => `${i.name} x${i.count}`).join(', ') || 'empty';
        return `Error: "${args.item}" not found in inventory. Available: ${available}`;
      }

      const totalHave = invItems
        .filter((i) => i.name === match.name)
        .reduce((sum, i) => sum + i.count, 0);
      const toDeposit = requestedCount ? Math.min(requestedCount, totalHave) : totalHave;

      // Find nearest chest
      const chestBlock = findNearestChest(bot, radius);
      if (!chestBlock) {
        return `No chest found within ${radius} blocks.`;
      }

      const dist = bot.entity.position.distanceTo(chestBlock.position);
      if (dist > 5) {
        return `Chest too far (${Math.round(dist)}m). Move closer first (use approach or go_to).`;
      }

      let chest;
      try {
        chest = await bot.openContainer(chestBlock);
      } catch (err) {
        return `Failed to open chest: ${err.message}`;
      }

      // Wait for all slot data from server (debounced — resolves after last updateSlot + 100ms)
      await new Promise((resolve) => {
        let timer = setTimeout(resolve, 600);
        chest.on('updateSlot', () => {
          clearTimeout(timer);
          timer = setTimeout(resolve, 100);
        });
      });

      // chest.deposit() can throw even when items were actually moved
      // (internal verification fails because slot already updated).
      // Catch the error and verify inventory to confirm actual result.
      try {
        await chest.deposit(match.type, match.metadata ?? null, toDeposit);
      } catch { /* ignore — verify below */ }

      // Close chest BEFORE checking inventory — while window is open,
      // bot.inventory.items() may not properly reflect moved items.
      try { chest.close(); } catch { /* ignore */ }

      // Wait for inventory to sync after window closes
      await new Promise((r) => setTimeout(r, 200));

      const remainingInInv = bot.inventory.items()
        .filter((i) => i.name === match.name)
        .reduce((sum, i) => sum + i.count, 0);
      const deposited = totalHave - remainingInInv;

      const label = match.name === itemName ? match.name : `${match.name} (matched "${args.item}")`;

      if (deposited > 0) {
        if (remainingInInv > 0) {
          return `Deposited ${deposited}x ${label}. Still have ${remainingInInv}x in inventory (chest may be full).`;
        }
        return `Deposited ${deposited}x ${label} into chest.`;
      }

      return `Could not deposit ${label}. Chest may be full or no valid slots available.`;
    },
  };
};

function findNearestChest(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);
  const chestNames = ['chest', 'trapped_chest'];
  const matching = (block) => chestNames.includes(block.name);

  const found = bot.findBlocks({ matching, maxDistance: radius, count: 1 });
  if (found.length === 0) return null;
  return bot.blockAt(found[0]);
}

