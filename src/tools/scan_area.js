'use strict';

// Block categories for scan_area
const SCAN_CATEGORIES = {
  hazards: {
    label: '⚠ Hazards',
    blocks: new Set([
      'lava', 'fire', 'cactus', 'magma_block', 'campfire', 'soul_campfire',
      'sweet_berry_bush', 'wither_rose', 'powder_snow',
    ]),
  },
  ores: {
    label: '⛏ Ores',
    blocks: new Set([
      'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore',
      'copper_ore', 'deepslate_copper_ore', 'gold_ore', 'deepslate_gold_ore',
      'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
      'lapis_ore', 'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore',
      'lit_redstone_ore', 'lit_deepslate_redstone_ore', 'nether_gold_ore',
      'nether_quartz_ore', 'ancient_debris',
    ]),
  },
  resources: {
    label: '📦 Resources',
    blocks: new Set([
      'chest', 'trapped_chest', 'ender_chest', 'barrel', 'shulker_box',
      'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
      'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box',
      'pink_shulker_box', 'gray_shulker_box', 'light_gray_shulker_box',
      'cyan_shulker_box', 'purple_shulker_box', 'blue_shulker_box',
      'brown_shulker_box', 'green_shulker_box', 'red_shulker_box',
      'black_shulker_box', 'furnace', 'blast_furnace', 'smoker',
      'brewing_stand', 'cauldron', 'anvil', 'chipped_anvil', 'damaged_anvil',
      'enchanting_table', 'grindstone', 'stonecutter', 'loom', 'cartography_table',
      'fletching_table', 'smithing_table', 'composter', 'crafter',
    ]),
  },
  water: {
    label: '💧 Water',
    blocks: new Set(['water', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']),
  },
  wood: {
    label: '🪵 Wood',
    blocks: new Set([
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log',
      'dark_oak_log', 'mangrove_log', 'cherry_log', 'bamboo_block',
      'crimson_stem', 'warped_stem', 'stripped_oak_log', 'stripped_spruce_log',
      'stripped_birch_log', 'stripped_jungle_log', 'stripped_acacia_log',
      'stripped_dark_oak_log', 'stripped_mangrove_log', 'stripped_cherry_log',
    ]),
  },
  portals: {
    label: '🌀 Portals',
    blocks: new Set(['nether_portal', 'end_portal', 'end_portal_frame', 'end_gateway']),
  },
  spawners: {
    label: '👾 Spawners',
    blocks: new Set(['spawner']),
  },
};

module.exports = function ({ vec3 }) {
  return {
    name: 'scan_area',
    description:
      'Scan nearby blocks and entities to get a situational summary. ' +
      'Reports counts and nearest positions of ores, hazards, resources, water, wood, portals, and spawners. ' +
      'Also lists nearby hostile, passive, and neutral entities. ' +
      'Use for caves, bases, fortresses, lava pools, and ore awareness. ' +
      'More detailed than get_surroundings but limited to loaded chunks.',
    parameters: {
      type: 'object',
      properties: {
        radius: {
          type: 'number',
          description: 'Scan radius in blocks (4-64). Defaults to 32.',
        },
        filter: {
          type: 'string',
          description:
            'Optional category filter to only report specific types: ' +
            'hazards, ores, resources, water, wood, portals, spawners, mobs, all. ' +
            'Defaults to "all".',
        },
      },
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const radius = Math.min(Math.max(args.radius ?? 32, 4), 64);
      const filter = (args.filter ?? 'all').toLowerCase();
      const pos = bot.entity.position;
      const r2 = radius * radius;

      // --- Block scanning ---
      const blockResults = {};
      for (const catKey of Object.keys(SCAN_CATEGORIES)) {
        blockResults[catKey] = { count: 0, nearest: null, nearestDist: Infinity };
      }

      // Scan blocks in a 3D grid with step 2 (coarse for performance)
      const step = 2;
      const yRange = Math.min(radius, 20); // limit vertical scan range
      for (let dx = -radius; dx <= radius; dx += step) {
        for (let dz = -radius; dz <= radius; dz += step) {
          if (dx * dx + dz * dz > r2) continue;
          for (let dy = -yRange; dy <= yRange; dy += step) {
            const checkPos = vec3(
              Math.round(pos.x + dx),
              Math.round(pos.y + dy),
              Math.round(pos.z + dz)
            );
            const block = bot.blockAt(checkPos);
            if (!block || block.name === 'air' || block.name === 'cave_air') continue;

            for (const [catKey, cat] of Object.entries(SCAN_CATEGORIES)) {
              if (cat.blocks.has(block.name)) {
                const entry = blockResults[catKey];
                entry.count++;
                const dist = pos.distanceTo(checkPos);
                if (dist < entry.nearestDist) {
                  entry.nearestDist = dist;
                  entry.nearest = { x: checkPos.x, y: checkPos.y, z: checkPos.z, name: block.name };
                }
              }
            }
          }
        }
      }

      // --- Entity scanning ---
      const entityBuckets = { hostile: [], passive: [], neutral: [] };
      for (const entity of Object.values(bot.entities)) {
        if (!entity?.position || entity === bot.entity) continue;
        const dist = entity.position.distanceTo(pos);
        if (dist > radius) continue;

        const name = entity.name || entity.displayName || 'unknown';
        if (entity.type === 'hostile') {
          entityBuckets.hostile.push({ name, dist: Math.round(dist) });
        } else if (entity.type === 'passive') {
          entityBuckets.passive.push({ name, dist: Math.round(dist) });
        } else if (entity.type === 'player') {
          // skip players — get_surroundings covers that
          continue;
        } else {
          entityBuckets.neutral.push({ name, dist: Math.round(dist) });
        }
      }

      // --- Build output ---
      const lines = [];
      const showAll = filter === 'all';

      // Position header
      lines.push(`Scan (r=${radius}): x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}`);

      // Block categories
      for (const [catKey, cat] of Object.entries(SCAN_CATEGORIES)) {
        if (!showAll && filter !== catKey) continue;
        const entry = blockResults[catKey];
        if (entry.count === 0) {
          lines.push(`${cat.label}: none`);
        } else {
          const nearStr = entry.nearest
            ? `nearest ${entry.nearest.name} at (${entry.nearest.x}, ${entry.nearest.y}, ${entry.nearest.z}, ${Math.round(entry.nearestDist)}m)`
            : '';
          lines.push(`${cat.label}: ${entry.count}${nearStr ? ' — ' + nearStr : ''}`);
        }
      }

      // Entity categories
      if (showAll || filter === 'mobs') {
        // Aggregate entity counts
        const aggregate = (list) => {
          const counts = {};
          for (const e of list) {
            counts[e.name] = (counts[e.name] || 0) + 1;
          }
          return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `${name}${count > 1 ? ` x${count}` : ''}`)
            .join(', ');
        };

        const nearestOf = (list) => {
          if (list.length === 0) return null;
          list.sort((a, b) => a.dist - b.dist);
          return list[0];
        };

        if (entityBuckets.hostile.length > 0) {
          const near = nearestOf(entityBuckets.hostile);
          lines.push(`⚔ Hostile: ${aggregate(entityBuckets.hostile)} — nearest ${near.name} ${near.dist}m`);
        } else if (showAll) {
          lines.push('⚔ Hostile: none');
        }

        if (entityBuckets.passive.length > 0) {
          const near = nearestOf(entityBuckets.passive);
          lines.push(`🐾 Passive: ${aggregate(entityBuckets.passive)} — nearest ${near.name} ${near.dist}m`);
        } else if (showAll) {
          lines.push('🐾 Passive: none');
        }

        if (entityBuckets.neutral.length > 0) {
          const near = nearestOf(entityBuckets.neutral);
          lines.push(`🟡 Neutral: ${aggregate(entityBuckets.neutral)} — nearest ${near.name} ${near.dist}m`);
        } else if (showAll) {
          lines.push('🟡 Neutral: none');
        }
      }

      // Dropped items
      if (showAll || filter === 'resources') {
        const drops = Object.values(bot.entities).filter((e) => {
          if (!e?.position) return false;
          if (e.name !== 'item' && e.displayName !== 'Item') return false;
          return e.position.distanceTo(pos) <= radius;
        });
        if (drops.length > 0) {
          lines.push(`🎒 Dropped items: ${drops.length}`);
        }
      }

      return lines.join('\n');
    },
  };
};