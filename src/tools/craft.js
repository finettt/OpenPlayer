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
          description: 'How many items to produce (defaults to 1). Automatically calculates crafting repetitions based on recipe yield.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);
      const desiredCount = args.count ?? 1;

      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const itemType = mcData.itemsByName[itemName];
      if (!itemType) {
        return `Error: unknown item "${args.item}". Check spelling (use underscores, e.g. wooden_pickaxe).`;
      }

      // Find nearby crafting table
      let craftingTable = null;
      const found = bot.findBlocks({
        matching: (block) => block.name === 'crafting_table',
        maxDistance: 6,
        count: 1,
      });
      if (found.length > 0) craftingTable = bot.blockAt(found[0]);

      // Get all recipes regardless of inventory (recipesFor has broken inventory check)
      let recipes = bot.recipesAll(itemType.id, null, craftingTable);
      if (recipes.length === 0 && craftingTable) {
        recipes = bot.recipesAll(itemType.id, null, null);
      }
      if (recipes.length === 0) {
        return `Error: no recipe found for ${args.item}. Either missing materials or need a crafting table nearby.`;
      }

      // How many items a single recipe execution produces
      const getResultCount = (recipe) => {
        if (recipe.delta) {
          for (const d of recipe.delta) {
            if (d.count > 0) return d.count;
          }
        }
        return recipe.result?.count ?? 1;
      };

      // Extract ingredient requirements for one recipe execution
      const getIngredients = (recipe) => {
        const result = {};
        if (recipe.delta) {
          for (const d of recipe.delta) {
            if (d.count < 0) {
              const item = mcData.items[d.id];
              const name = item ? item.name : `item_${d.id}`;
              result[name] = (result[name] || 0) + Math.abs(d.count);
            }
          }
        } else if (recipe.inShape) {
          for (const row of recipe.inShape) {
            for (const cell of row) {
              if (cell && cell.id !== -1) {
                const item = mcData.items[cell.id];
                const name = item ? item.name : `item_${cell.id}`;
                result[name] = (result[name] || 0) + (cell.count || 1);
              }
            }
          }
        } else if (recipe.ingredients) {
          for (const ing of recipe.ingredients) {
            if (ing && ing.id !== -1) {
              const item = mcData.items[ing.id];
              const name = item ? item.name : `item_${ing.id}`;
              result[name] = (result[name] || 0) + (ing.count || 1);
            }
          }
        }
        return result;
      };

      // Check if bot has enough ingredients for the required number of craft executions
      const hasIngredients = (recipe) => {
        const rc = getResultCount(recipe);
        // ✅ craftTimes = how many times to run the recipe to produce desiredCount items
        const craftTimes = Math.ceil(desiredCount / rc);
        const ingredients = getIngredients(recipe);
        return Object.entries(ingredients).every(([name, neededPerCraft]) => {
          const have = bot.inventory.items()
            .filter(i => i.name === name)
            .reduce((sum, i) => sum + i.count, 0);
          return have >= neededPerCraft * craftTimes;
        });
      };

      // Pick first recipe we have ingredients for
      let recipe = recipes.find(r => {
        if (r.requiresTable && !craftingTable) return false;
        return hasIngredients(r);
      });

      // Fallback: any usable recipe (bot.craft will report the real error)
      if (!recipe) {
        recipe = recipes.find(r => !r.requiresTable || craftingTable);
      }

      if (!recipe) {
        return `Error: no recipe found for ${args.item}. Either missing materials or need a crafting table nearby.`;
      }

      if (recipe.requiresTable && !craftingTable) {
        return `Error: no recipe found for ${args.item}. Either missing materials or need a crafting table nearby.`;
      }

      const useTable = recipe.requiresTable ? craftingTable : null;

      // ✅ bot.craft() expects number of recipe executions, not number of output items
      const resultCount = getResultCount(recipe);
      const craftTimes = Math.ceil(desiredCount / resultCount);

      try {
        await bot.craft(recipe, craftTimes, useTable);
        const crafted = bot.inventory.items().find((i) => i.name === itemName);
        const newCount = crafted ? crafted.count : 0;
        return `Crafted ${args.item}. Now have ${newCount}x ${args.item} in inventory.`;
      } catch (err) {
        return `Failed to craft ${args.item}: ${err.message}`;
      }
    },
  };
};