'use strict';

module.exports = function ({ goals, Movements, vec3 }) {
  return {
    name: 'approach',
    description:
      'Navigate adjacent to a specific block. ' +
      'Use for chests, crafting tables, doors, furnaces, levers — anything you need to interact with.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Block X coordinate.' },
        y: { type: 'number', description: 'Block Y coordinate (optional, auto-detected if omitted).' },
        z: { type: 'number', description: 'Block Z coordinate.' },
      },
      required: ['x', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;

      // ✅ If Y not provided, scan the block column at this XZ to find the real block Y.
      // Previously defaulted to bot's current Y, causing GoalGetToBlock to target the
      // wrong elevation (e.g. bot underground while crafting table was on the surface).
      let blockY;
      if (args.y !== undefined) {
        blockY = args.y;
      } else {
        const botY = Math.round(bot.entity.position.y);
        blockY = botY; // fallback if nothing found
        outer:
        for (let dy = 0; dy <= 16; dy++) {
          for (const sign of [1, -1]) {
            const checkY = botY + dy * sign;
            const b = bot.blockAt(vec3(args.x, checkY, args.z));
            if (b && b.name !== 'air' && b.name !== 'cave_air') {
              blockY = checkY;
              break outer;
            }
          }
        }
      }

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalGetToBlock(args.x, blockY, args.z), true);

        const timeout = 30000;
        const started = Date.now();

        while (Date.now() - started < timeout) {
          const pos = bot.entity.position;

          // ✅ Full 3D distance — XZ-only check fired too early when bot was
          // directly below the target (XZ ≈ 0 but Y delta was 4-6 blocks).
          const dx = pos.x - args.x;
          const dy = pos.y - blockY;
          const dz = pos.z - args.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < 3.5) {
            bot.pathfinder.setGoal(null);
            return `Approached block at x=${args.x}, y=${blockY}, z=${args.z}. Ready to interact.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}. Could not approach target (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  };
};