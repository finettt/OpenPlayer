'use strict';

/**
 * consume tool — Eat food or drink potions from inventory.
 *
 * Modes:
 *   - Specify an item name to consume that specific item
 *   - Use "best_food" to automatically pick the best food for current situation
 *   - Verifies the item is consumable before attempting
 *   - Returns updated health/hunger/saturation status after consumption
 */

/**
 * Drinkable item name patterns that are NOT in minecraft-data's foodsByName
 * but can still be consumed via bot.consume(). Splash and lingering potions
 * are excluded — they are thrown, not drunk.
 */
const DRINKABLE_PATTERNS = [
  /^potion$/,       // regular drinkable potion (not splash_ or lingering_)
  /^milk_bucket$/,  // clears all effects
];

/**
 * Check if an item is consumable (food or drinkable) using minecraft-data
 * and known drinkable name patterns.
 */
function isConsumable(mcData, itemName) {
  // Check food items via minecraft-data foodsByName collection
  // (itemsByName does NOT contain food/saturation fields)
  const foodData = mcData.foodsByName[itemName];
  if (foodData) return true;

  // Check known drinkable patterns
  for (const pattern of DRINKABLE_PATTERNS) {
    if (pattern.test(itemName)) return true;
  }

  return false;
}

/**
 * Compute an effective food-quality score for sorting.
 * Saturation is weighted more heavily because it extends the effective hunger bar
 * and enables natural health regeneration.
 */
function foodScore(mcData, itemName) {
  const foodData = mcData.foodsByName[itemName];
  if (!foodData) return 0;
  const hunger = foodData.foodPoints || 0;
  const saturation = foodData.saturation || 0;
  return hunger + saturation * 2;
}

/**
 * Find the best food item in inventory based on current needs.
 * - If critically hungry (< 6 food), prioritise highest hunger restoration.
 * - Otherwise, prioritise highest overall quality (hunger + saturation).
 * - Skips items that cannot be eaten when full (unless they are always-consumable
 *   like golden apples, chorus fruit, or potions).
 */
function findBestFood(bot, mcData) {
  const invItems = bot.inventory.items();
  const foods = invItems.filter((i) => {
    if (!isConsumable(mcData, i.name)) return false;
    // Filter out regular food when hunger is full (can't eat it)
    const isRegularFood = mcData.foodsByName[i.name] != null; // items in foodsByName are regular food
    const isSpecialFood = i.name === 'golden_apple' || i.name === 'enchanted_golden_apple' || i.name === 'chorus_fruit';
    if (bot.food >= 20 && isRegularFood && !isSpecialFood) return false;
    return true;
  });

  if (foods.length === 0) return null;

  const critical = bot.food < 6;

  foods.sort((a, b) => {
    if (critical) {
      // When critically hungry, maximise immediate hunger restoration
      const aHunger = mcData.foodsByName[a.name]?.foodPoints || 0;
      const bHunger = mcData.foodsByName[b.name]?.foodPoints || 0;
      return bHunger - aHunger;
    }
    return foodScore(mcData, b.name) - foodScore(mcData, a.name);
  });

  return foods[0];
}

/**
 * Find an item in inventory by name (exact → suffix → contains).
 */
function findItemInInventory(bot, itemName) {
  const norm = itemName.toLowerCase().replace(/ /g, '_');
  const invItems = bot.inventory.items();

  // 1. Exact match
  const exact = invItems.find((i) => i.name === norm);
  if (exact) return exact;

  // 2. Suffix match (e.g. "beef" matches "cooked_beef")
  const suffix = invItems.find((i) => i.name.endsWith('_' + norm));
  if (suffix) return suffix;

  // 3. Contains match
  const contains = invItems.find((i) => i.name.includes(norm));
  if (contains) return contains;

  return null;
}

/**
 * Format current health/food/saturation as a status summary.
 */
function formatStatus(bot) {
  return [
    `Health: ${bot.health.toFixed(1)}/20`,
    `Food: ${bot.food}/20`,
    `Saturation: ${(bot.foodSaturation ?? 0).toFixed(1)}`,
  ].join('\n');
}

