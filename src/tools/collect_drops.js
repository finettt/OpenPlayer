'use strict';

module.exports = function ({ vec3, goals, Movements }) {
  return {
    name: 'collect_drops',
    description:
      'Collect dropped items nearby. Walks to each dropped item entity within the radius and picks it up. ' +
      'Use after mining blocks, killing mobs, or whenever you see items on the ground. ' +
      'Stops after all nearby items are collected, area is clear, or timeout is reached.',
    parameters: {
      type: 'object',
      properties: {
        radius: {
          type: 'number',
          description: 'Search radius in blocks (1-32). Defaults to 16.',
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to spend collecting (5-120). Defaults to 30.',
        },
      },
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const radius = Math.min(Math.max(args.radius ?? 16, 1), 32);
      const timeout = Math.min(Math.max(args.timeout ?? 30, 5), 120) * 1000;
      const started = Date.now();
      const collected = {};
      let unreachable = 0;

      while (Date.now() - started < timeout) {
        // Find the closest item entity within radius
        const items = Object.values(bot.entities).filter((e) => {
          if (!e?.position) return false;
          // mineflayer uses e.name === 'item' for dropped items
          if (e.name !== 'item' && e.displayName !== 'Item') return false;
          const dist = e.position.distanceTo(bot.entity.position);
          return dist <= radius;
        });

        if (items.length === 0) break;

        // Sort by distance — pick up closest first
        items.sort(
          (a, b) =>
            a.position.distanceTo(bot.entity.position) -
            b.position.distanceTo(bot.entity.position)
        );

        const target = items[0];
        const targetPos = target.position;
        const distToTarget = bot.entity.position.distanceTo(targetPos);

        // If already close enough, just wait briefly for auto-pickup
        if (distToTarget < 2) {
          await new Promise((r) => setTimeout(r, 300));
          // Check if item was picked up (entity gone)
          if (!bot.entities[target.id]) {
            // Try to identify what was collected from metadata
            const itemName = target.metadata?.[8]?.itemId
              ? `item_${target.metadata[8].itemId}`
              : 'unknown_item';
            collected[itemName] = (collected[itemName] || 0) + 1;
          }
          continue;
        }

        // Navigate toward the item
        try {
          bot.pathfinder.setMovements(new Movements(bot));
          bot.pathfinder.setGoal(
            new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1),
            true
          );

          // Wait to arrive or item disappears, with a per-item timeout
          const itemTimeout = Math.min(8000, timeout - (Date.now() - started));
          const itemStarted = Date.now();
          let reached = false;

          while (Date.now() - itemStarted < itemTimeout) {
            // Item already picked up or despawned
            if (!bot.entities[target.id]) {
              reached = true;
              break;
            }

            const dist = bot.entity.position.distanceTo(target.position);
            if (dist < 2) {
              reached = true;
              await new Promise((r) => setTimeout(r, 300));
              break;
            }
            await new Promise((r) => setTimeout(r, 250));
          }

          bot.pathfinder.setGoal(null);

          if (!bot.entities[target.id]) {
            // Item was collected
            const itemName = target.metadata?.[8]?.itemId
              ? `item_${target.metadata[8].itemId}`
              : 'unknown_item';
            collected[itemName] = (collected[itemName] || 0) + 1;
          } else if (!reached) {
            unreachable++;
            // Skip this item to avoid getting stuck
          }
        } catch {
          bot.pathfinder.setGoal(null);
          unreachable++;
        }
      }

      bot.pathfinder.setGoal(null);

      const totalCollected = Object.values(collected).reduce((s, n) => s + n, 0);
      const parts = [];
      if (totalCollected > 0) {
        parts.push(`Collected ${totalCollected} dropped item(s).`);
      } else {
        parts.push('No items were collected.');
      }
      if (unreachable > 0) {
        parts.push(`${unreachable} item(s) were unreachable.`);
      }

      // Show current inventory snapshot of recent items
      const nearbyRemaining = Object.values(bot.entities).filter(
        (e) =>
          (e.name === 'item' || e.displayName === 'Item') &&
          e.position.distanceTo(bot.entity.position) <= radius
      ).length;
      if (nearbyRemaining > 0) {
        parts.push(`${nearbyRemaining} item(s) still on the ground nearby.`);
      } else if (totalCollected > 0) {
        parts.push('Area is clear.');
      }

      return parts.join(' ');
    },
  };
};
