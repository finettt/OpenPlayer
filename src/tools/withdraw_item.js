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

function countInventorySlots(bot) {
  // Count free main inventory slots (9-35)
  let free = 0;
  for (let i = 9; i <= 35; i++) {
    if (!bot.inventory.slots[i]) free++;
  }
  return free;
}

function getMaxWithdrawable(bot, itemName) {
  const mcData = require('minecraft-data')(bot.version);
  const itemType = mcData.itemsByName[itemName];
  const maxStack = itemType ? itemType.maxStack : 64;

  // Count existing stacks of this item in inventory
  let existingStacks = 0;
  let existingCount = 0;
  for (let i = 9; i <= 44; i++) {
    const slot = bot.inventory.slots[i];
    if (slot && slot.name === itemName) {
      existingStacks++;
      existingCount += slot.count;
    }
  }

  // Free slots that can hold new stacks
  let freeSlots = 0;
  for (let i = 9; i <= 35; i++) {
    if (!bot.inventory.slots[i]) freeSlots++;
  }

  // Room in existing partial stacks
  let roomInExisting = 0;
  for (let i = 9; i <= 44; i++) {
    const slot = bot.inventory.slots[i];
    if (slot && slot.name === itemName && slot.count < maxStack) {
      roomInExisting += maxStack - slot.count;
    }
  }

  // New stacks in free slots
  const roomInNew = freeSlots * maxStack;

  return roomInExisting + roomInNew;
}

module.exports = function () {
  return {
    name: 'withdraw_item',
    description:
      'Withdraw items from a nearby chest into your inventory. ' +
      'Finds the closest chest, opens it, and moves the specified item(s) into your inventory. ' +
      'Partial item names work (e.g. "sword" withdraws the best matching sword). ' +
      'If count is not specified, withdraws as many as will fit. ' +
      'Returns error if item not found in chest or inventory is full.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'Item name to withdraw (e.g. dirt, iron_ingot, oak_planks). ' +
            'Partial names work (e.g. "pickaxe" withdraws the best pickaxe).',
        },
        count: {
          type: 'number',
          description:
            'How many to withdraw (defaults to as many as will fit). ' +
            'Capped by inventory space and stack limits.',
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

      // Find nearest chest
      const chestBlock = findNearestChest(bot, radius);
      if (!chestBlock) {
        return `No chest found within ${radius} blocks.`;
      }

      const dist = bot.entity.position.distanceTo(chestBlock.position);
      if (dist > 5) {
        return `Chest too far (${Math.round(dist)}m). Move closer first (use approach or go_to).`;
      }

      // Snapshot full inventory BEFORE opening chest (while window is closed, bot.inventory is reliable)
      const invSnapshot = {};
      for (const item of bot.inventory.items()) {
        invSnapshot[item.name] = (invSnapshot[item.name] ?? 0) + item.count;
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

      // Read container slots from bot.currentWindow (same pattern as open_chest)
      const currentWindow = bot.currentWindow;
      if (!currentWindow) {
        return 'Container was closed unexpectedly.';
      }

      const containerSlotsCount = currentWindow.slots.length - 36;
      const chestItems = currentWindow.slots.slice(0, containerSlotsCount).filter(item => item !== null);

      // Find matching items in chest
      const matches = chestItems.filter((item) => {
        return item.name === itemName || item.name.includes(itemName);
      });

      if (matches.length === 0) {
        const chestContents = chestItems.map((i) => `${i.name} x${i.count}`);
        chest.close();
        return `Error: "${args.item}" not found in chest. Chest contains: ${chestContents.length ? chestContents.join(', ') : 'nothing'}`;
      }

      // Pick best match if partial name
      let target = matches[0];
      if (matches.length > 1) {
        target = matches.reduce((best, cur) =>
          tierScore(cur.name) > tierScore(best.name) ? cur : best,
        );
      }

      // Count only items matching the chosen target (not all partial matches)
      const totalInChest = chestItems
        .filter((item) => item.name === target.name)
        .reduce((sum, item) => sum + item.count, 0);

      // Calculate max withdrawable
      const maxFit = getMaxWithdrawable(bot, target.name);
      if (maxFit <= 0) {
        chest.close();
        return `Error: inventory full. No space to withdraw ${target.name}.`;
      }

      const toWithdraw = requestedCount
        ? Math.min(requestedCount, totalInChest, maxFit)
        : Math.min(totalInChest, maxFit);

      try {
        await chest.withdraw(target.type, target.metadata ?? null, toWithdraw);
      } catch (err) {
        // chest.withdraw() can throw even when the item was actually moved
        // (internal verification fails because slot already updated).
        // Close chest and verify inventory to confirm actual result.
      }

      // Close chest BEFORE checking inventory — while window is open,
      // bot.inventory.items() may not reflect items that moved from the container.
      try { chest.close(); } catch { /* ignore */ }

      // Wait for inventory to sync after window closes
      await new Promise((r) => setTimeout(r, 200));

      const invAfter = bot.inventory.items()
        .filter((i) => i.name === target.name)
        .reduce((sum, i) => sum + i.count, 0);
      const invBefore = invSnapshot[target.name] ?? 0;
      const withdrawn = invAfter - invBefore;

      const label = target.name === itemName
        ? target.name
        : `${target.name} (matched "${args.item}")`;

      if (withdrawn > 0) {
        return `Withdrew ${withdrawn}x ${label} from chest.`;
      }

      return `Could not withdraw ${label}. It may no longer be in the chest or inventory is full.`;
    },
  };
};

function findNearestChest(bot, radius) {
  const chestNames = ['chest', 'trapped_chest'];
  const matching = (block) => chestNames.includes(block.name);

  const found = bot.findBlocks({ matching, maxDistance: radius, count: 1 });
  if (found.length === 0) return null;
  return bot.blockAt(found[0]);
}