module.exports = function () {
  return {
    name: 'consume',
    description:
      'Consume an edible or drinkable item from inventory — eat food to restore hunger, ' +
      'drink potions for effects, or use milk to clear effects. ' +
      'Use "best_food" as the item name to automatically pick the best available food. ' +
      'Returns updated health, hunger, saturation, and any active effects after consumption.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'Item to consume (e.g. cooked_beef, bread, golden_carrot, potion, milk_bucket). ' +
            'Use "best_food" to automatically select the best food for your current hunger level. ' +
            'Partial names work (e.g. "beef" matches cooked_beef).',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);
      const itemName = args.item.toLowerCase().replace(/ /g, '_');

      // Record status before consumption
      const healthBefore = bot.health;
      const foodBefore = bot.food;

      let itemToConsume = null;
      let autoSelected = false;

      if (itemName === 'best_food') {
        // Find the best available food
        itemToConsume = findBestFood(bot, mcData);
        if (!itemToConsume) {
          if (bot.food >= 20) {
            return 'Hunger is already full. No regular food can be eaten. ' +
              'Only golden apples, chorus fruit, or potions can be consumed at full hunger.\n' +
              formatStatus(bot);
          }
          return 'Error: No consumable food found in inventory. Use get_inventory to check what you have.';
        }
        autoSelected = true;
      } else {
        // Find the specified item
        itemToConsume = findItemInInventory(bot, itemName);
        if (!itemToConsume) {
          const available = bot.inventory.items()
            .filter((i) => isConsumable(mcData, i.name))
            .map((i) => i.name)
            .join(', ') || 'none';
          return `Error: "${args.item}" not found in inventory. Consumable items available: ${available}`;
        }

        // Verify the item is actually consumable
        if (!isConsumable(mcData, itemToConsume.name)) {
          return `Error: "${itemToConsume.name}" is not consumable. It cannot be eaten or drunk. ` +
            'Look for food items or potions instead.';
        }
      }

      // Check if we can eat right now (hunger full check for regular food)
      if (bot.food >= 20) {
        const isFood = mcData.foodsByName[itemToConsume.name] != null;
        const isSpecialFood = itemToConsume.name === 'golden_apple' ||
          itemToConsume.name === 'enchanted_golden_apple' ||
          itemToConsume.name === 'chorus_fruit';
        if (isFood && !isSpecialFood) {
          return `Cannot eat ${itemToConsume.name} — hunger is already full (20/20). ` +
            'Only golden apples, chorus fruit, or potions can be consumed at full hunger.\n' +
            formatStatus(bot);
        }
      }

      // Equip the item to hand
      try {
        await bot.equip(itemToConsume, 'hand');
      } catch (err) {
        return `Failed to equip ${itemToConsume.name}: ${err.message}`;
      }

      // Consume the item
      try {
        await bot.consume();
      } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('interrupt') || msg.includes('cancel')) {
          return `Consumption of ${itemToConsume.name} was interrupted (likely by damage). Try again.\n` +
            formatStatus(bot);
        }
        return `Failed to consume ${itemToConsume.name}: ${msg}`;
      }

      // Build result with updated status
      const healthAfter = bot.health;
      const foodAfter = bot.food;
      const satAfter = bot.foodSaturation ?? 0;

      const healthGained = Math.round((healthAfter - healthBefore) * 10) / 10;
      const foodGained = foodAfter - foodBefore;

      const selectLabel = autoSelected ? ` (auto-selected as best food)` : '';
      const matchLabel = itemToConsume.name === itemName
        ? itemToConsume.name
        : `${itemToConsume.name} (matched "${args.item}")`;

      const lines = [
        `Consumed ${matchLabel}${selectLabel}.`,
        `Health: ${healthAfter.toFixed(1)}/20${healthGained > 0 ? ` (+${healthGained})` : ''}`,
        `Food: ${foodAfter}/20${foodGained > 0 ? ` (+${foodGained})` : ''}`,
        `Saturation: ${satAfter.toFixed(1)}`,
      ];

      // Show active effects (especially useful after drinking potions)
      const effects = bot.entity.effects;
      if (effects && Object.keys(effects).length > 0) {
        const effectsMap = mcData.effects || {};
        const effectLines = [];
        for (const id of Object.keys(effects)) {
          const eff = effects[id];
          const info = effectsMap[id] || { name: `Effect(${id})` };
          const amp = eff.amplifier > 0 ? ` ${'Ⅰ'.repeat(eff.amplifier + 1)}` : '';
          const secs = Math.ceil(eff.duration / 20);
          effectLines.push(`${info.name}${amp}: ${secs}s`);
        }
        lines.push(`Active effects: ${effectLines.join(', ')}`);
      }

      return lines.join('\n');
    },
  };
};