'use strict';

module.exports = function ({ vec3 }) {
  return {
    name: 'create_workbench',
    description:
      'Craft and place a crafting table (workbench) near your current position. ' +
      'Requires 4 planks in inventory. Use this before crafting tools/items that need a 3x3 grid.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);

      // Check if we have a crafting table already
      const craftingTableItem = bot.inventory.items().find((i) => i.name === 'crafting_table');
      if (!craftingTableItem) {
        // Need to craft one from planks
        const planks = bot.inventory.items().find((i) => i.name.includes('planks'));
        if (!planks || planks.count < 4) {
          return 'Error: need at least 4 planks to craft a crafting table. Gather wood first.';
        }

        const craftingTableType = mcData.itemsByName.crafting_table;
        if (!craftingTableType) {
          return 'Error: crafting_table not found in game data.';
        }

        const recipes = bot.recipesFor(craftingTableType.id, null, 1, null);
        if (recipes.length === 0) {
          return 'Error: no recipe found for crafting table with current inventory.';
        }

        try {
          await bot.craft(recipes[0], 1, null);
        } catch (err) {
          return `Failed to craft crafting table: ${err.message}`;
        }
      }

      const tableItem = bot.inventory.items().find((i) => i.name === 'crafting_table');
      if (!tableItem) {
        return 'Error: crafting table not in inventory after crafting attempt.';
      }

      // Find a suitable adjacent spot: air block with a solid block below
      const pos = bot.entity.position;
      const floorY = Math.floor(pos.y) - 1;

      for (const offset of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const checkPos = vec3(
          Math.floor(pos.x) + offset[0],
          floorY + 1,
          Math.floor(pos.z) + offset[1]
        );
        const blockAbove = bot.blockAt(checkPos);
        const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));

        if (
          blockAbove && blockAbove.name === 'air' &&
          blockBelow && blockBelow.name !== 'air'
        ) {
          try {
            await bot.equip(tableItem, 'hand');
            await bot.placeBlock(blockBelow, vec3(0, 1, 0));
            return `Placed crafting table at x=${checkPos.x}, y=${checkPos.y}, z=${checkPos.z}. Use approach() then craft() to use it.`;
          } catch (err) {
            // Server may not fire blockUpdate in time — verify directly
            await new Promise(r => setTimeout(r, 300));
            const check = bot.blockAt(checkPos);
            if (check && check.name === 'crafting_table') {
              return `Placed crafting table at x=${checkPos.x}, y=${checkPos.y}, z=${checkPos.z}. Use approach() then craft() to use it.`;
            }
            // Not placed — try next offset
          }
        }
      }

      return 'Could not find suitable spot to place crafting table. Clear some space around you.';
    },
  };
};