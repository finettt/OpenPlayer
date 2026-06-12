'use strict';

/**
 * defence_mode tool — Toggle automatic self-defence against hostile mobs.
 *
 * When ON:
 *   - Periodically scans for the nearest hostile entity within range
 *   - Automatically attacks it using mineflayer-pvp
 *   - Switches targets if a closer hostile appears
 *   - Stops attacking when no hostiles are nearby
 *
 * When OFF:
 *   - Stops the auto-defence loop
 *   - Stops any current pvp attack
 *
 * State is stored on the bot instance: bot._defenceMode
 *
 * Also exports enableDefence(bot) and disableDefence(bot) so that
 * index.js can auto-enable defence on damage without duplicating logic.
 */

const { Movements } = require('mineflayer-pathfinder');

const SCAN_INTERVAL_MS = 1000;   // How often to check for hostiles
const DEFENCE_RANGE = 16;        // Blocks — only engage hostiles within this range
const VIEW_DISTANCE = 24;        // Blocks — lose interest beyond this

/**
 * Find the nearest hostile entity within the given range.
 */
function findNearestHostile(bot, range) {
  const pos = bot.entity.position;
  let best = null;
  let bestDist = Infinity;

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity.position) continue;
    if (entity.type !== 'hostile') continue;

    const dist = entity.position.distanceTo(pos);
    if (dist > range) continue;

    if (dist < bestDist) {
      bestDist = dist;
      best = entity;
    }
  }

  return best ? { entity: best, dist: bestDist } : null;
}

/**
 * Enable defence mode: start the scan-attack loop.
 * Can be called from the tool or from index.js auto-defence.
 */
function enableDefence(bot) {
  // If already enabled, just report status
  if (bot._defenceMode?.active) {
    return `Defence mode is already ON. Currently ${bot._defenceMode.currentTarget ? `fighting ${bot._defenceMode.currentTarget}` : 'scanning for hostiles'}.`;
  }

  // Stop any current pvp attack to start clean
  try { bot.pvp.stop(); } catch { /* ignore */ }

  // Configure pvp movements
  try {
    const movements = new Movements(bot);
    bot.pvp.movements = movements;
  } catch { /* ignore */ }

  const state = {
    active: true,
    currentTarget: null,
    interval: null,
    killCount: 0,
  };
  bot._defenceMode = state;

  // Listen for pvp events to track kills
  const onStoppedAttacking = () => {
    if (state.active) {
      state.currentTarget = null;
    }
  };

  bot.on('stoppedAttacking', onStoppedAttacking);

  // Main defence loop
  state.interval = setInterval(() => {
    if (!state.active || !bot.entity) {
      clearInterval(state.interval);
      return;
    }

    // If we're already attacking someone, check if they're still valid and in range
    if (bot.pvp.target) {
      const target = bot.pvp.target;
      if (!target.isValid) {
        // Target died or despawned — find next
        state.currentTarget = null;
        try { bot.pvp.stop(); } catch { /* ignore */ }
        // Will fall through to scan for next target
      } else {
        const dist = target.position.distanceTo(bot.entity.position);
        if (dist > VIEW_DISTANCE) {
          // Target too far, lose interest
          state.currentTarget = null;
          try { bot.pvp.stop(); } catch { /* ignore */ }
        } else {
          // Still fighting, don't switch targets mid-fight unless a much closer one appears
          const nearest = findNearestHostile(bot, DEFENCE_RANGE);
          if (nearest && nearest.entity !== target) {
            const currentDist = target.position.distanceTo(bot.entity.position);
            // Switch if new target is less than half the distance of current
            if (nearest.dist < currentDist * 0.5) {
              const name = nearest.entity.name || nearest.entity.displayName || 'unknown';
              state.currentTarget = name;
              try { bot.pvp.attack(nearest.entity); } catch { /* ignore */ }
            }
          }
          return;
        }
      }
    }

    // Scan for nearest hostile
    const nearest = findNearestHostile(bot, DEFENCE_RANGE);
    if (nearest) {
      const name = nearest.entity.name || nearest.entity.displayName || 'unknown';
      state.currentTarget = name;
      try {
        bot.pvp.attack(nearest.entity);
      } catch (err) {
        // Attack failed — will retry next interval
        state.currentTarget = null;
      }
    }
    // If no hostile found, just wait silently (don't spam)
  }, SCAN_INTERVAL_MS);

  // Store cleanup function
  state._cleanup = () => {
    bot.removeListener('stoppedAttacking', onStoppedAttacking);
  };

  return 'Defence mode ON. Automatically fighting nearby hostile mobs. Use defence_mode(enabled=false) to disable.';
}

/**
 * Disable defence mode: stop the scan-attack loop.
 */
function disableDefence(bot) {
  if (!bot._defenceMode?.active) {
    return 'Defence mode is already OFF.';
  }

  const state = bot._defenceMode;
  state.active = false;

  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }

  // Stop current attack
  try { bot.pvp.stop(); } catch { /* ignore */ }

  // Clean up event listeners
  if (state._cleanup) {
    state._cleanup();
  }

  state.currentTarget = null;
  return 'Defence mode OFF. Stopped auto-attacking.';
}

module.exports = function ({ goals, Movements: _Movements }) {
  return {
    name: 'defence_mode',
    description:
      'Toggle automatic self-defence mode. When ON, the bot will continuously ' +
      'fight the nearest hostile mob within range. When OFF, stops auto-attacking. ' +
      'Use this to protect yourself without manually calling attack_entity each time. ' +
      'Defence mode is also auto-enabled when you take damage from hostile mobs.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable defence mode, false to disable.',
        },
      },
      required: ['enabled'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;

      // Verify pvp plugin is loaded
      if (!bot.pvp) {
        return 'Error: PVP plugin is not loaded. Cannot use defence mode.';
      }

      const enable = args.enabled === true;

      if (enable) {
        return enableDefence(bot);
      } else {
        return disableDefence(bot);
      }
    },
  };
};

// Export enable/disable for use by index.js auto-defence on damage
module.exports.enableDefence = enableDefence;
module.exports.disableDefence = disableDefence;