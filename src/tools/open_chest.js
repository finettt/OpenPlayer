'use strict';

module.exports = function () {
  return {
    name: 'open_chest',
    description:
      'Open a nearby chest and report its contents. ' +
      'Finds the closest chest within the given radius, opens it, and lists all items inside. ' +
      'Use before depositing or withdrawing items to see what is stored.',
    parameters: {
      type: 'object',
      properties: {
        radius: {
          type: 'number',
          description: 'Search radius in blocks (1-64). Defaults to 16.',
        },
      },
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const radius = Math.min(Math.max(args.radius ?? 16, 1), 64);

      // Find nearest chest
      const chestBlock = findNearestChest(bot, radius);
      if (!chestBlock) {
        return `No chest found within ${radius} blocks.`;
      }

      const dist = bot.entity.position.distanceTo(chestBlock.position);
      if (dist > 5) {
        return `Chest too far (${Math.round(dist)}m). Move closer first (use approach or go_to).`;
      }

      let chest;
      try {
        chest = await bot.openContainer(chestBlock);
      } catch (err) {
        return `Failed to open chest: ${err.message}`;
      }

      // Wait for all slot data from server (debounced — resolves after last updateSlot + 100ms)
      await new Promise((resolve) => {
        let timer = setTimeout(resolve, 600);
        chest.on('updateSlot', () => {
          clearTimeout(timer);
          timer = setTimeout(resolve, 100);
        });
      });

      // Перепроверяем актуальное состояние контейнера через bot.currentWindow
      const currentWindow = bot.currentWindow;
      if (!currentWindow) {
        return "Container was closed unexpectedly.";
      }

      // Получаем предметы именно из контейнера (исключая инвентарь игрока снизу)
      // В Mineflayer нижние 36 слотов — это инвентарь игрока
      const containerSlotsCount = currentWindow.slots.length - 36;
      const items = currentWindow.slots.slice(0, containerSlotsCount).filter(item => item !== null);

      if (items.length === 0) {
        chest.close(); // Закрываем, только если он действительно пуст
        return `Opened chest at x=${chestBlock.position.x}, y=${chestBlock.position.y}, z=${chestBlock.position.z}. Chest is empty.`;
      }

      // Aggregate items by name
      const aggregated = {};
      for (const item of items) {
        const key = item.name;
        if (!aggregated[key]) {
          aggregated[key] = { name: key, count: 0, slots: 0 };
        }
        aggregated[key].count += item.count;
        aggregated[key].slots += 1;
      }

      const lines = [`Chest at x=${chestBlock.position.x}, y=${chestBlock.position.y}, z=${chestBlock.position.z}:`];
      for (const entry of Object.values(aggregated)) {
        lines.push(`  ${entry.name} x${entry.count} (${entry.slots} slot${entry.slots > 1 ? 's' : ''})`);
      }
      lines.push(`Total: ${items.length} occupied slot${items.length > 1 ? 's' : ''} out of ${containerSlotsCount} container slots.`);

      chest.close();

      return lines.join('\n');
    },
  };
};

function findNearestChest(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);
  const chestNames = ['chest', 'trapped_chest'];
  const matching = (block) => chestNames.includes(block.name);

  const found = bot.findBlocks({ matching, maxDistance: radius, count: 1 });
  if (found.length === 0) return null;
  return bot.blockAt(found[0]);
}
