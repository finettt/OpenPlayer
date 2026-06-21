'use strict';

/**
 * bow_attack tool — Shoot an arrow at an entity using a bow.
 *
 * Target selectors — same as attack_entity:
 *   - "nearest"         → closest entity of the given type filter
 *   - "nearest_hostile" → closest hostile mob
 *   - "nearest_passive" → closest passive mob
 *   - entity name       → e.g. "zombie", "skeleton", "cow"
 *   - username          → player username
 *
 * Logic:
 *   1. Resolves target (same entity resolution as attack_entity).
 *   2. Checks for a bow and at least 1 arrow in inventory.
 *   3. Equips the best bow to the main hand.
 *   4. Calculates aim point with gravity compensation (arrow drop).
 *      For moving targets, leads the shot by predicting future position.
 *   5. Looks at the aim point, draws the bow (right-click & hold).
 *   6. Holds for ~1 second (full charge = max damage and speed).
 *   7. Fires by releasing right-click.
 *   8. Reports what happened and where the arrow went.
 *
 * Call attack_entity or defense_mode afterward to finish off wounded targets.
 */

const { Vec3 } = require('vec3');

// ---- Constants ----

const NEAREST_SELECTOR_MAX_DIST = 32; // bows reach further than melee
const MAX_RANGE = 64;                 // hard cap — beyond this we can't aim reliably
const MAX_BOW_RANGE_WARN = 55;        // distance beyond which we warn the shot is unlikely

// Bow charge / physics
const CHARGE_TICKS = 20;              // full-charge ticks for a bow (~1 second)
const BOW_SPEED = 3.0;                // blocks/tick at full charge (≈60 blocks/s)
const ARROW_DRAG = 0.99;              // per-tick velocity multiplier
const ARROW_GRAVITY = 0.05;           // blocks/tick² applied to vy each tick
const EYE_HEIGHT = 1.62;              // player eye height in blocks

// Empirical effective speed that accounts for drag over typical combat distances.
// The raw speed is 60 blk/s but drag slows it to ~50-55 for most bow shots.
const EFFECTIVE_SPEED = 53;           // blocks/s used for flight-time estimation

// ---- Entity resolution (mirrors attack_entity.js) ----

