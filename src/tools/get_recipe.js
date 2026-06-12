'use strict';

/**
 * Extract ingredients from a recipe object.
 * Returns a map of { itemName: count } for consumed items.
 */
function extractIngredients(recipe, mcData) {
  const ingredients = {};

  // Primary: use delta (items consumed = negative counts)
  if (recipe.delta) {
    for (const delta of recipe.delta) {
      if (delta.count < 0) {
        const ingItem = mcData.items[delta.id];
        const name = ingItem ? ingItem.name : `item_${delta.id}`;
        ingredients[name] = (ingredients[name] || 0) + Math.abs(delta.count);
      }
    }
  }

  // Fallback: parse inShape
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

  return ingredients;
}

/**
 * Get the result count from a recipe (how many items the recipe produces).
 */
function getResultCount(recipe, itemName) {
  if (recipe.delta) {
    for (const delta of recipe.delta) {
      if (delta.count > 0) {
        return delta.count;
      }
    }
  }
  if (recipe.result && recipe.result.count) {
    return recipe.result.count;
  }
  return 1;
}

/**
 * Recursively resolve ingredients to raw (uncraftable) materials.
 *
 * @param {Object} recipe - The mineflayer recipe object
 * @param {number} neededCount - How many of the item we need to produce
 * @param {Object} mcData - minecraft-data module output
 * @param {Function} recipesAll - bot.recipesAll bound function
 * @param {number} maxDepth - Maximum recursion depth (1 = no recursion, just the recipe itself)
 * @param {number} currentDepth - Current recursion depth
 * @param {Set} visited - Set of items already being processed (cycle detection)
 * @returns {Object} { rawMaterials: { name: count }, steps: [...] }
 */
function resolveRecipeTree(recipe, neededCount, mcData, recipesAll, maxDepth, currentDepth, visited) {
  const resultCount = getResultCount(recipe);
  const craftsNeeded = Math.ceil(neededCount / resultCount);
  const actualProduced = craftsNeeded * resultCount;

  const baseIngredients = extractIngredients(recipe, mcData);

  // Scale ingredients by number of crafts needed
  const scaledIngredients = {};
  for (const [name, count] of Object.entries(baseIngredients)) {
    scaledIngredients[name] = count * craftsNeeded;
  }

  const steps = [];
  const rawMaterials = {};

  const stepInfo = {
    item: null, // will be set by caller
    count: actualProduced,
    ingredients: { ...scaledIngredients },
  };

  if (currentDepth >= maxDepth) {
    // At max depth, treat all ingredients as raw materials
    for (const [name, count] of Object.entries(scaledIngredients)) {
      rawMaterials[name] = (rawMaterials[name] || 0) + count;
    }
    steps.push(stepInfo);
    return { rawMaterials, steps };
  }

  // Try to recurse into each ingredient
  for (const [ingName, ingCount] of Object.entries(scaledIngredients)) {
    const ingItemType = mcData.itemsByName[ingName];
    if (!ingItemType) {
      // Unknown item — treat as raw
      rawMaterials[ingName] = (rawMaterials[ingName] || 0) + ingCount;
      continue;
    }

    // Check for cycles
    if (visited.has(ingName)) {
      rawMaterials[ingName] = (rawMaterials[ingName] || 0) + ingCount;
      continue;
    }

    // Look for a crafting recipe for this ingredient
    const ingRecipesWithTable = recipesAll(ingItemType.id, null, true) || [];
    const ingRecipesWithoutTable = recipesAll(ingItemType.id, null, false) || [];

    // Deduplicate
    const allIngRecipes = [];
    const seen = new Set();
    for (const r of [...ingRecipesWithoutTable, ...ingRecipesWithTable]) {
      const key = JSON.stringify(r);
      if (!seen.has(key)) {
        seen.add(key);
        allIngRecipes.push(r);
      }
    }

    if (allIngRecipes.length === 0) {
      // No crafting recipe — this is a raw material
      rawMaterials[ingName] = (rawMaterials[ingName] || 0) + ingCount;
      continue;
    }

    // Found a recipe — recurse
    const subVisited = new Set(visited);
    subVisited.add(ingName);
    const subResult = resolveRecipeTree(
      allIngRecipes[0], ingCount, mcData, recipesAll, maxDepth, currentDepth + 1, subVisited
    );

    // Merge raw materials from sub-result
    for (const [name, count] of Object.entries(subResult.rawMaterials)) {
      rawMaterials[name] = (rawMaterials[name] || 0) + count;
    }

    // Merge steps from sub-result
    for (const step of subResult.steps) {
      steps.push(step);
    }
  }

  steps.push(stepInfo);
  return { rawMaterials, steps };
}

