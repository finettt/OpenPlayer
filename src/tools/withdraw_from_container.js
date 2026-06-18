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

/**
 * Map of container block names to their open methods and slot layouts.
 * Container types:
 *   - chest:        27 slots (0-26 container, 27-62 inventory)
 *   - barrel:       27 slots (same layout)
 *   - shulker_box:  27 slots (same layout)
 *   - furnace:       3 slots (0=input, 1=fuel, 2=output, 3-38 inventory)
 *   - blast_furnace: 3 slots (same as furnace)
 *   - smoker:        3 slots (same as furnace)
 *   - dispenser:     9 slots (0-8 container, 9-44 inventory)
 *   - dropper:       9 slots (same as dispenser)
 *   - hopper:        5 slots (0-4 container, 5-40 inventory)
 */
const CONTAINER_CONFIG = {
  chest:           { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  trapped_chest:   { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  barrel:          { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  shulker_box:     { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  // Color variants of shulker boxes
  white_shulker_box:      { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  orange_shulker_box:   { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  magenta_shulker_box:  { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  light_blue_shulker_box:{ openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  yellow_shulker_box:   { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  lime_shulker_box:     { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  pink_shulker_box:     { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  gray_shulker_box:     { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  light_gray_shulker_box:{ openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  cyan_shulker_box:     { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  purple_shulker_box:   { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  blue_shulker_box:     { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  brown_shulker_box:    { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  green_shulker_box:    { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  red_shulker_box:      { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  black_shulker_box:    { openMethod: 'openContainer', containerSlots: 27, slotOffset: 0 },
  // Furnace variants
  furnace:         { openMethod: 'openFurnace', containerSlots: 3, slotOffset: 0, isFurnace: true },
  lit_furnace:     { openMethod: 'openFurnace', containerSlots: 3, slotOffset: 0, isFurnace: true },
  blast_furnace:   { openMethod: 'openFurnace', containerSlots: 3, slotOffset: 0, isFurnace: true },
  smoker:          { openMethod: 'openFurnace', containerSlots: 3, slotOffset: 0, isFurnace: true },
  // Dispenser variants
  dispenser:       { openMethod: 'openContainer', containerSlots: 9, slotOffset: 0 },
  dropper:         { openMethod: 'openContainer', containerSlots: 9, slotOffset: 0 },
  // Hopper
  hopper:          { openMethod: 'openContainer', containerSlots: 5, slotOffset: 0 },
};

const CONTAINER_NAMES = Object.keys(CONTAINER_CONFIG);

function findNearestContainer(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);
  const matching = (block) => {
    return CONTAINER_NAMES.includes(block.name) ||
           // Also match lit furnace
           block.name === 'lit_furnace';
  };

  const found = bot.findBlocks({ matching, maxDistance: radius, count: 1 });
  if (found.length === 0) return null;
  return bot.blockAt(found[0]);
}

function getContainerConfig(blockName) {
  if (blockName === 'lit_furnace') return CONTAINER_CONFIG.furnace;
  return CONTAINER_CONFIG[blockName] || null;
}

function findBestMatch(items, searchName) {
  const norm = searchName.toLowerCase().replace(/ /g, '_');

  const exact = items.filter((i) => i.name === norm);
  if (exact.length > 0) {
    return exact.reduce((best, cur) =>
      tierScore(cur.name) > tierScore(best.name) ? cur : best,
    );
  }

  const suffix = items.filter((i) => i.name.endsWith('_' + norm));
  if (suffix.length > 0) {
    return suffix.reduce((best, cur) =>
      tierScore(cur.name) > tierScore(best.name) ? cur : best,
    );
  }

  const contains = items.filter((i) => i.name.includes(norm));
  if (contains.length > 0) {
    return contains.reduce((best, cur) =>
      tierScore(cur.name) > tierScore(best.name) ? cur : best,
    );
  }

  return null;
}

function countInventorySlots(bot) {
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

  let roomInExisting = 0;
  for (let i = 9; i <= 44; i++) {
    const slot = bot.inventory.slots[i];
    if (slot && slot.name === itemName && slot.count < maxStack) {
      roomInExisting += maxStack - slot.count;
    }
  }

  let freeSlots = 0;
  for (let i = 9; i <= 35; i++) {
    if (!bot.inventory.slots[i]) freeSlots++;
  }

  return roomInExisting + freeSlots * maxStack;
}

module.exports = function () {
  return {
    name: 'withdraw_from_container',
    description:
      'Withdraw items from a nearby container (chest, furnace, barrel, shulker box, dispenser, hopper). ' +
      'For regular containers (chests, barrels, etc.), searches by item name. ' +
      'For furnaces, you can optionally specify a slot: "output" (smelted items), "fuel" (remaining fuel), or "input" (raw items). ' +
      'If slot is not specified for a furnace, defaults to "output". ' +
      'Partial item names work (e.g. "sword" withdraws the best matching sword). ' +
      'If count is not specified, withdraws as many as will fit in inventory.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'Item name to withdraw (e.g. dirt, iron_ingot, cooked_beef, coal). ' +
            'Partial names work (e.g. "pickaxe" withdraws the best pickaxe). ' +
            'For furnaces, use the actual item name (e.g. "iron_ingot" for output, "coal" for fuel).',
        },
        count: {
          type: 'number',
          description:
            'How many to withdraw (defaults to as many as will fit). ' +
            'Capped by inventory space and stack limits.',
        },
        radius: {
          type: 'number',
          description: 'Search radius for container in blocks (1-64). Defaults to 16.',
        },
        slot: {
          type: 'string',
          enum: ['output', 'fuel', 'input'],
          description:
            'For furnace containers only: which slot to withdraw from. ' +
            '"output" = smelted result, "fuel" = remaining fuel, "input" = raw items being smelted. ' +
            'Defaults to "output". Ignored for non-furnace containers.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const requestedCount = args.count ?? null;
      const radius = Math.min(Math.max(args.radius ?? 16, 1), 64);
      const furnaceSlot = args.slot || 'output';

      // Find nearest container
      const containerBlock = findNearestContainer(bot, radius);
      if (!containerBlock) {
        const containerList = CONTAINER_NAMES.join(', ');
        return `No container found within ${radius} blocks. Supported containers: ${containerList}.`;
      }

      const config = getContainerConfig(containerBlock.name);
      if (!config) {
        return `Unsupported container type: ${containerBlock.name}.`;
      }

      const dist = bot.entity.position.distanceTo(containerBlock.position);
      if (dist > 5) {
        return `Container too far (${Math.round(dist)}m). Move closer first (use approach or go_to).`;
      }

      // Snapshot inventory BEFORE opening
      const invSnapshot = {};
      for (const item of bot.inventory.items()) {
        invSnapshot[item.name] = (invSnapshot[item.name] ?? 0) + item.count;
      }

      // Open container using appropriate method
      let container;
      try {
        if (config.isFurnace) {
          container = await bot.openFurnace(containerBlock);
        } else {
          container = await bot.openContainer(containerBlock);
        }
      } catch (err) {
        return `Failed to open ${containerBlock.name}: ${err.message}`;
      }

      // Wait for slot sync
      await new Promise((resolve) => {
        let timer = setTimeout(resolve, 600);
        container.on('updateSlot', () => {
          clearTimeout(timer);
          timer = setTimeout(resolve, 100);
        });
      });

      // ── FURNACE HANDLING ──────────────────────────────────────
      if (config.isFurnace) {
        let targetItem = null;
        let slotName = '';

        switch (furnaceSlot) {
          case 'output':
            targetItem = container.outputItem();
            slotName = 'output';
            break;
          case 'fuel':
            targetItem = container.fuelItem();
            slotName = 'fuel';
            break;
          case 'input':
            targetItem = container.inputItem();
            slotName = 'input';
            break;
          default:
            container.close();
            return `Error: invalid furnace slot "${furnaceSlot}". Use: output, fuel, or input.`;
        }

        if (!targetItem) {
          container.close();
          return `No items in the ${slotName} slot of the furnace.`;
        }

        // Check if requested item matches what's in the slot
        if (!targetItem.name.includes(itemName) && itemName !== targetItem.name) {
          container.close();
          return `The ${slotName} slot contains ${targetItem.name}, not "${args.item}".`;
        }

        const maxFit = getMaxWithdrawable(bot, targetItem.name);
        if (maxFit <= 0) {
          container.close();
          return `Error: inventory full. No space to withdraw ${targetItem.name}.`;
        }

        const toWithdraw = requestedCount
          ? Math.min(requestedCount, targetItem.count, maxFit)
          : Math.min(targetItem.count, maxFit);

        try {
          switch (furnaceSlot) {
            case 'output':
              await container.takeOutput();
              break;
            case 'fuel':
              await container.takeFuel();
              break;
            case 'input':
              await container.takeInput();
              break;
          }
        } catch (err) {
          container.close();
          return `Failed to take ${targetItem.name} from ${slotName} slot: ${err.message}`;
        }

        container.close();
        await new Promise((r) => setTimeout(r, 200));

        const invAfter = bot.inventory.items()
          .filter((i) => i.name === targetItem.name)
          .reduce((sum, i) => sum + i.count, 0);
        const invBefore = invSnapshot[targetItem.name] ?? 0;
        const withdrawn = invAfter - invBefore;

        if (withdrawn > 0) {
          return `Withdrew ${withdrawn}x ${targetItem.name} from furnace ${slotName} slot.`;
        }
        return `Could not withdraw from furnace ${slotName} slot. Inventory may be full.`;
      }

      // ── REGULAR CONTAINER HANDLING (chest, barrel, shulker, dispenser, hopper) ──
      const currentWindow = bot.currentWindow;
      if (!currentWindow) {
        return 'Container was closed unexpectedly.';
      }

      const containerSlotsCount = config.containerSlots;
      const containerItems = currentWindow.slots
        .slice(0, containerSlotsCount)
        .filter(item => item !== null);

      if (containerItems.length === 0) {
        container.close();
        return `Opened ${containerBlock.name}. It is empty.`;
      }

      // Find matching items
      const matches = containerItems.filter((item) => {
        return item.name === itemName || item.name.includes(itemName);
      });

      if (matches.length === 0) {
        const contents = containerItems.map((i) => `${i.name} x${i.count}`);
        container.close();
        return `Error: "${args.item}" not found in ${containerBlock.name}. Contains: ${contents.join(', ')}`;
      }

      // Pick best match
      let target = matches[0];
      if (matches.length > 1) {
        target = matches.reduce((best, cur) =>
          tierScore(cur.name) > tierScore(best.name) ? cur : best,
        );
      }

      // Count total matching items in container
      const totalInContainer = containerItems
        .filter((item) => item.name === target.name)
        .reduce((sum, item) => sum + item.count, 0);

      const maxFit = getMaxWithdrawable(bot, target.name);
      if (maxFit <= 0) {
        container.close();
        return `Error: inventory full. No space to withdraw ${target.name}.`;
      }

      const toWithdraw = requestedCount
        ? Math.min(requestedCount, totalInContainer, maxFit)
        : Math.min(totalInContainer, maxFit);

      try {
        await container.withdraw(target.type, target.metadata ?? null, toWithdraw);
      } catch (err) {
        // withdraw() can throw even when items were moved — verify below
      }

      try { container.close(); } catch { /* ignore */ }
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
        return `Withdrew ${withdrawn}x ${label} from ${containerBlock.name}.`;
      }

      return `Could not withdraw ${label} from ${containerBlock.name}. It may no longer be there or inventory is full.`;
    },
  };
};
