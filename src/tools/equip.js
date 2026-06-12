'use strict';

/**
 * Map of user-facing destination names to mineflayer equip destination strings.
 * Also tracks the inventory slot range for each armor slot so we can detect
 * what is already equipped there.
 */
const DEST_MAP = {
  hand: 'hand',
  'off-hand': 'off-hand',
  offhand: 'off-hand',
  head: 'head',
  helmet: 'head',
  torso: 'torso',
  chestplate: 'torso',
  chest: 'torso',
  legs: 'legs',
  leggings: 'legs',
  feet: 'feet',
  boots: 'feet',
};

/**
 * Armor slot indices in the inventory window.
 * Index maps to: [head, torso, legs, feet]
 */
const ARMOR_SLOT_INDICES = { head: 5, torso: 6, legs: 7, feet: 8 };

/**
 * Known armor material tiers in ascending order of quality.
 * Used to pick the "best" matching item when multiple candidates exist.
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
 * Known tool/weapon material tiers in ascending order of quality.
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
 * Determine a numeric quality score for an item based on its material tier.
 * Higher is better. Returns 0 if the tier cannot be determined.
 */
function tierScore(name, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    if (name.startsWith(tiers[i] + '_')) return i;
  }
  // Also check if the name IS the tier (e.g. "golden_helmet" starts with "golden_")
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
    return exact.reduce((best, cur) => (tierScore(cur.name, TOOL_TIERS) + tierScore(cur.name, ARMOR_TIERS) >
                                         tierScore(best.name, TOOL_TIERS) + tierScore(best.name, ARMOR_TIERS) ? cur : best));
  }

  // 2. Suffix match: item name ends with "_" + search term (e.g. "iron_sword" for "sword")
  const suffix = items.filter((i) => i.name.endsWith('_' + norm));
  if (suffix.length > 0) {
    return suffix.reduce((best, cur) => (tierScore(cur.name, TOOL_TIERS) + tierScore(cur.name, ARMOR_TIERS) >
                                         tierScore(best.name, TOOL_TIERS) + tierScore(best.name, ARMOR_TIERS) ? cur : best));
  }

  // 3. Contains match
  const contains = items.filter((i) => i.name.includes(norm));
  if (contains.length > 0) {
    return contains.reduce((best, cur) => (tierScore(cur.name, TOOL_TIERS) + tierScore(cur.name, ARMOR_TIERS) >
                                           tierScore(best.name, TOOL_TIERS) + tierScore(best.name, ARMOR_TIERS) ? cur : best));
  }

  return null;
}

module.exports = function () {
  return {
    name: 'equip',
    description:
      'Equip an item from your inventory to a specific slot. ' +
      'Supports destinations: hand (hotbar), off-hand, head, torso, legs, feet. ' +
      'You can also use armor-specific aliases: helmet→head, chestplate→torso, leggings→legs, boots→feet. ' +
      'If the item name is partial (e.g. "sword"), picks the best available tier. ' +
      'Returns an error if the item is not in your inventory.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'Item name to equip (e.g. iron_sword, diamond_chestplate, shield). ' +
            'Partial names work too (e.g. "sword" will pick the best sword available).',
        },
        destination: {
          type: 'string',
          description:
            'Where to equip the item: hand, off-hand, head, torso, legs, feet. ' +
            'Aliases: helmet, chestplate, chest, leggings, boots, offhand. ' +
            'Defaults to "hand" for tools/weapons, or the appropriate armor slot for armor items.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');

      // --- Resolve destination ---
      let destination = args.destination ? args.destination.toLowerCase().replace(/ /g, '-').replace('_', '-') : null;

      // If no destination provided, infer from item name
      if (!destination) {
        if (itemName.includes('helmet') || itemName.includes('cap')) destination = 'head';
        else if (itemName.includes('chestplate') || itemName.includes('tunic')) destination = 'torso';
        else if (itemName.includes('leggings') || itemName.includes('pants')) destination = 'legs';
        else if (itemName.includes('boots')) destination = 'feet';
        else destination = 'hand';
      }

      const destKey = DEST_MAP[destination];
      if (!destKey) {
        return `Error: unknown destination "${args.destination}". Use: hand, off-hand, head, torso, legs, feet.`;
      }

      // --- Find the item in inventory ---
      const invItems = bot.inventory.items();
      const match = findBestMatch(invItems, itemName);

      if (!match) {
        // Build a helpful list of what's available
        const available = invItems.map((i) => i.name).join(', ') || 'empty';
        return `Error: "${args.item}" not found in inventory. Available items: ${available}`;
      }

      // --- Check if already equipped in the target slot ---
      if (destKey === 'hand') {
        const heldItem = bot.inventory.slots[bot.QUICK_BAR_START + bot.quickBarSlot];
        if (heldItem && heldItem.name === match.name && heldItem.count === match.count) {
          return `Already holding ${match.name} (x${match.count}) in hand.`;
        }
      } else if (destKey === 'off-hand') {
        const offhandSlot = bot.supportFeature('doesntHaveOffHandSlot') ? null : 45;
        if (offhandSlot !== null) {
          const offhandItem = bot.inventory.slots[offhandSlot];
          if (offhandItem && offhandItem.name === match.name) {
            return `Already equipping ${match.name} in off-hand.`;
          }
        }
      } else {
        // Armor slot
        const armorIdx = ARMOR_SLOT_INDICES[destKey];
        if (armorIdx !== undefined) {
          const currentArmor = bot.inventory.slots[armorIdx];
          if (currentArmor && currentArmor.name === match.name) {
            return `Already wearing ${match.name} on ${destKey}.`;
          }
        }
      }

      // --- Equip ---
      try {
        await bot.equip(match, destKey);

        const destLabel = destKey === 'hand' ? 'hand' : destKey === 'off-hand' ? 'off-hand' : destKey;
        const matchLabel = match.name === itemName ? match.name : `${match.name} (matched "${args.item}")`;
        return `Equipped ${matchLabel} to ${destLabel}.`;
      } catch (err) {
        return `Failed to equip ${match.name} to ${destKey}: ${err.message}`;
      }
    },
  };
};