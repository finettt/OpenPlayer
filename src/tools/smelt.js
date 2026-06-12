'use strict';

module.exports = function () {
  return {
    name: 'smelt',
    description:
      'Smelt items in a furnace. Must be near a furnace. ' +
      'Puts input items and fuel into furnace, waits for smelting to complete. ' +
      'Use for ores, raw food, sand→glass, etc.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item to smelt (e.g. raw_iron, raw_beef, cobblestone, sand).',
        },
        count: {
          type: 'number',
          description: 'How many to smelt (defaults to 1).',
        },
        fuel: {
          type: 'string',
          description: 'Fuel to use (e.g. coal, charcoal, planks). Defaults to any available fuel.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const count = args.count ?? 1;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');

      // Find nearby furnace using mineflayer's built-in block finder
      const mcData = require('minecraft-data')(bot.version);
      const furnaceIds = [mcData.blocksByName.furnace?.id, mcData.blocksByName.lit_furnace?.id].filter(Boolean);
      const furnaceBlock = (() => {
        if (furnaceIds.length === 0) return null;
        const found = bot.findBlocks({ matching: furnaceIds, maxDistance: 4, count: 1 });
        return found.length > 0 ? bot.blockAt(found[0]) : null;
      })();

      if (!furnaceBlock) {
        return 'Error: no furnace found within 4 blocks. Craft and place a furnace first.';
      }

      // Check we have the item to smelt
      const inputItem = bot.inventory.items().find((i) => i.name === itemName);
      if (!inputItem || inputItem.count < count) {
        const have = inputItem?.count ?? 0;
        return `Error: need ${count}x ${args.item} but only have ${have}.`;
      }

      // Find fuel
      const fuelTypes = ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks',
                         'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks',
                         'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks',
                         'coal_block', 'lava_bucket', 'blaze_rod'];
      let fuelItem = null;
      if (args.fuel) {
        const fuelName = args.fuel.toLowerCase().replace(/ /g, '_');
        fuelItem = bot.inventory.items().find((i) => i.name === fuelName);
        if (!fuelItem) {
          return `Error: fuel "${args.fuel}" not found in inventory.`;
        }
      } else {
        for (const f of fuelTypes) {
          fuelItem = bot.inventory.items().find((i) => i.name === f);
          if (fuelItem) break;
        }
      }

      if (!fuelItem) {
        return 'Error: no fuel found in inventory. Need coal, charcoal, planks, etc.';
      }

      // Open furnace and smelt
      let furnace;
      try {
        furnace = await bot.openFurnace(furnaceBlock);
      } catch (err) {
        return `Failed to open furnace: ${err.message}`;
      }

      try {
        // Put fuel in
        const fuelNeeded = Math.ceil(count / 8); // Each coal smelts 8 items
        const fuelToUse = Math.min(fuelNeeded, fuelItem.count);
        await furnace.putFuel(fuelItem.type, null, fuelToUse);

        // Put input items in
        await furnace.putInput(inputItem.type, null, count);

        // Wait for smelting (10 seconds per item, max 2 minutes)
        const waitTime = Math.min(count * 10000 + 2000, 120000);
        const started = Date.now();

        while (Date.now() - started < waitTime) {
          await new Promise((r) => setTimeout(r, 1000));
          const output = furnace.outputItem();
          if (output && output.count >= count) {
            break;
          }
          // Check if furnace stopped (no fuel or input)
          if (!furnace.inputItem() && !furnace.outputItem()) {
            break;
          }
        }

        // Take output
        const output = furnace.outputItem();
        if (output) {
          await furnace.takeOutput();
          furnace.close();
          return `Smelted ${output.count}x ${output.name}. Check inventory.`;
        }

        furnace.close();
        return `Smelting in progress. Items may still be cooking. Check furnace again later.`;
      } catch (err) {
        try { furnace.close(); } catch { /* ignore */ }
        return `Smelting failed: ${err.message}`;
      }
    },
  };
};
