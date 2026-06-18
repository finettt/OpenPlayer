'use strict';

/**
 * Known tool/weapon material tiers in ascending order of quality.
 * Used to pick the "best" matching item when multiple candidates exist.
 */
const TOOL_TIERS = [
  'wooden',
  'stone',
  'golden',
  'iron',
  'diamond',
  'netherite',
];

/**
 * Known armor material tiers in ascending order of quality.
 */
const ARMOR_TIERS = [
  'leather',
  'golden',
  'chainmail',
  'iron',
  'diamond',
  'netherite',
];

/**
 * Determine a numeric quality score for an item based on its material tier.
 * Higher is better. Returns 0 if the tier cannot be determined.
 */
function tierScore(name, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    if (name.startsWith(tiers[i] + '_')) return i;
  }
  return 0;
}

/**
 * Find the best matching item in inventory for the given item name.
 * 1. Exact match (after normalising spaces → underscores)
 * 2. Suffix match (e.g. "sword" matches "iron_sword")
 * 3. Contains match (e.g. "chest" matches "diamond_chestplate")
 *
 * When multiple candidates exist, prefer the one with the highest tier score.
 */
function findBestMatch(items, searchName) {
  const norm = searchName.toLowerCase().replace(/ /g, '_');

  // 1. Exact match
  const exact = items.filter((i) => i.name === norm);
  if (exact.length > 0) {
    return exact.reduce((best, cur) =>
      tierScore(cur.name, TOOL_TIERS) + tierScore(cur.name, ARMOR_TIERS) >
      tierScore(best.name, TOOL_TIERS) + tierScore(best.name, ARMOR_TIERS)
        ? cur
        : best,
    );
  }

  // 2. Suffix match: item name ends with "_" + search term
  const suffix = items.filter((i) => i.name.endsWith('_' + norm));
  if (suffix.length > 0) {
    return suffix.reduce((best, cur) =>
      tierScore(cur.name, TOOL_TIERS) + tierScore(cur.name, ARMOR_TIERS) >
      tierScore(best.name, TOOL_TIERS) + tierScore(best.name, ARMOR_TIERS)
        ? cur
        : best,
    );
  }

  // 3. Contains match
  const contains = items.filter((i) => i.name.includes(norm));
  if (contains.length > 0) {
    return contains.reduce((best, cur) =>
      tierScore(cur.name, TOOL_TIERS) + tierScore(cur.name, ARMOR_TIERS) >
      tierScore(best.name, TOOL_TIERS) + tierScore(best.name, ARMOR_TIERS)
        ? cur
        : best,
    );
  }

  return null;
}

module.exports = function () {
  return {
    name: 'hold_item',
    description:
      'Hold a specific item in your hand by name. ' +
      'If the item is already in your hotbar, switches to that slot instantly. ' +
      'If the item is in your main inventory, moves it to the current hotbar slot. ' +
      'Partial names work (e.g. "sword" picks the best sword available). ' +
      'Returns an error if the item is not in your inventory. ' +
      'Use this before place_block, interact, or attack_entity to ensure the correct item is held.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'Item name to hold (e.g. dirt, iron_sword, diamond_pickaxe, torch). ' +
            'Partial names work too (e.g. "pickaxe" will pick the best pickaxe available).',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');

      // --- Check if already holding the item ---
      const currentHeldSlot = bot.QUICK_BAR_START + bot.quickBarSlot;
      const heldItem = bot.inventory.slots[currentHeldSlot];
      if (heldItem && heldItem.name === itemName) {
        return `Already holding ${heldItem.name} (x${heldItem.count}) in hand.`;
      }

      // Soft warning: holding a non-weapon while in combat means defense_mode
      // will fight bare-handed (or it will fight you for control of the slot).
      const isCurrentWeapon = heldItem &&
        (heldItem.name.endsWith('_sword') || heldItem.name.endsWith('_axe'));
      const isNewWeapon = itemName.endsWith('_sword') || itemName.endsWith('_axe') ||
        itemName === 'sword' || itemName === 'axe';
      let combatWarning = '';
      if (isCurrentWeapon && !isNewWeapon && bot._defenseMode?.active) {
        combatWarning =
          `Warning: defense_mode is active and you're swapping from ${heldItem.name} to ${itemName}. ` +
          `Combat may suffer — defense_mode re-equips a weapon every tick, so this swap may flicker. `;
      }

      // --- Find the item in inventory ---
      const invItems = bot.inventory.items();
      const match = findBestMatch(invItems, itemName);

      if (!match) {
        const available = invItems.map((i) => i.name).join(', ') || 'empty';
        return `Error: "${args.item}" not found in inventory. Available items: ${available}`;
      }

      // --- Check if already holding a matching item (partial match case) ---
      if (heldItem && heldItem.name === match.name) {
        return `Already holding ${heldItem.name} (x${heldItem.count}) in hand.`;
      }

      // --- Check if the matched item is already in a hotbar slot ---
      const hotbarStart = bot.QUICK_BAR_START; // typically 36
      const hotbarEnd = hotbarStart + 9; // typically 45
      for (let slot = hotbarStart; slot < hotbarEnd; slot++) {
        const slotItem = bot.inventory.slots[slot];
        if (slotItem && slotItem.name === match.name && slotItem.count === match.count) {
          // Same item is in another hotbar slot — just switch to it
          const hotbarIndex = slot - hotbarStart;
          await bot.setQuickBarSlot(hotbarIndex);
          const matchLabel = match.name === itemName ? match.name : `${match.name} (matched "${args.item}")`;
          return `${combatWarning}Switched to hotbar slot ${hotbarIndex + 1}, now holding ${matchLabel} (x${match.count}).`;
        }
      }

      // --- Item is in main inventory — equip it to hand ---
      try {
        await bot.equip(match, 'hand');
        const matchLabel = match.name === itemName ? match.name : `${match.name} (matched "${args.item}")`;
        return `${combatWarning}Now holding ${matchLabel} (x${match.count}) in hand.`;
      } catch (err) {
        return `Failed to hold ${match.name}: ${err.message}`;
      }
    },
  };
};