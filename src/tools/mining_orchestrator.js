'use strict';

/**
 * Simplified mining orchestrator.
 *
 * Handles block discovery and collection via mineflayer-collectblock.
 * Does NOT auto-craft or smelt — reports tool needs to the LLM
 * so it can use its own craft/equip tools to prepare.
 *
 * Required plugins: mineflayer-tool, mineflayer-collectblock, mineflayer-pathfinder
 */

const vec3 = require('vec3');

const TOOL_CATEGORIES = [
  ['pickaxe', 'pickaxe'],
  ['axe', 'axe'],
  ['shovel', 'shovel'],
  ['hoe', 'hoe'],
  ['sword', 'sword'],
  ['shears', 'shears'],
];

// ── Public API ─────────────────────────────────────────────────────

/**
 * Mine N blocks of a given type.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {object} mcData
 * @param {object} options
 * @param {string} options.type       — block name (partial ok)
 * @param {number} options.count      — blocks to gather (1–64)
 * @param {number} options.radius     — search radius (10–128)
 * @param {number} options.timeout    — max seconds (30–300)
 * @param {object} config             — app config (unused, kept for API compat)
 * @param {object} log                — logger
 * @returns {Promise<object>}
 */
async function mineBlocks(bot, mcData, options, config, log) {
  const started = Date.now();
  const desired = Math.min(Math.max(options.count ?? 1, 1), 64);
  const radius = Math.min(Math.max(options.radius ?? 50, 10), 128);
  const timeout = Math.min(Math.max(options.timeout ?? 120, 30), 300) * 1000;

  // ── Resolve block IDs ────────────────────────────────────
  const { matchingIds, matchedNames, typeLabel } = resolveBlockType(mcData, options.type);
  if (matchingIds.length === 0) {
    return {
      gathered: 0, desired, typeLabel: options.type,
      stopReason: 'unknown_block', elapsed: 0, unreachable: 0, radius,
      requiredTool: null, brokenTool: null,
    };
  }

  await bot.waitForChunksToLoad();

  // ── Pre-flight: check tool availability ──────────────────
  const sampleEntry = mcData.blocks[matchingIds[0]];
  const harvestTools = sampleEntry?.harvestTools;
  const needsTool = harvestTools && Object.keys(harvestTools).length > 0;
  const toolType = needsTool ? extractToolType(harvestTools, mcData) : null;
  let lastToolName = null;

  if (needsTool) {
    const toolInfo = checkHasTool(bot, mcData, harvestTools);
    if (!toolInfo.hasTool) {
      return {
        gathered: 0, desired, typeLabel,
        stopReason: 'no_tool',
        elapsed: Math.round((Date.now() - started) / 1000),
        unreachable: 0, radius,
        requiredTool: toolType, brokenTool: null,
      };
    }
    lastToolName = toolInfo.bestTool?.name ?? null;
  }

  // ── Mining loop ──────────────────────────────────────────
  let gathered = 0;
  let unreachable = 0;
  let consecutiveFailures = 0;
  const visited = new Set();
  let stopReason = '';
  let brokenTool = null;

  while (gathered < desired && Date.now() - started < timeout) {
    const searchCount = Math.max(desired - gathered + 5, 10);
    let results = bot.findBlocks({
      matching: matchingIds.length === 1 ? matchingIds[0] : matchingIds,
      maxDistance: radius,
      count: searchCount,
    });

    if (!results || results.length === 0) {
      results = gridScan(bot, matchedNames, radius, searchCount);
    }

    if (!results || results.length === 0) {
      stopReason = 'no_more_blocks';
      break;
    }

    const unvisited = results.filter(p => !visited.has(posKey(p)));
    if (unvisited.length === 0) {
      stopReason = 'no_more_blocks';
      break;
    }

    let madeProgress = false;

    for (const targetPos of unvisited) {
      if (gathered >= desired) break;
      if (Date.now() - started >= timeout) { stopReason = 'timeout'; break; }

      visited.add(posKey(targetPos));

      const block = bot.blockAt(targetPos);
      if (!block || !matchedNames.includes(block.name)) continue;

      // Check tool still exists before mining
      if (needsTool) {
        const toolInfo = checkHasTool(bot, mcData, harvestTools);
        if (!toolInfo.hasTool) {
          brokenTool = lastToolName;
          stopReason = 'tool_broke';
          break;
        }
        lastToolName = toolInfo.bestTool?.name ?? lastToolName;
      }

      // Collect the block
      try {
        const currentBlock = bot.blockAt(targetPos);
        if (!currentBlock || !matchedNames.includes(currentBlock.name)) continue;

        await withTimeout(
          bot.collectBlock.collect(currentBlock),
          30_000,
          `collectBlock timed out for ${currentBlock.name}`
        );
        gathered++;
        consecutiveFailures = 0;
        madeProgress = true;
      } catch (err) {
        log.warn(`collectBlock failed for ${block.name}: ${err.message}`);

        // Check if failure was caused by tool breaking
        if (needsTool) {
          const toolInfo = checkHasTool(bot, mcData, harvestTools);
          if (!toolInfo.hasTool) {
            brokenTool = lastToolName;
            stopReason = 'tool_broke';
            break;
          }
        }

        unreachable++;
        consecutiveFailures++;
        if (consecutiveFailures >= 3) { stopReason = 'too_many_unreachable'; break; }
        continue;
      }

      // After successful collect, check if tool broke during dig
      if (needsTool) {
        const toolInfo = checkHasTool(bot, mcData, harvestTools);
        if (!toolInfo.hasTool) {
          brokenTool = lastToolName;
          stopReason = 'tool_broke';
          break;
        }
        lastToolName = toolInfo.bestTool?.name ?? lastToolName;
      }
    }

    if (stopReason) break;
    if (!madeProgress && consecutiveFailures >= 3) {
      stopReason = 'too_many_unreachable';
      break;
    }
    if (gathered >= desired) { stopReason = 'count_reached'; break; }
    if (Date.now() - started >= timeout) { stopReason = 'timeout'; break; }
  }

  if (!stopReason) stopReason = gathered >= desired ? 'count_reached' : 'no_more_blocks';

  // Brief pause for straggling item pickups
  await new Promise(r => setTimeout(r, 1500));

  const elapsed = Math.round((Date.now() - started) / 1000);
  return {
    gathered, desired, typeLabel,
    stopReason, elapsed, unreachable, radius,
    requiredTool: toolType, brokenTool,
  };
}

