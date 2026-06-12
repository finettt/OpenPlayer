'use strict';

module.exports = function () {
  return {
    name: 'get_recipe',
    description:
      'Look up crafting recipes for an item. Shows required ingredients and whether a crafting table is needed. ' +
      'Use before crafting to check what materials you need.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to look up (e.g. wooden_pickaxe, furnace, iron_sword, chest).',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);

      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const itemType = mcData.itemsByName[itemName];
      if (!itemType) {
        return `Error: unknown item "${args.item}". Check spelling (use underscores, e.g. wooden_pickaxe).`;
      }

      // Get all recipes for this item (with and without table)
      const recipesWithTable = bot.recipesAll(itemType.id, null, true) || [];
      const recipesWithoutTable = bot.recipesAll(itemType.id, null, false) || [];

      // Deduplicate — combine both sets
      const allRecipes = [];
      const seen = new Set();
      for (const r of [...recipesWithoutTable, ...recipesWithTable]) {
        const key = JSON.stringify(r);
        if (!seen.has(key)) {
          seen.add(key);
          allRecipes.push(r);
        }
      }

      if (allRecipes.length === 0) {
        return `No crafting recipe found for ${args.item}. It may be obtained by mining, trading, or smelting instead.`;
      }

      const lines = [`Recipes for ${args.item} (${allRecipes.length} found):\n`];

      for (let i = 0; i < Math.min(allRecipes.length, 3); i++) {
        const recipe = allRecipes[i];
        const requiresTable = !recipesWithoutTable.some((r) => JSON.stringify(r) === JSON.stringify(recipe));

        lines.push(`Recipe ${i + 1}${requiresTable ? ' (needs crafting table)' : ' (2x2, no table needed)'}:`);

        // Collect ingredients from delta (ingredients consumed)
        const ingredients = {};
        if (recipe.delta) {
          for (const delta of recipe.delta) {
            if (delta.count < 0) {
              // Consumed item
              const ingItem = mcData.items[delta.id];
              const name = ingItem ? ingItem.name : `item_${delta.id}`;
              ingredients[name] = (ingredients[name] || 0) + Math.abs(delta.count);
            }
          }
        }

        // Fallback: parse inShape if delta is empty
        if (Object.keys(ingredients).length === 0 && recipe.inShape) {
          for (const row of recipe.inShape) {
            for (const cell of row) {
              if (cell && cell.id !== -1) {
                const ingItem = mcData.items[cell.id];
                const name = ingItem ? ingItem.name : `item_${cell.id}`;
                ingredients[name] = (ingredients[name] || 0) + (cell.count || 1);
              }
            }
          }
        }

        // Fallback: parse ingredients list
        if (Object.keys(ingredients).length === 0 && recipe.ingredients) {
          for (const ing of recipe.ingredients) {
            if (ing && ing.id !== -1) {
              const ingItem = mcData.items[ing.id];
              const name = ingItem ? ingItem.name : `item_${ing.id}`;
              ingredients[name] = (ingredients[name] || 0) + (ing.count || 1);
            }
          }
        }

        if (Object.keys(ingredients).length > 0) {
          lines.push('  Ingredients: ' + Object.entries(ingredients)
            .map(([name, count]) => `${count}x ${name}`)
            .join(', '));
        } else {
          lines.push('  Ingredients: (could not parse recipe)');
        }

        // Show result count
        const resultCount = recipe.result?.count ?? 1;
        if (resultCount > 1) {
          lines.push(`  Yields: ${resultCount}x ${args.item}`);
        }

        // Check if player has materials
        const missing = [];
        for (const [name, needed] of Object.entries(ingredients)) {
          const have = bot.inventory.items()
            .filter((it) => it.name === name)
            .reduce((sum, it) => sum + it.count, 0);
          if (have < needed) {
            missing.push(`${needed - have}x ${name}`);
          }
        }
        if (missing.length > 0) {
          lines.push(`  Missing: ${missing.join(', ')}`);
        } else if (Object.keys(ingredients).length > 0) {
          lines.push('  ✓ You have all materials!');
        }

        lines.push('');
      }

      return lines.join('\n').trim();
    },
  };
};