module.exports = function () {
  return {
    name: 'get_recipe',
    description:
      'Look up crafting recipes for an item. Shows required ingredients and whether a crafting table is needed. ' +
      'Use the depth parameter to recursively resolve sub-recipes: depth=1 shows only direct ingredients, ' +
      'depth=2 resolves ingredients of ingredients, etc. Raw materials that cannot be crafted further are shown as the total needed.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to look up (e.g. wooden_pickaxe, furnace, iron_sword, chest).',
        },
        depth: {
          type: 'number',
          description:
            'Recipe recursion depth. 1 = show direct ingredients only (default). ' +
            '2 = also resolve ingredients of each ingredient. 3 = resolve three levels deep, etc. ' +
            'For example, a wooden_pickaxe with depth=3 shows that you need 2 oak_log total (3 planks→1 log, 2 sticks→2 planks→1 log).',
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

      const depth = args.depth ?? 1;
      if (depth < 1 || !Number.isInteger(depth)) {
        return `Error: depth must be a positive integer (got ${args.depth}).`;
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

      const lines = [`Recipes for ${args.item} (${allRecipes.length} found, depth=${depth}):\n`];

      for (let i = 0; i < Math.min(allRecipes.length, 3); i++) {
        const recipe = allRecipes[i];
        const requiresTable = !recipesWithoutTable.some((r) => JSON.stringify(r) === JSON.stringify(recipe));

        lines.push(`Recipe ${i + 1}${requiresTable ? ' (needs crafting table)' : ' (2x2, no table needed)'}:`);

        // Direct ingredients (depth 1 view)
        const ingredients = extractIngredients(recipe, mcData);

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

        // Recursive resolution if depth > 1
        if (depth > 1 && Object.keys(ingredients).length > 0) {
          const visited = new Set([itemName]);
          const resolved = resolveRecipeTree(
            recipe, 1, mcData, bot.recipesAll.bind(bot), depth, 1, visited
          );

          if (Object.keys(resolved.rawMaterials).length > 0) {
            lines.push(`  Raw materials (depth=${depth}):`);
            for (const [name, count] of Object.entries(resolved.rawMaterials).sort(([a], [b]) => a.localeCompare(b))) {
              lines.push(`    ${count}x ${name}`);
            }
          }

          // Show the breakdown tree (skip the last step which is the item itself)
          const subSteps = resolved.steps.slice(0, -1);
          if (subSteps.length > 0) {
            lines.push(`  Recipe tree:`);
            for (const step of subSteps) {
              const ingStr = Object.entries(step.ingredients)
                .map(([n, c]) => `${c}x ${n}`)
                .join(' + ');
              lines.push(`    ${step.count}x ${step.item} ← ${ingStr}`);
            }
          }
        }

        // Check if player has materials (compare against raw materials if depth > 1, else direct ingredients)
        const materialCheck = depth > 1 && Object.keys(ingredients).length > 0
          ? (() => {
              const visited = new Set([itemName]);
              const resolved = resolveRecipeTree(
                recipe, 1, mcData, bot.recipesAll.bind(bot), depth, 1, visited
              );
              return resolved.rawMaterials;
            })()
          : ingredients;

        const missing = [];
        for (const [name, needed] of Object.entries(materialCheck)) {
          const have = bot.inventory.items()
            .filter((it) => it.name === name)
            .reduce((sum, it) => sum + it.count, 0);
          if (have < needed) {
            missing.push(`${needed - have}x ${name}`);
          }
        }
        if (missing.length > 0) {
          lines.push(`  Missing: ${missing.join(', ')}`);
        } else if (Object.keys(materialCheck).length > 0) {
          lines.push('  ✓ You have all materials!');
        }

        lines.push('');
      }

      return lines.join('\n').trim();
    },
  };
};
