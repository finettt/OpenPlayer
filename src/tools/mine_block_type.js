'use strict';

/**
 * Extract human-readable tool type names from a harvestTools map.
 * Groups individual items by category (pickaxe, axe, shovel, etc.)
 */
function extractToolTypes(harvestTools, mcData) {
  const types = new Set();
  for (const id of Object.keys(harvestTools)) {
    const item = mcData.items[Number(id)];
    if (!item) continue;
    const name = item.name;
    if (name.includes('pickaxe')) types.add('pickaxe');
    else if (name.includes('axe')) types.add('axe');
    else if (name.includes('shovel')) types.add('shovel');
    else if (name.includes('hoe')) types.add('hoe');
    else if (name.includes('sword')) types.add('sword');
    else if (name.includes('shears')) types.add('shears');
    else types.add(name);
  }
  return [...types];
}

/**
 * Grid-scan fallback: find matching block positions using bot.blockAt().
 * Used when bot.findBlocks() returns empty despite blocks being visible.
 * Limited to 16-block radius for performance. Returns array of {x,y,z}.
 */
function gridScanFallback(bot, vec3, matchedNames, searchRadius, maxResults) {
  const fallbackRadius = 16;
  const pos = bot.entity.position;
  const r2 = fallbackRadius * fallbackRadius;
  const yRange = Math.min(fallbackRadius, 20);
  const step = 1;
  const results = [];

  for (let dx = -fallbackRadius; dx <= fallbackRadius && results.length < maxResults; dx += step) {
    for (let dz = -fallbackRadius; dz <= fallbackRadius && results.length < maxResults; dz += step) {
      if (dx * dx + dz * dz > r2) continue;
      for (let dy = -yRange; dy <= yRange && results.length < maxResults; dy += step) {
        const checkPos = vec3(
          Math.round(pos.x + dx),
          Math.round(pos.y + dy),
          Math.round(pos.z + dz)
        );
        const block = bot.blockAt(checkPos);
        if (block && matchedNames.includes(block.name)) {
          results.push({ x: checkPos.x, y: checkPos.y, z: checkPos.z });
        }
      }
    }
  }

  // Sort by distance (closest first)
  results.sort((a, b) => {
    const da = (a.x - pos.x) ** 2 + (a.y - pos.y) ** 2 + (a.z - pos.z) ** 2;
    const db = (b.x - pos.x) ** 2 + (b.y - pos.y) ** 2 + (b.z - pos.z) ** 2;
    return da - db;
  });

  return results;
}