// ── Tool checking ──────────────────────────────────────────────────

/**
 * Check if bot has any item matching the harvestTools map.
 * Returns { hasTool, bestTool }.
 */
function checkHasTool(bot, mcData, harvestTools) {
  if (!harvestTools || Object.keys(harvestTools).length === 0) {
    return { hasTool: true, bestTool: null };
  }

  const harvestToolIds = new Set(Object.keys(harvestTools).map(Number));
  const invItems = bot.inventory.items() || [];
  const matching = invItems.filter(item => item && harvestToolIds.has(item.type));

  if (matching.length === 0) {
    return { hasTool: false, bestTool: null };
  }

  // Pick the one with most remaining durability
  let best = matching[0];
  let bestRemaining = -1;

  for (const item of matching) {
    const maxDur = mcData.items[item.type]?.maxDurability;
    if (!maxDur) {
      // Indestructible item (like shears) — always prefer
      best = item;
      bestRemaining = Infinity;
      break;
    }
    const remaining = maxDur - item.durability;
    if (remaining > bestRemaining) {
      best = item;
      bestRemaining = remaining;
    }
  }

  return { hasTool: true, bestTool: best };
}

/**
 * Extract human-readable tool type from harvestTools map.
 */
function extractToolType(harvestTools, mcData) {
  if (!harvestTools) return 'tool';
  for (const id of Object.keys(harvestTools)) {
    const item = mcData.items[Number(id)];
    if (!item) continue;
    for (const [keyword, type] of TOOL_CATEGORIES) {
      if (item.name.includes(keyword)) return type;
    }
  }
  return 'tool';
}

// ── Grid scan fallback ──────────────────────────────────────────────

function gridScan(bot, matchedNames, searchRadius, maxResults) {
  const fallbackRadius = Math.min(searchRadius, 16);
  const pos = bot.entity.position;
  const r2 = fallbackRadius * fallbackRadius;
  const yRange = Math.min(fallbackRadius, 20);
  const results = [];

  for (let dx = -fallbackRadius; dx <= fallbackRadius && results.length < maxResults; dx++) {
    for (let dz = -fallbackRadius; dz <= fallbackRadius && results.length < maxResults; dz++) {
      if (dx * dx + dz * dz > r2) continue;
      for (let dy = -yRange; dy <= yRange && results.length < maxResults; dy++) {
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

  results.sort((a, b) => {
    const da = (a.x - pos.x) ** 2 + (a.y - pos.y) ** 2 + (a.z - pos.z) ** 2;
    const db = (b.x - pos.x) ** 2 + (b.y - pos.y) ** 2 + (b.z - pos.z) ** 2;
    return da - db;
  });

  return results;
}

// ── Utility helpers ─────────────────────────────────────────────────

function resolveBlockType(mcData, blockType) {
  const query = blockType.toLowerCase();
  const matchingIds = [];
  const exactBlock = mcData.blocksByName[blockType];
  if (exactBlock) {
    matchingIds.push(exactBlock.id);
  } else {
    for (const [name, block] of Object.entries(mcData.blocksByName)) {
      if (name.includes(query)) matchingIds.push(block.id);
    }
  }

  const matchedNames = Object.entries(mcData.blocksByName)
    .filter(([, b]) => matchingIds.includes(b.id))
    .map(([n]) => n);

  const typeLabel = matchedNames.length <= 3
    ? matchedNames.join(', ')
    : `${matchedNames.slice(0, 3).join(', ')} and ${matchedNames.length - 3} more`;

  return { matchingIds, matchedNames, typeLabel };
}

function posKey(p) {
  return `${p.x},${p.y},${p.z}`;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Stop reason labels (all functions, uniform dispatch) ────────────

const STOP_REASON_LABELS = {
  count_reached: (r) =>
    `Gathered ${r.gathered}/${r.desired} ${r.typeLabel}.`,
  no_more_blocks: (r) =>
    `No more ${r.typeLabel} found within ${r.radius} blocks. Gathered ${r.gathered}/${r.desired}. Try moving to a different area or increasing the radius.`,
  timeout: (r) =>
    `Timed out after ${r.elapsed}s. Gathered ${r.gathered}/${r.desired} ${r.typeLabel}.`,
  too_many_unreachable: (r) =>
    `Stopped after multiple unreachable blocks. Gathered ${r.gathered}/${r.desired} ${r.typeLabel}. Try a different area.`,
  unknown_block: (r) =>
    `Unknown block type "${r.typeLabel}". Check the block name and try again.`,
  no_tool: (r) =>
    `Cannot harvest ${r.typeLabel} — no ${r.requiredTool} available. Craft a ${r.requiredTool} (e.g. wooden_${r.requiredTool} from planks and sticks) and try again.`,
  tool_broke: (r) =>
    `Gathered ${r.gathered}/${r.desired} ${r.typeLabel}. ${r.brokenTool ? `${r.brokenTool} broke` : 'Tool broke'}. Craft a new ${r.requiredTool || 'tool'} and try again.`,
};

module.exports = { mineBlocks, STOP_REASON_LABELS };