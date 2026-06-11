'use strict';

const vec3 = require('vec3');
const { goals, Movements } = require('mineflayer-pathfinder');

function makeChatSender(bot, config, logger) {
  let lastSentAt = 0;
  return async (text) => {
    const now = Date.now();
    const wait = config.agent.chatRateLimitMs - (now - lastSentAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSentAt = Date.now();

    const trimmed = String(text).slice(0, config.agent.chatMaxLength);
    if (trimmed.length < String(text).length) {
      logger.debug('Message truncated to chat limit');
    }
    bot.chat(trimmed);
  };
}

function registerTools(registry, config) {
  registry.register({
    name: 'send_message',
    description:
      'Send a message to the game chat. MUST use this to be heard by players. ' +
      'No more than 1-2 sentences.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message text (1-2 sentences).' },
      },
      required: ['message'],
    },
    final: true,
    async execute(args, ctx) {
      if (!args.message || !args.message.trim()) {
        return 'Error: empty message not sent.';
      }
      await ctx.sendChat(args.message);
      return 'Message sent to chat.';
    },
  });

  registry.register({
    name: 'take_screenshot',
    description:
      'Take a screenshot of what is in front of you. After receiving the photo, respond to the player via send_message.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const base64 = await ctx.camera.screenshot();
      return { type: 'image', base64, note: 'Screenshot taken, image in the next message.' };
    },
  });

  registry.register({
    name: 'look_at_player',
    description: 'Turn to face a player (useful before taking a screenshot to see what they are showing).',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username.' },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const player = ctx.bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby (out of range).`;
      }
      const pos = player.entity.position.offset(0, player.entity.height, 0);
      await ctx.bot.lookAt(pos);
      return `Turned to face player ${args.username}.`;
    },
  });

  registry.register({
    name: 'get_surroundings',
    description:
      'Get a text summary of surroundings: position, time of day, health, nearby players and mobs. ' +
      'Cheaper alternative to a screenshot when an image is not needed.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const pos = bot.entity.position;
      const players = Object.values(bot.players)
        .filter((p) => p.username !== bot.username && p.entity)
        .map((p) => `${p.username} (${Math.round(p.entity.position.distanceTo(pos))}m)`);
      const mobs = Object.values(bot.entities)
        .filter((e) => e.type === 'hostile' && e.position.distanceTo(pos) < 16)
        .map((e) => e.name);

      return [
        `Position: x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}`,
        `Health: ${bot.health}/20, food: ${bot.food}/20`,
        `Time: ${bot.time.isDay ? 'day' : 'night'}`,
        `Nearby players: ${players.length ? players.join(', ') : 'none'}`,
        `Hostile mobs (<16m): ${mobs.length ? mobs.join(', ') : 'none'}`,
      ].join('\n');
    },
  });

  registry.register({
    name: 'remember',
    description:
      'Save an important fact to long-term memory (survives restart). ' +
      'Use for player facts, building coordinates, etc.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'Fact to remember.' },
      },
      required: ['fact'],
    },
    async execute(args, ctx) {
      ctx.session.remember(args.fact);
      return 'Fact saved to long-term memory.';
    },
  });

  registry.register({
    name: 'list_tools',
    description: 'List all available tools and their descriptions. Use when unsure what tools exist.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const fs = require('fs');
        return fs.readFileSync(ctx.config.storage.toolsFile, 'utf8').trim();
      } catch {
        return 'Error: could not load tools list.';
      }
    },
  });

  // --- Movement tools ---

  registry.register({
    name: 'go_to',
    description:
      'Navigate to target coordinates using pathfinding. ' +
      'Use for going to specific locations, buildings, players, etc.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Target X coordinate.' },
        y: { type: 'number', description: 'Target Y coordinate (optional, uses current Y if omitted).' },
        z: { type: 'number', description: 'Target Z coordinate.' },
      },
      required: ['x', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const currentY = args.y ?? Math.round(bot.entity.position.y);
      const target = vec3(args.x, currentY, args.z);

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalNear(args.x, currentY, args.z, 2), true);

        const timeout = 30000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const dist = bot.entity.position.distanceTo(target);
          if (dist < 3) {
            bot.pathfinder.setGoal(null);
            const pos = bot.entity.position;
            return `Arrived at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}. Could not reach target (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'move',
    description:
      'Move in a direction for a duration. ' +
      'Use for short movements like stepping forward, backing away, strafing.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['forward', 'backward', 'left', 'right'],
          description: 'Direction to move relative to where you are looking.',
        },
        duration: {
          type: 'number',
          description: 'How long to move in seconds (0.5-5).',
        },
      },
      required: ['direction', 'duration'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const duration = Math.min(Math.max(args.duration, 0.5), 5) * 1000;

      if (args.direction === 'left' || args.direction === 'right') {
        // Strafe: turn 90 degrees, move forward, turn back
        const yaw = bot.entity.yaw;
        if (args.direction === 'left') {
          await bot.look(null, yaw + Math.PI / 2);
        } else {
          await bot.look(null, yaw - Math.PI / 2);
        }
      }

      bot.setControlState(args.direction === 'backward' ? 'back' : 'forward', true);
      await new Promise((r) => setTimeout(r, duration));
      bot.setControlState('forward', false);
      bot.setControlState('back', false);

      const pos = bot.entity.position;
      return `Moved ${args.direction} for ${args.duration}s. Now at x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}.`;
    },
  });

  registry.register({
    name: 'jump',
    description: 'Jump. Use for getting over obstacles, blocks, or gaps.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 400));
      bot.setControlState('jump', false);
      return 'Jumped.';
    },
  });

  registry.register({
    name: 'follow_player',
    description:
      'Follow a player by continuously pathfinding to them. ' +
      'Stops after a duration or when player goes out of range.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to follow.' },
        duration: {
          type: 'number',
          description: 'How long to follow in seconds (5-60). Defaults to 30.',
        },
        distance: {
          type: 'number',
          description: 'Following distance in blocks (2-10). Defaults to 3.',
        },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const duration = Math.min(Math.max(args.duration ?? 30, 5), 60) * 1000;
      const distance = Math.min(Math.max(args.distance ?? 3, 2), 10);

      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby.`;
      }

      bot.pathfinder.setMovements(new Movements(bot));
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, distance), true);

      const started = Date.now();
      while (Date.now() - started < duration) {
        if (!bot.players[args.username]?.entity) {
          bot.pathfinder.setGoal(null);
          return `Player ${args.username} went out of range. Stopped following.`;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      bot.pathfinder.setGoal(null);
      return `Stopped following ${args.username} after ${args.duration ?? 30}s.`;
    },
  });

  // --- New pathfinder tools ---

  registry.register({
    name: 'go_to_y',
    description:
      'Navigate to a specific Y level (height). ' +
      'Use for going up mountains, down caves, or to bedrock/sky limit. ' +
      'Pathfinder will find the closest reachable Y at any X/Z.',
    parameters: {
      type: 'object',
      properties: {
        y: { type: 'number', description: 'Target Y level (height). Min: 1, Max: 319.' },
      },
      required: ['y'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const targetY = Math.min(Math.max(args.y, 1), 319);

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalY(targetY), true);

        const timeout = 45000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const currentY = Math.round(bot.entity.position.y);
          if (Math.abs(currentY - targetY) <= 1) {
            bot.pathfinder.setGoal(null);
            const pos = bot.entity.position;
            return `Reached Y=${currentY} at x=${Math.round(pos.x)}, z=${Math.round(pos.z)}.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at Y=${Math.round(pos.y)}. Could not reach Y=${targetY} (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'approach',
    description:
      'Navigate adjacent to a specific block. ' +
      'Use for chests, crafting tables, doors, furnaces, levers — anything you need to interact with.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Block X coordinate.' },
        y: { type: 'number', description: 'Block Y coordinate (optional, uses current Y).' },
        z: { type: 'number', description: 'Block Z coordinate.' },
      },
      required: ['x', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const blockY = args.y ?? Math.round(bot.entity.position.y);

      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(new goals.GoalGetToBlock(args.x, blockY, args.z), true);

        const timeout = 30000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const pos = bot.entity.position;
          const dist = Math.sqrt(
            Math.pow(pos.x - args.x, 2) +
            Math.pow(pos.z - args.z, 2)
          );
          if (dist < 2.5) {
            bot.pathfinder.setGoal(null);
            return `Approached block at x=${args.x}, y=${blockY}, z=${args.z}. Ready to interact.`;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        bot.pathfinder.setGoal(null);
        const pos = bot.entity.position;
        return `Stopped at x=${Math.round(pos.x)}, z=${Math.round(pos.z)}. Could not approach target (obstacle or timeout).`;
      } catch (err) {
        bot.pathfinder.setGoal(null);
        return `Navigation failed: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'find_block',
    description:
      'Find the nearest block of a given type in loaded chunks. ' +
      'Use to locate chests, ores, trees, doors, etc. near your current position.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Block type name (e.g. chest, oak_log, diamond_ore, stone_bricks).',
        },
        radius: {
          type: 'number',
          description: 'Search radius in blocks (10-100). Defaults to 50.',
        },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const radius = Math.min(Math.max(args.radius ?? 50, 10), 100);
      const pos = bot.entity.position;

      const blockType = args.type.toLowerCase();
      let nearest = null;
      let nearestDist = Infinity;

      // Search in a grid pattern for efficiency
      const step = 2;
      for (let x = -radius; x <= radius; x += step) {
        for (let z = -radius; z <= radius; z += step) {
          if (x * x + z * z > radius * radius) continue;

          for (let y = -10; y <= 10; y += 2) {
            const checkPos = vec3(
              Math.round(pos.x + x),
              Math.round(pos.y + y),
              Math.round(pos.z + z)
            );
            const block = bot.blockAt(checkPos);
            if (block && block.name.includes(blockType)) {
              const dist = pos.distanceTo(checkPos);
              if (dist < nearestDist) {
                nearestDist = dist;
                nearest = checkPos;
              }
            }
          }
        }
      }

      if (!nearest) {
        return `No ${args.type} found within ${radius} blocks. Try increasing radius or moving closer.`;
      }

      return `Found ${args.type} at x=${nearest.x}, y=${nearest.y}, z=${nearest.z} (${Math.round(nearestDist)}m away). Use approach() to get there.`;
    },
  });

  registry.register({
    name: 'lock_view',
    description:
      'Lock your view on a player, continuously looking at them. ' +
      'Useful for keeping eyes on someone while they show you something.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to look at.' },
        duration: {
          type: 'number',
          description: 'How long to lock view in seconds (2-30). Defaults to 10.',
        },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const duration = Math.min(Math.max(args.duration ?? 10, 2), 30) * 1000;

      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby.`;
      }

      const started = Date.now();
      while (Date.now() - started < duration) {
        const entity = bot.players[args.username]?.entity;
        if (!entity) {
          return `Player ${args.username} went out of range. Unlocked view.`;
        }
        try {
          await bot.lookAt(entity.position.offset(0, entity.height, 0));
        } catch {
          // lookAt may fail, continue trying
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      return `Unlocked view from ${args.username} after ${args.duration ?? 10}s.`;
    },
  });
}

module.exports = { registerTools, makeChatSender };