module.exports = function ({ vec3, goals, Movements }) {
  return {
    name: 'mine_block_type',
    description:
      'Gather N blocks of a given type by automatically finding, navigating to, and breaking them. ' +
      'Use for resource gathering: wood, stone, coal, iron ore, etc. ' +
      'Supports partial name matching (e.g. "log" matches oak_log, birch_log, etc.). ' +
      'Checks if you have the right tool to harvest the block type before starting. ' +
      'Reports gathered count and stopping reason when done or exhausted.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Block type to mine (e.g. oak_log, stone, coal_ore, iron_ore). ' +
            'Partial names work: "log" matches any log variant.',
        },
        count: {
          type: 'number',
          description: 'Number of blocks to gather (1-64). Defaults to 1.',
        },
        radius: {
          type: 'number',
          description: 'Search radius in blocks (10-128). Defaults to 50.',
        },
        timeout: {
          type: 'number',
          description: 'Maximum seconds to spend mining (30-300). Defaults to 120.',
        },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const mcData = require('minecraft-data')(bot.version);
      const desiredCount = Math.min(Math.max(args.count ?? 1, 1), 64);
      const radius = Math.min(Math.max(args.radius ?? 50, 10), 128);
      const timeout = Math.min(Math.max(args.timeout ?? 120, 30), 300) * 1000;

      // --- Resolve block IDs (exact match first, then substring) ---
      const blockType = args.type.toLowerCase();
      const matchingIds = [];
      const exactBlock = mcData.blocksByName[blockType];
      if (exactBlock) {
        matchingIds.push(exactBlock.id);
      } else {
        for (const [name, block] of Object.entries(mcData.blocksByName)) {
          if (name.includes(blockType)) {
            matchingIds.push(block.id);
          }
        }
      }

      if (matchingIds.length === 0) {
        return `No block type matching "${args.type}" found in registry. Check the block name.`;
      }

      // Build a readable label for the matched types
      const matchedNames = Object.entries(mcData.blocksByName)
        .filter(([, b]) => matchingIds.includes(b.id))
        .map(([n]) => n);
      const typeLabel = matchedNames.length <= 3
        ? matchedNames.join(', ')
        : `${matchedNames.slice(0, 3).join(', ')} and ${matchedNames.length - 3} more`;

      // --- Pre-check: does the bot have the right harvest tool? ---
      // Use the first matching block's registry entry to check harvest requirements.
      // harvestTools is a map of { itemId: true } for tools that can harvest this block.
      // If undefined or empty, the block can be harvested by hand.
      const sampleBlockEntry = mcData.blocks[matchingIds[0]];
      if (sampleBlockEntry && sampleBlockEntry.harvestTools && Object.keys(sampleBlockEntry.harvestTools).length > 0) {
        const harvestTools = sampleBlockEntry.harvestTools;
        const requiredToolIds = Object.keys(harvestTools).map(Number);
        const invItems = bot.inventory.items();
        const toolTypes = extractToolTypes(harvestTools, mcData); // ['pickaxe']
        const hasAny = invItems.some(item =>
          toolTypes.some(toolType => item.name.includes(toolType))
        );
        if (!hasAny) {
          const toolTypes = extractToolTypes(harvestTools, mcData);
          const available = invItems.map(i => i.name).join(', ') || 'empty inventory';
          return `Cannot harvest ${typeLabel}: requires a ${toolTypes.join(' or ')} but none found in inventory. Available items: ${available}. Craft or equip the required tool first.`;
        }
      }

      // --- Wait for chunks to be indexed before searching ---
      await bot.waitForChunksToLoad();

      // --- Mining loop ---
      const started = Date.now();
      let gathered = 0;
      let unreachable = 0;
      let consecutiveFailures = 0;
      const visited = new Set();
      let stopReason = '';

      while (gathered < desiredCount && Date.now() - started < timeout) {
        // Search for matching blocks (request extras to avoid re-searching each loop)
        const searchCount = Math.max(desiredCount - gathered + 5, 10);
        let results = bot.findBlocks({
          matching: matchingIds.length === 1 ? matchingIds[0] : matchingIds,
          maxDistance: radius,
          count: searchCount,
        });

        // Fallback to grid scan if findBlocks returns nothing
        if (!results || results.length === 0) {
          results = gridScanFallback(bot, vec3, matchedNames, radius, searchCount);
        }

        if (results.length === 0) {
          stopReason = 'no_more_blocks';
          break;
        }

        // Filter out already-visited positions
        const unvisited = results.filter(
          (p) => !visited.has(`${p.x},${p.y},${p.z}`)
        );

        if (unvisited.length === 0) {
          stopReason = 'no_more_blocks';
          break;
        }

        // Try each unvisited target
        let madeProgress = false;
        for (const targetPos of unvisited) {
          if (gathered >= desiredCount) break;
          if (Date.now() - started >= timeout) {
            stopReason = 'timeout';
            break;
          }

          const posKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;
          visited.add(posKey);

          // Verify block still exists and matches
          const block = bot.blockAt(targetPos);
          if (!block || !matchedNames.includes(block.name)) continue;
          // --- Navigate adjacent to the block ---
          const navResult = await navigateToBlock(bot, targetPos);
          if (!navResult) {
            unreachable++;
            consecutiveFailures++;
            if (consecutiveFailures >= 3) {
              stopReason = 'too_many_unreachable';
              break;
            }
            continue;
          }

          // Re-verify block after navigation (may have been broken while we moved)
          const blockAfterNav = bot.blockAt(targetPos);
          if (!blockAfterNav || !matchedNames.includes(blockAfterNav.name)) continue;

          // --- Auto-equip best harvest tool ---
          try {
            const bestTool = bot.bestHarvestTool(blockAfterNav);
            if (bestTool) {
              await bot.equip(bestTool, 'hand');
            }
          } catch {
            // Non-fatal: proceed with whatever is currently equipped
          }

          // --- Break the block ---
          try {
            await bot.dig(blockAfterNav);
            gathered++;
            consecutiveFailures = 0;
            madeProgress = true;
          } catch (err) {
            unreachable++;
            consecutiveFailures++;
            if (consecutiveFailures >= 3) {
              stopReason = 'too_many_break_failures';
              break;
            }
            continue;
          }

          // --- Wait briefly for item auto-pickup ---
          await new Promise((r) => setTimeout(r, 800));
        }

        // If we didn't gather anything and hit the failure limit, stop
        if (!madeProgress && consecutiveFailures >= 3) {
          if (!stopReason) stopReason = 'too_many_unreachable';
          break;
        }

        if (gathered >= desiredCount) {
          stopReason = 'count_reached';
          break;
        }
        if (Date.now() - started >= timeout) {
          stopReason = 'timeout';
          break;
        }
      }

      // Default stop reason
      if (!stopReason) {
        stopReason = gathered >= desiredCount ? 'count_reached' : 'no_more_blocks';
      }

      // --- Collect any nearby drops from mining ---
      await collectNearbyDrops(bot, 6);

      // --- Build report ---
      const elapsed = Math.round((Date.now() - started) / 1000);
      const parts = [];

      if (gathered > 0) {
        parts.push(`Gathered ${gathered}/${desiredCount} ${typeLabel}.`);
      } else {
        parts.push(`Failed to gather any ${typeLabel}.`);
      }

      // Human-readable stop reason
      const reasonMap = {
        count_reached: 'Target count reached.',
        no_more_blocks: `No more ${args.type} found within ${radius} blocks. Try moving to a different area or increasing the radius.`,
        timeout: `Timed out after ${elapsed}s.`,
        too_many_unreachable: 'Stopped after multiple unreachable blocks. Try a different area.',
        too_many_break_failures: 'Stopped after multiple break failures. Check if you have the right tool.',
      };
      parts.push(reasonMap[stopReason] || `Stopped: ${stopReason}.`);

      if (unreachable > 0) {
        parts.push(`${unreachable} block(s) were unreachable.`);
      }

      parts.push(`Time: ${elapsed}s.`);

      return parts.join(' ');
    },
  };

  // --- Helper: Navigate adjacent to a block position ---
  async function navigateToBlock(bot, targetPos) {
    try {
      bot.pathfinder.setMovements(new Movements(bot));
      bot.pathfinder.setGoal(
        new goals.GoalGetToBlock(targetPos.x, targetPos.y, targetPos.z),
        true
      );

      const navTimeout = 15000;
      const navStarted = Date.now();

      while (Date.now() - navStarted < navTimeout) {
        const dist = bot.entity.position.distanceTo(
          vec3(targetPos.x, targetPos.y, targetPos.z)
        );
        if (dist < 2.5) {
          bot.pathfinder.setGoal(null);
          return true;
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      bot.pathfinder.setGoal(null);
      return false;
    } catch {
      bot.pathfinder.setGoal(null);
      return false;
    }
  }

  // --- Helper: Collect nearby dropped items ---
  async function collectNearbyDrops(bot, radius) {
    const maxWait = 5000;
    const started = Date.now();

    while (Date.now() - started < maxWait) {
      const items = Object.values(bot.entities).filter((e) => {
        if (!e?.position) return false;
        if (e.name !== 'item' && e.displayName !== 'Item') return false;
        return e.position.distanceTo(bot.entity.position) <= radius;
      });

      if (items.length === 0) break;

      // Sort by distance — pick up closest first
      items.sort(
        (a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
      );

      const target = items[0];
      const dist = bot.entity.position.distanceTo(target.position);

      if (dist < 2) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      // Walk toward the closest item
      try {
        bot.pathfinder.setMovements(new Movements(bot));
        bot.pathfinder.setGoal(
          new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1),
          true
        );

        const itemTimeout = 4000;
        const itemStarted = Date.now();
        while (Date.now() - itemStarted < itemTimeout) {
          if (!bot.entities[target.id]) break;
          const d = bot.entity.position.distanceTo(target.position);
          if (d < 2) {
            await new Promise((r) => setTimeout(r, 300));
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        bot.pathfinder.setGoal(null);
      } catch {
        bot.pathfinder.setGoal(null);
        break;
      }
    }

    bot.pathfinder.setGoal(null);
  }
};