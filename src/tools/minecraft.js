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

  // --- Inventory & status tools ---

  registry.register({
    name: 'drop_item',
    description:
      'Drop items from your inventory. ' +
      'Use to free inventory space, give items to players, or discard junk. ' +
      'If a target player is provided, or exactly one nearby player is detected, face them before dropping.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to drop (e.g. cobblestone, raw_iron, oak_planks).',
        },
        count: {
          type: 'number',
          description: 'How many to drop. Defaults to all matching items in inventory.',
        },
        username: {
          type: 'string',
          description: 'Optional player username to face before dropping the item to them.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const matchingItems = bot.inventory.items().filter((i) => i.name === itemName);

      if (matchingItems.length === 0) {
        return `Error: "${args.item}" not found in inventory. Use get_inventory to check.`;
      }

      const totalCount = matchingItems.reduce((sum, item) => sum + item.count, 0);
      const requestedCount = args.count == null ? totalCount : Math.floor(Number(args.count));
      if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
        return `Error: invalid count "${args.count}". Count must be a positive number.`;
      }

      const toDrop = Math.min(requestedCount, totalCount);
      const item = matchingItems[0];

      let targetPlayer = null;
      if (args.username) {
        targetPlayer = bot.players[args.username];
        if (!targetPlayer?.entity) {
          return `Error: player ${args.username} not found nearby.`;
        }
      } else {
        const nearbyPlayers = Object.values(bot.players).filter(
          (player) =>
            player.username !== bot.username &&
            player.entity &&
            player.entity.position.distanceTo(bot.entity.position) <= 6
        );
        if (nearbyPlayers.length === 1) {
          targetPlayer = nearbyPlayers[0];
        }
      }

      try {
        if (targetPlayer?.entity) {
          await bot.lookAt(targetPlayer.entity.position.offset(0, targetPlayer.entity.height * 0.6, 0), true);
          await new Promise((r) => setTimeout(r, 150));
        }

        await bot.toss(item.type, item.metadata ?? null, toDrop);
        await new Promise((r) => setTimeout(r, 300));

        const left = bot.inventory.items()
          .filter((i) => i.name === itemName)
          .reduce((sum, stack) => sum + stack.count, 0);

        const targetNote = targetPlayer?.username ? ` toward ${targetPlayer.username}` : '';
        return `Dropped ${toDrop}x ${itemName}${targetNote}. ${left > 0 ? `Still have ${left}x left.` : 'None left.'}`;
      } catch (err) {
        return `Failed to drop ${itemName}: ${err.message}`;
      }
    },
  });

  registry.register({
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
  });

  registry.register({
    name: 'get_health_status',
    description:
      'Get current health, food level, and saturation. ' +
      'Use to check if you need to eat or heal.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      return [
        `Health: ${bot.health}/20 (${Math.round(bot.health / 2)} hearts)`,
        `Food: ${bot.food}/20`,
        `Saturation: ${bot.foodSaturation?.toFixed(1) ?? 'unknown'}`,
      ].join('\n');
    },
  });

  registry.register({
    name: 'get_active_effects',
    description:
      'List active potion effects with duration and amplifier. ' +
      'Use to track buffs/debuffs during combat or exploration.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const effects = bot.entity.effects;
      if (!effects || Object.keys(effects).length === 0) {
        return 'No active potion effects.';
      }

      const mcData = require('minecraft-data');
      const effectsMap = mcData(bot.version)?.effects || {};

      const lines = [];
      for (const id of Object.keys(effects)) {
        const eff = effects[id];
        const info = effectsMap[id] || { name: `Unknown(${id})`, type: '?' };
        const amp = eff.amplifier > 0 ? ` ${'Ⅰ'.repeat(eff.amplifier + 1)}` : '';
        const secs = Math.ceil(eff.duration / 20);
        lines.push(`${info.name}${amp}: ${secs}s (${info.type})`);
      }
      return lines.join('\n');
    },
  });

  // --- Block interaction tools ---

  registry.register({
    name: 'break_block',
    description:
      'Break a block at given coordinates. Auto-selects best tool from inventory. ' +
      'Use for mining ores, gathering wood, clearing paths, etc.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Block X coordinate.' },
        y: { type: 'number', description: 'Block Y coordinate.' },
        z: { type: 'number', description: 'Block Z coordinate.' },
      },
      required: ['x', 'y', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const pos = vec3(args.x, args.y, args.z);
      const block = bot.blockAt(pos);
      if (!block) {
        return `No block found at x=${args.x}, y=${args.y}, z=${args.z} (chunk not loaded?).`;
      }

      // Check distance
      const dist = bot.entity.position.distanceTo(pos);
      if (dist > 6) {
        return `Block too far (${Math.round(dist)}m). Move closer first (max ~6m).`;
      }

      try {
        await bot.dig(block);
        return `Broke ${block.name} at x=${args.x}, y=${args.y}, z=${args.z}.`;
      } catch (err) {
        return `Failed to break ${block.name}: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'place_block',
    description:
      'Place the currently held block item on a face of an adjacent block. ' +
      'Use for building, bridging, placing torches, etc. ' +
      'Face is relative to the reference block: north/south/east/west/up/down.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Reference block X coordinate (adjacent to where block will be placed).' },
        y: { type: 'number', description: 'Reference block Y coordinate.' },
        z: { type: 'number', description: 'Reference block Z coordinate.' },
        face: {
          type: 'string',
          enum: ['up', 'down', 'north', 'south', 'east', 'west'],
          description: 'Face of the reference block to place on. Defaults to up.',
        },
      },
      required: ['x', 'y', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const pos = vec3(args.x, args.y, args.z);
      const block = bot.blockAt(pos);
      if (!block) {
        return `No block found at x=${args.x}, y=${args.y}, z=${args.z}.`;
      }

      const heldItem = bot.heldItem;
      if (!heldItem) {
        return 'Error: no item held. Select a block item in hotbar first.';
      }

      const faceMap = {
        up: vec3(0, 1, 0),
        down: vec3(0, -1, 0),
        north: vec3(0, 0, -1),
        south: vec3(0, 0, 1),
        east: vec3(1, 0, 0),
        west: vec3(-1, 0, 0),
      };
      const face = faceMap[args.face ?? 'up'] || vec3(0, 1, 0);

      // Check target space is empty
      const targetPos = pos.plus(face);
      const targetBlock = bot.blockAt(targetPos);
      if (targetBlock && targetBlock.name !== 'air') {
        return `Cannot place block: ${targetBlock.name} already at target position.`;
      }

      try {
        await bot.placeBlock(block, face);
        return `Placed ${heldItem.name} at x=${targetPos.x}, y=${targetPos.y}, z=${targetPos.z}.`;
      } catch (err) {
        return `Failed to place block: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'interact',
    description:
      'Right-click a block. Use for doors, levers, buttons, chests, crafting tables, furnaces, beds, etc.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Block X coordinate.' },
        y: { type: 'number', description: 'Block Y coordinate.' },
        z: { type: 'number', description: 'Block Z coordinate.' },
      },
      required: ['x', 'y', 'z'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const pos = vec3(args.x, args.y, args.z);
      const block = bot.blockAt(pos);
      if (!block) {
        return `No block found at x=${args.x}, y=${args.y}, z=${args.z}.`;
      }

      const dist = bot.entity.position.distanceTo(pos);
      if (dist > 5) {
        return `Block too far (${Math.round(dist)}m). Move closer first.`;
      }

      try {
        await bot.activateBlock(block);
        return `Right-clicked ${block.name} at x=${args.x}, y=${args.y}, z=${args.z}.`;
      } catch (err) {
        return `Failed to interact with ${block.name}: ${err.message}`;
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
      'Start following a player continuously. Use cancel_follow to stop.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to follow.' },
        distance: {
          type: 'number',
          description: 'Following distance in blocks (2-10). Defaults to 3.',
        },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const distance = Math.min(Math.max(args.distance ?? 3, 2), 10);

      // Cancel any existing follow
      if (bot._followInterval) {
        clearInterval(bot._followInterval);
        bot._followInterval = null;
      }
      bot.pathfinder.setGoal(null);

      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby.`;
      }

      bot.pathfinder.setMovements(new Movements(bot));
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, distance), true);

      bot._followInterval = setInterval(() => {
        const entity = bot.players[args.username]?.entity;
        if (!entity) {
          clearInterval(bot._followInterval);
          bot._followInterval = null;
          bot.pathfinder.setGoal(null);
          bot.emit('chat', bot.username, `[bot] Player ${args.username} went out of range. Stopped following.`);
          return;
        }
        // Update goal to track player's new position
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, distance), true);
      }, 500);

      return `Now following ${args.username}. Use cancel_follow to stop.`;
    },
  });

  registry.register({
    name: 'cancel_follow',
    description: 'Stop following a player.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      if (bot._followInterval) {
        clearInterval(bot._followInterval);
        bot._followInterval = null;
      }
      bot.pathfinder.setGoal(null);
      return 'Stopped following.';
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
      'Lock your view on a player, continuously looking at them. Use cancel_lock_view to stop.',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Player username to look at.' },
      },
      required: ['username'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;

      // Cancel any existing lock_view
      if (bot._lockViewInterval) {
        clearInterval(bot._lockViewInterval);
        bot._lockViewInterval = null;
      }

      const player = bot.players[args.username];
      if (!player?.entity) {
        return `Player ${args.username} not found nearby.`;
      }

      bot._lockViewInterval = setInterval(() => {
        const entity = bot.players[args.username]?.entity;
        if (!entity) {
          clearInterval(bot._lockViewInterval);
          bot._lockViewInterval = null;
          return;
        }
        try {
          bot.lookAt(entity.position.offset(0, entity.height, 0));
        } catch {
          // lookAt may fail, continue trying
        }
      }, 200);

      return `Now locking view on ${args.username}. Use cancel_lock_view to stop.`;
    },
  });

  registry.register({
    name: 'cancel_lock_view',
    description: 'Stop locking your view on a player.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      if (bot._lockViewInterval) {
        clearInterval(bot._lockViewInterval);
        bot._lockViewInterval = null;
      }
      return 'Unlocked view.';
    },
  });

  // --- Crafting tools ---

  registry.register({
    name: 'create_workbench',
    description:
      'Craft and place a crafting table (workbench) near your current position. ' +
      'Requires 4 planks in inventory. Use this before crafting tools/items that need a 3x3 grid.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);

      // Check if we have a crafting table already
      const craftingTableItem = bot.inventory.items().find((i) => i.name === 'crafting_table');
      if (!craftingTableItem) {
        // Need to craft one from planks
        const planks = bot.inventory.items().find((i) => i.name.includes('planks'));
        if (!planks || planks.count < 4) {
          return 'Error: need at least 4 planks to craft a crafting table. Gather wood first.';
        }

        const craftingTableType = mcData.itemsByName.crafting_table;
        if (!craftingTableType) {
          return 'Error: crafting_table not found in game data.';
        }

        // 2x2 recipe for crafting table (no table needed)
        const recipes = bot.recipesFor(craftingTableType.id, null, 1, null);
        if (recipes.length === 0) {
          return 'Error: no recipe found for crafting table with current inventory.';
        }

        try {
          await bot.craft(recipes[0], 1, null);
        } catch (err) {
          return `Failed to craft crafting table: ${err.message}`;
        }
      }

      // Now place the crafting table
      const tableItem = bot.inventory.items().find((i) => i.name === 'crafting_table');
      if (!tableItem) {
        return 'Error: crafting table not in inventory after crafting attempt.';
      }

      // Find a suitable spot to place (on ground near bot)
      const pos = bot.entity.position;
      const floorY = Math.floor(pos.y) - 1;
      let placed = false;

      for (const offset of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const checkPos = vec3(
          Math.floor(pos.x) + offset[0],
          floorY + 1,
          Math.floor(pos.z) + offset[1]
        );
        const blockAbove = bot.blockAt(checkPos);
        const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));

        if (blockAbove && blockAbove.name === 'air' && blockBelow && blockBelow.name !== 'air') {
          try {
            await bot.equip(tableItem, 'hand');
            await bot.placeBlock(blockBelow, vec3(0, 1, 0));
            placed = true;
            return `Placed crafting table at x=${checkPos.x}, y=${checkPos.y}, z=${checkPos.z}. Use approach() then craft() to use it.`;
          } catch (err) {
            // Try next position
          }
        }
      }

      if (!placed) {
        return 'Could not find suitable spot to place crafting table. Clear some space around you.';
      }
      return 'Crafting table placed.';
    },
  });

  registry.register({
    name: 'craft',
    description:
      'Craft an item. For 3x3 recipes (tools, armor, etc.), you must be near a crafting table. ' +
      'For 2x2 recipes (planks, sticks, torches), no table needed. ' +
      'Returns error if missing materials or recipe not found.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to craft (e.g. oak_planks, stick, wooden_pickaxe, furnace).',
        },
        count: {
          type: 'number',
          description: 'How many to craft (defaults to 1). May craft more if recipe yields multiple.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);
      const count = args.count ?? 1;

      const itemName = args.item.toLowerCase().replace(/ /g, '_');
      const itemType = mcData.itemsByName[itemName];
      if (!itemType) {
        return `Error: unknown item "${args.item}". Check spelling (use underscores, e.g. wooden_pickaxe).`;
      }

      // Find nearby crafting table (within 4 blocks)
      let craftingTable = null;
      const pos = bot.entity.position;
      for (let x = -4; x <= 4; x++) {
        for (let y = -2; y <= 2; y++) {
          for (let z = -4; z <= 4; z++) {
            const block = bot.blockAt(pos.offset(x, y, z));
            if (block && block.name === 'crafting_table') {
              craftingTable = block;
              break;
            }
          }
          if (craftingTable) break;
        }
        if (craftingTable) break;
      }

      // Get recipes - try with crafting table first, then without
      let recipes = bot.recipesFor(itemType.id, null, count, craftingTable);
      if (recipes.length === 0 && craftingTable) {
        // Maybe it's a 2x2 recipe, try without table
        recipes = bot.recipesFor(itemType.id, null, count, null);
      }
      if (recipes.length === 0 && !craftingTable) {
        // No table nearby and no 2x2 recipe found
        return `Error: no recipe found for ${args.item}. Either missing materials or need a crafting table nearby.`;
      }
      if (recipes.length === 0) {
        return `Error: no recipe found for ${args.item} with current inventory. Check materials.`;
      }

      // Use first available recipe
      const recipe = recipes[0];
      const useTable = recipe.requiresTable ? craftingTable : null;

      try {
        await bot.craft(recipe, count, useTable);
        const crafted = bot.inventory.items().find((i) => i.name === itemName);
        const newCount = crafted ? crafted.count : 0;
        return `Crafted ${args.item}. Now have ${newCount}x ${args.item} in inventory.`;
      } catch (err) {
        return `Failed to craft ${args.item}: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'smelt',
    description:
      'Smelt items in a furnace. Must be near a furnace. ' +
      'Puts input items and fuel into furnace, waits for smelting to complete. ' +
      'Use for ores, raw food, sand→glass, etc.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item to smelt (e.g. raw_iron, raw_beef, cobblestone, sand).',
        },
        count: {
          type: 'number',
          description: 'How many to smelt (defaults to 1).',
        },
        fuel: {
          type: 'string',
          description: 'Fuel to use (e.g. coal, charcoal, planks). Defaults to any available fuel.',
        },
      },
      required: ['item'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const count = args.count ?? 1;
      const itemName = args.item.toLowerCase().replace(/ /g, '_');

      // Find nearby furnace
      let furnaceBlock = null;
      const pos = bot.entity.position;
      for (let x = -4; x <= 4; x++) {
        for (let y = -2; y <= 2; y++) {
          for (let z = -4; z <= 4; z++) {
            const block = bot.blockAt(pos.offset(x, y, z));
            if (block && (block.name === 'furnace' || block.name === 'lit_furnace')) {
              furnaceBlock = block;
              break;
            }
          }
          if (furnaceBlock) break;
        }
        if (furnaceBlock) break;
      }

      if (!furnaceBlock) {
        return 'Error: no furnace found within 4 blocks. Craft and place a furnace first.';
      }

      // Check we have the item to smelt
      const inputItem = bot.inventory.items().find((i) => i.name === itemName);
      if (!inputItem || inputItem.count < count) {
        const have = inputItem?.count ?? 0;
        return `Error: need ${count}x ${args.item} but only have ${have}.`;
      }

      // Find fuel
      const fuelTypes = ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks',
                         'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks',
                         'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks',
                         'coal_block', 'lava_bucket', 'blaze_rod'];
      let fuelItem = null;
      if (args.fuel) {
        const fuelName = args.fuel.toLowerCase().replace(/ /g, '_');
        fuelItem = bot.inventory.items().find((i) => i.name === fuelName);
        if (!fuelItem) {
          return `Error: fuel "${args.fuel}" not found in inventory.`;
        }
      } else {
        for (const f of fuelTypes) {
          fuelItem = bot.inventory.items().find((i) => i.name === f);
          if (fuelItem) break;
        }
      }

      if (!fuelItem) {
        return 'Error: no fuel found in inventory. Need coal, charcoal, planks, etc.';
      }

      // Open furnace and smelt
      let furnace;
      try {
        furnace = await bot.openFurnace(furnaceBlock);
      } catch (err) {
        return `Failed to open furnace: ${err.message}`;
      }

      try {
        // Put fuel in
        const fuelNeeded = Math.ceil(count / 8); // Each coal smelts 8 items
        const fuelToUse = Math.min(fuelNeeded, fuelItem.count);
        await furnace.putFuel(fuelItem.type, null, fuelToUse);

        // Put input items in
        await furnace.putInput(inputItem.type, null, count);

        // Wait for smelting (10 seconds per item, max 2 minutes)
        const waitTime = Math.min(count * 10000 + 2000, 120000);
        const started = Date.now();

        while (Date.now() - started < waitTime) {
          await new Promise((r) => setTimeout(r, 1000));
          const output = furnace.outputItem();
          if (output && output.count >= count) {
            break;
          }
          // Check if furnace stopped (no fuel or input)
          if (!furnace.inputItem() && !furnace.outputItem()) {
            break;
          }
        }

        // Take output
        const output = furnace.outputItem();
        if (output) {
          await furnace.takeOutput();
          furnace.close();
          return `Smelted ${output.count}x ${output.name}. Check inventory.`;
        }

        furnace.close();
        return `Smelting in progress. Items may still be cooking. Check furnace again later.`;
      } catch (err) {
        try { furnace.close(); } catch { /* ignore */ }
        return `Smelting failed: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'get_recipe',
    description:
      'Look up crafting recipes for an item. Shows required ingredients and whether a crafting table is needed. ' +
      'Use before crafting to check what materials you need.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'Item name to look up (e.g. wooden_pickaxe, furnace, iron_sword, chest).',
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

      const lines = [`Recipes for ${args.item} (${allRecipes.length} found):\n`];

      for (let i = 0; i < Math.min(allRecipes.length, 3); i++) {
        const recipe = allRecipes[i];
        const requiresTable = !recipesWithoutTable.some((r) => JSON.stringify(r) === JSON.stringify(recipe));

        lines.push(`Recipe ${i + 1}${requiresTable ? ' (needs crafting table)' : ' (2x2, no table needed)'}:`);

        // Collect ingredients from delta (ingredients consumed)
        const ingredients = {};
        if (recipe.delta) {
          for (const delta of recipe.delta) {
            if (delta.count < 0) {
              // Consumed item
              const ingItem = mcData.items[delta.id];
              const name = ingItem ? ingItem.name : `item_${delta.id}`;
              ingredients[name] = (ingredients[name] || 0) + Math.abs(delta.count);
            }
          }
        }

        // Fallback: parse inShape if delta is empty
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

        // Check if player has materials
        const missing = [];
        for (const [name, needed] of Object.entries(ingredients)) {
          const have = bot.inventory.items()
            .filter((it) => it.name === name)
            .reduce((sum, it) => sum + it.count, 0);
          if (have < needed) {
            missing.push(`${needed - have}x ${name}`);
          }
        }
        if (missing.length > 0) {
          lines.push(`  Missing: ${missing.join(', ')}`);
        } else if (Object.keys(ingredients).length > 0) {
          lines.push('  ✓ You have all materials!');
        }

        lines.push('');
      }

      return lines.join('\n').trim();
    },
  });
}

module.exports = { registerTools, makeChatSender };
