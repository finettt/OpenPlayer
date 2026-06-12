'use strict';

module.exports = function () {
  return {
    name: 'craft',
    description:
      'Craft an item. For 3x3 recipes (tools, armor, etc.), you must be near a crafting table. ' +
      'For 2x2 recipes (planks, sticks, torches), no table needed. ' +
      'Returns error if missing materials or recipe not found.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to craft (e.g. oak_planks, stick, wooden_pickaxe, furnace).',
        },
        count: {
          type: 'number',
          description: 'How many to craft (defaults to 1). May craft more if recipe yields multiple.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);
      const count = args.count ?? 1;

      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const itemType = mcData.itemsByName[itemName];
      if (!itemType) {
        return `Error: unknown item "${args.item}". Check spelling (use underscores, e.g. wooden_pickaxe).`;
      }

      // Find nearby crafting table using mineflayer's built-in block finder
      const craftingTableBlockType = mcData.blocksByName.crafting_table;
      let craftingTable = null;
      if (craftingTableBlockType) {
        const found = bot.findBlocks({ matching: craftingTableBlockType.id, maxDistance: 4, count: 1 });
        if (found.length > 0) craftingTable = bot.blockAt(found[0]);
      }

      // Get recipes - try with crafting table first, then without
      let recipes = bot.recipesFor(itemType.id, null, count, craftingTable);
      if (recipes.length === 0 && craftingTable) {
        // Maybe it's a 2x2 recipe, try without table
        recipes = bot.recipesFor(itemType.id, null, count, null);
      }
      if (recipes.length === 0 && !craftingTable) {
        // No table nearby and no 2x2 recipe found
        return `Error: no recipe found for ${args.item}. Either missing materials or need a crafting table nearby.`;
      }
      if (recipes.length === 0) {
        return `Error: no recipe found for ${args.item} with current inventory. Check materials.`;
      }

      // Use first available recipe
      const recipe = recipes[0];
      const useTable = recipe.requiresTable ? craftingTable : null;

      try {
        await bot.craft(recipe, count, useTable);
        const crafted = bot.inventory.items().find((i) => i.name === itemName);
        const newCount = crafted ? crafted.count : 0;
        return `Crafted ${args.item}. Now have ${newCount}x ${args.item} in inventory.`;
      } catch (err) {
        return `Failed to craft ${args.item}: ${err.message}`;
      }
    },
  };
};