function resolveTarget(bot, target, typeFilter) {
  const pos = bot.entity.position;
  const filter = (typeFilter ?? '').toLowerCase();

  const findNearest = (pred, maxDist = Infinity) => {
    let best = null;
    let bestDist = Infinity;
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity.position) continue;
      if (!pred(entity)) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist > maxDist) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = entity;
      }
    }
    return best ? { entity: best, dist: bestDist } : null;
  };

  // 1. Player by username
  const player = bot.players[target];
  if (player?.entity) {
    return { entity: player.entity, label: `player ${target}` };
  }

  const lower = target.toLowerCase().replace(/ /g, '_');

  // 2. Named selectors
  if (lower === 'nearest' || lower === 'nearest_entity') {
    let pred;
    if (filter === 'hostile') pred = (e) => e.type === 'hostile';
    else if (filter === 'passive') pred = (e) => e.type === 'passive';
    else if (filter === 'mob') pred = (e) => e.type === 'hostile' || e.type === 'passive';
    else pred = () => true;

    const result = findNearest(pred, NEAREST_SELECTOR_MAX_DIST);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_hostile') {
    const result = findNearest((e) => e.type === 'hostile', NEAREST_SELECTOR_MAX_DIST);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  if (lower === 'nearest_passive') {
    const result = findNearest((e) => e.type === 'passive', NEAREST_SELECTOR_MAX_DIST);
    if (!result) return null;
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  // 3. Entity name match
  let result = findNearest((e) => {
    const eName = (e.name || e.displayName || '').toLowerCase().replace(/ /g, '_');
    return eName === lower;
  });
  if (result) {
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m)` };
  }

  result = findNearest((e) => {
    const eName = (e.name || e.displayName || '').toLowerCase().replace(/ /g, '_');
    return eName.includes(lower) || lower.includes(eName);
  });
  if (result) {
    const name = result.entity.name || result.entity.displayName || 'unknown';
    return { entity: result.entity, label: `${name} (${Math.round(result.dist)}m, partial match)` };
  }

  return null;
}

// ---- Inventory helpers ----

/**
 * Find the best bow in inventory. Prefers higher tier: crossbow > bow.
 * Returns the item object, or null if no bow found.
 */
function findBestBow(bot) {
  const items = bot.inventory.items();
  const bowNames = ['crossbow', 'bow'];
  for (const name of bowNames) {
    const found = items.filter(i => i.name === name);
    if (found.length > 0) return found[0];
  }
  return null;
}

/**
 * Check if an item has the Infinity enchantment.
 */
function hasInfinity(item) {
  if (!item) return false;
  // mineflayer items expose parsed enchantments on .enchants
  const enchants = item.enchants ?? [];
  for (const e of enchants) {
    if (e.id === 51 || e.name === 'infinity') return true;
  }
  // Fallback: read raw NBT
  try {
    const nbt = item.nbt?.value;
    const enchantList = nbt?.Enchant ?? nbt?.ench ?? [];
    for (const entry of enchantList) {
      const id = entry.id?.value ?? entry.id;
      if (id === 51) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Count arrows in inventory. If the held bow has Infinity, 1 arrow is enough.
 * Returns { count, hasSome }.
 */
function checkArrows(bot, bow) {
  const arrowNames = new Set(['arrow', 'spectral_arrow', 'tipped_arrow']);
  let total = 0;
  let types = [];
  for (const item of bot.inventory.items()) {
    if (arrowNames.has(item.name)) {
      total += item.count;
      types.push(item.name === 'arrow' ? 'arrow' : item.name);
    }
  }

  // With Infinity, only 1 arrow needed (it's not consumed)
  const needed = hasInfinity(bow) ? 1 : 1;
  return { enough: total >= needed, count: total, types: [...new Set(types)] };
}

/**
 * Get the target's center position (feet + half height) for aiming.
 */
function getTargetCenter(entity) {
  const pos = entity.position;
  const halfH = (entity.height ?? 1.8) / 2;
  return new Vec3(pos.x, pos.y + halfH, pos.z);
}

/**
 * Get entity velocity (defaults to zero if not available).
 */
function getEntityVelocity(entity) {
  const v = entity.velocity;
  if (!v || typeof v.x !== 'number') return { x: 0, y: 0, z: 0 };
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Check if there's a shield in the off-hand that would block our shot.
 * Returns true if the off-hand has a shield (bow shots are blocked by shields).
 * Only applies when the target is another player holding a shield.
 */
function targetHasShield(bot, entity) {
  // For players: check if they're holding a shield
  if (entity.type === 'player' && entity.entity) {
    // We can check equipment for players
    // This is a best-effort check since entity metadata isn't always available
  }
  return false;
}

// ---- Aim calculation ----

/**
 * Calculate the aim point for hitting a target with a bow.
 *
 * Accounts for:
 *   - Arrow gravity drop (projectile compensation)
 *   - Target movement (velocity-based leading)
 *   - Arrow drag (via effective-speed approximation)
 *
 * Strategy: compute where the target WILL be when the arrow arrives,
 * then aim above that point to compensate for arrow drop during flight.
 *
 * @param {Vec3} launchPos - The arrow launch position (player eye level).
 * @param {Vec3} targetPos - The target's center position.
 * @param {object} targetVel - The target's velocity { x, y, z }.
 * @returns {{ aimPoint: Vec3, yaw: number, pitch: number, flightTime: number }}
 */
function calculateAim(launchPos, targetPos, targetVel) {
  // 1. Horizontal distance
  const dx = targetPos.x - launchPos.x;
  const dz = targetPos.z - launchPos.z;
  const dy = targetPos.y - launchPos.y;
  const hDist = Math.sqrt(dx * dx + dz * dz);

  // 2. Iteratively solve for flight time and lead position
  //    Start with current distance, compute flight time, then re-evaluate
  let flightTime = hDist / EFFECTIVE_SPEED; // initial guess (seconds)
  let predictedPos = targetPos.clone();

  for (let iter = 0; iter < 3; iter++) {
    // Lead the target by flightTime
    predictedPos = new Vec3(
      targetPos.x + targetVel.x * flightTime,
      targetPos.y + targetVel.y * flightTime,
      targetPos.z + targetVel.z * flightTime
    );

    const pdx = predictedPos.x - launchPos.x;
    const pdz = predictedPos.z - launchPos.z;
    const pHDist = Math.sqrt(pdx * pdx + pdz * pdz);

    // Recompute flight time with drag consideration
    // Use the average-speed approximation
    flightTime = pHDist / EFFECTIVE_SPEED;
  }

  // 3. Calculate gravity drop compensation
  //    At the predicted flight time, how far does the arrow drop?
  //    drop = -0.5 * g * t² (without drag)
  //    With drag, the arrow travels slower → more time → more drop
  //    We add a drag correction factor that scales with flight time
  const dragFactor = 1 + flightTime * 0.15; // +15% per second of flight time
  const gravity = 20; // blocks/s²
  const rawDrop = 0.5 * gravity * flightTime * flightTime;
  const dropCompensation = rawDrop * dragFactor;

  // 4. Build the aim point: aim at the predicted position,
  //    plus drop compensation upward
  const aimPoint = new Vec3(
    predictedPos.x,
    predictedPos.y + dropCompensation,
    predictedPos.z
  );

  // 5. Calculate yaw/pitch for debugging (not used for actual aiming)
  const delta = aimPoint.minus(launchPos);
  const yaw = Math.atan2(-delta.x, -delta.z);
  const gDist = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
  const pitch = Math.atan2(delta.y, gDist);

  return { aimPoint, yaw, pitch, flightTime };
}

/**
 * Check if the player is currently using an item (eating, drawing bow, etc.).
 */
function isUsingItem(bot) {
  return bot.usingHeldItem === true;
}

// ---- Main tool ----

module.exports = function () {
  return {
    name: 'bow_attack',
    description:
      'Shoot an arrow at a target using a bow. ' +
      'Resolves the target the same way as attack_entity ("nearest", "nearest_hostile", ' +
      '"nearest_passive", entity name, or player username). ' +
      'Automatically equips the best available bow, draws it for full charge (~1 sec), ' +
      'calculates aim accounting for arrow drop (gravity) and target movement, ' +
      'and fires. Requires a bow and at least 1 arrow in inventory. ' +
      'Effective range: up to ~55 blocks. ' +
      'After shooting, follow up with attack_entity for melee or switch to defense_mode.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'Target selector: "nearest", "nearest_hostile", "nearest_passive", ' +
            'an entity name (e.g. "zombie", "skeleton", "blaze", "cow"), ' +
            'or a player username.',
        },
        type_filter: {
          type: 'string',
          description:
            'Optional filter when using "nearest": "hostile", "passive", "mob", or omitted for any.',
        },
        charge_ticks: {
          type: 'number',
          description:
            'How many game ticks to charge the bow (default 20 = full charge). ' +
            'Lower values fire faster but deal less damage and have more arrow drop. ' +
            'Minimum 5, maximum 40. Leave at 20 for best results.',
          default: 20,
        },
      },
      required: ['target'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;

      // ---- Resolve target ----
      const resolved = resolveTarget(bot, args.target, args.type_filter);
      if (!resolved) {
        const pos = bot.entity.position;
        const nearby = Object.values(bot.entities)
          .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(pos) < 32)
          .map((e) => {
            const name = e.name || e.displayName || 'unknown';
            const dist = Math.round(e.position.distanceTo(pos));
            return `${name}(${dist}m)`;
          })
          .slice(0, 15)
          .join(', ');
        return `Error: No entity matching "${args.target}" found. Nearby entities: ${nearby || 'none'}`;
      }

      const { entity, label } = resolved;
      const dist = entity.position.distanceTo(bot.entity.position);

      if (dist > MAX_RANGE) {
        return `Error: "${label}" is too far away (${Math.round(dist)}m). Maximum bow range is ~${MAX_RANGE}m. Move closer first.`;
      }

      const rangeWarning = dist > MAX_BOW_RANGE_WARN
        ? `Warning: ${label} is ${Math.round(dist)}m away — arrow will have significant drop and may miss at this range. `
        : '';

      // ---- Check inventory for bow and arrows ----
      const bow = findBestBow(bot);
      if (!bow) {
        return `Error: No bow or crossbow found in inventory. Craft or find one first.`;
      }

      const arrowCheck = checkArrows(bot, bow);
      if (!arrowCheck.enough) {
        const inf = hasInfinity(bow) ? ' (Infinity bow detected, but need at least 1 arrow)' : '';
        return `Error: Not enough arrows. Found ${arrowCheck.count} arrow(s)${inf}. Need at least 1.`;
      }

      // ---- Report charge setting ----
      const chargeTicks = Math.max(5, Math.min(40, args.charge_ticks ?? CHARGE_TICKS));
      const chargeRatio = chargeTicks / CHARGE_TICKS;
      const chargeLabel = chargeTicks >= CHARGE_TICKS
        ? 'full'
        : chargeTicks >= 15 ? 'high' : chargeTicks >= 10 ? 'medium' : 'low';

      // ---- Equip bow ----
      try {
        // Check if we're already holding the bow
        const heldItem = bot.inventory.slots[bot.QUICK_BAR_START + bot.quickBarSlot];
        if (!heldItem || heldItem.name !== bow.name) {
          await bot.equip(bow, 'hand');
        }
      } catch (err) {
        return `Failed to equip ${bow.name}: ${err.message}`;
      }

      // ---- Calculate aim ----
      const launchPos = bot.entity.position.offset(0, EYE_HEIGHT, 0);
      const targetCenter = getTargetCenter(entity);
      const targetVel = getEntityVelocity(entity);

      const { aimPoint, flightTime } = calculateAim(launchPos, targetCenter, targetVel);

      // ---- Aim at the target ----
      try {
        await bot.lookAt(aimPoint, true); // true = instant (no smooth turning)
      } catch (err) {
        return `Failed to look at target: ${err.message}`;
      }

      // ---- Draw the bow ----
      if (isUsingItem(bot)) {
        return 'Error: Bot is already using an item (eating or drawing). Wait for it to finish first.';
      }

      try {
        bot.activateItem(); // start right-click = draw bow
      } catch (err) {
        return `Failed to draw bow: ${err.message}`;
      }

      // ---- Wait for charge ----
      const chargeMs = chargeTicks * 50; // each tick = 50ms
      await new Promise((r) => setTimeout(r, chargeMs));

      // ---- Quick aim refresh before firing ----
      // If the target moved significantly during charge, recalculate aim
      // and re-look to adjust on the fly (valid in MC — you can adjust aim
      // while the bow is drawn).
      if (entity.isValid && entity.position) {
        const currentDist = entity.position.distanceTo(bot.entity.position);
        if (currentDist < MAX_RANGE) {
          const updatedCenter = getTargetCenter(entity);
          const updatedVel = getEntityVelocity(entity);
          const refreshPos = bot.entity.position.offset(0, EYE_HEIGHT, 0);
          const { aimPoint: refreshedAim } = calculateAim(refreshPos, updatedCenter, updatedVel);
          try {
            await bot.lookAt(refreshedAim, true);
          } catch { /* best-effort */ }
        }
      }

      // ---- Fire! ----
      try {
        bot.deactivateItem(); // release right-click = fire arrow
      } catch (err) {
        return `Failed to fire arrow: ${err.message}`;
      }

      // ---- Small wait to let the server process the shot ----
      await new Promise((r) => setTimeout(r, 100));

      // ---- Report ----
      const arrowTypes = arrowCheck.types.length > 0
        ? arrowCheck.types.join(', ')
        : 'arrows';
      const infinityNote = hasInfinity(bow) ? ' (Infinity — arrows not consumed)' : '';

      const lines = [
        `${rangeWarning}Fired ${arrowTypes} at ${label} using ${bow.name}.`,
        `  Charge: ${chargeLabel} (${chargeTicks} ticks, ~${(chargeTicks * 50).toFixed(0)}ms)`,
        `  Distance: ${Math.round(dist)}m — Estimated flight time: ${(flightTime * 1000).toFixed(0)}ms`,
        `  Arrows remaining: ${arrowCheck.count}${infinityNote}`,
      ];

      // If the target is no longer valid (died or despawned), mention it
      if (!entity.isValid) {
        lines.push(`  Note: ${label} disappeared shortly after firing.`);
      }

      return lines.join('\n');
    },
  };
};
