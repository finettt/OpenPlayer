'use strict';

module.exports = function () {
  return {
    name: 'get_inventory',
    description:
      'List all items in your inventory, hotbar, and armor slots. ' +
      'Use to check what you have before crafting, fighting, or building.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const slots = bot.inventory.slots;
      const lines = [];

      // Armor slots (head → feet)
      const armorSlots = bot.supportFeature('doesntHaveOffHandSlot')
        ? [8, 7, 6, 5]
        : [45, 8, 7, 6, 5]; // includes offhand
      const armorNames = ['offhand', 'helmet', 'chestplate', 'leggings', 'boots'];
      const equipped = [];
      for (let i = 0; i < armorSlots.length; i++) {
        const item = slots[armorSlots[i]];
        if (item) equipped.push(`${armorNames[i]}: ${item.name} (x${item.count})`);
      }
      if (equipped.length) lines.push(`Armor: ${equipped.join(', ')}`);
      else lines.push('Armor: none');

      // Main inventory (slots 9-35)
      const inventory = [];
      for (let i = 9; i <= 35; i++) {
        const item = slots[i];
        if (item) inventory.push(`${item.name} x${item.count}`);
      }
      lines.push(`Inventory (${inventory.length}/27 slots): ${inventory.length ? inventory.join(', ') : 'empty'}`);

      // Hotbar (slots 36-44)
      const hotbar = [];
      for (let i = 36; i <= 44; i++) {
        const item = slots[i];
        const slot = i - 35;
        const held = i === bot.QUICK_BAR_START + bot.quickBarSlot ? ' [held]' : '';
        if (item) hotbar.push(`${slot}: ${item.name} x${item.count}${held}`);
      }
      lines.push(`Hotbar: ${hotbar.length ? hotbar.join(', ') : 'empty'}`);

      return lines.join('\n');
    },
  };
};
