'use strict';

/**
 * defense_mode tool — Toggle automatic self-defense against hostile mobs.
 *
 * When ON, runs a tick loop that:
 *   - Scans for threats (hostile mobs OR recently-aggro'd entities) in range
 *   - Picks a strategy based on situation:
 *       * SOLO       — 1-2 threats: classic pvp-plugin chase + hit
 *       * SWARM_PILLAR — ≥3 threats + dirt/cobble in inventory: pillar up 2 blocks
 *                       and pelt them from above (zombies can't path up 2 jumps
 *                       without a block-up themselves)
 *       * SWARM_KITE — ≥3 threats but no pillar blocks: hit-and-run, pick the
 *                      *closest* threat every tick instead of locking on
 *       * RETREAT    — HP ≤ RETREAT_HP_THRESHOLD: pause attacks, pathfind away
 *                      from the centroid of threats until HP recovers to
 *                      RESUME_HP_THRESHOLD
 *   - Eats food mid-combat if `bot.food <= EAT_HUNGER_THRESHOLD` and there's
 *     a safe gap (no melee threat within 2 blocks during the 1.6s eat)
 *   - Auto-equip best weapon on enable AND every tick: scores swords/axes by
 *     base damage + tier + enchantments (Sharpness, Smite vs undead, Bane vs
 *     arthropods), and re-equips when a better option exists for the current
 *     target. Avoids weapons about to break (<20 durability left).
 *   - Equips shield in off-hand on enable if available
 *   - Crit manager: jumps before swings when target is in reach and on-ground,
 *     so the pvp-plugin's swing lands while we're falling → +50% damage
 *   - Shield manager: raises off-hand shield when archers (≤16m) or melee
 *     mobs (≤4m) are around; briefly lowers it before each swing so attacks
 *     register; always down while kiting/retreating (shield blocks sprint)
 *
 * State is stored on the bot instance: bot._defenseMode
 */

const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// --- Tuning -----------------------------------------------------------------

const SCAN_INTERVAL_MS = 250;           // Tighter loop for crowd reactions
const DEFENSE_RANGE = 16;               // Blocks — engage threats within
const VIEW_DISTANCE = 24;               // Lose interest beyond
const RECENT_ATTACKER_TTL_MS = 10_000;  // How long aggro'd neutrals stay flagged

const SWARM_THRESHOLD = 3;              // ≥N threats within SWARM_RADIUS → swarm mode
const SWARM_RADIUS = 8;
// Blocks safe to use for pillaring (stable, not falling, won't burn). Order
// matters — earlier entries are preferred (cheap / abundant first).
const PILLAR_BLOCKS = [
  'dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'mud', 'dirt_path',
  'cobblestone', 'cobbled_deepslate', 'stone', 'deepslate', 'tuff',
  'andesite', 'granite', 'diorite', 'calcite', 'dripstone_block',
  'mossy_cobblestone', 'blackstone', 'basalt', 'smooth_basalt', 'netherrack',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'crimson_planks', 'warped_planks', 'bamboo_planks',
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log',
  'dark_oak_log', 'mangrove_log', 'cherry_log',
];
const PILLAR_HEIGHT = 2;                // 2 blocks puts us out of zombie reach
const PILLAR_STEP_TIMEOUT_MS = 1500;    // Max time for a single up-step
const PILLAR_COOLDOWN_MS = 5_000;       // Don't retry pillar this soon after a failure

const RETREAT_HP_THRESHOLD = 8;         // ≤8 HP → break off and run
const RESUME_HP_THRESHOLD = 14;         // ≥14 HP → re-engage
const RETREAT_DISTANCE = 24;            // Path that far from threat centroid

const EAT_HUNGER_THRESHOLD = 17;        // <=17/20 food → try to eat in combat
const EAT_SAFE_GAP_BLOCKS = 4;          // No melee threat within this radius to eat
const EAT_COOLDOWN_MS = 8_000;          // Min time between eat attempts

const KITE_RETREAT_BLOCKS = 3;          // Distance to step back when kiting
const TARGET_SWITCH_RATIO = 0.8;        // Switch if new target is < 0.8 × current dist

// --- Crit / shield tuning ---------------------------------------------------

const CRIT_REACH = 3.5;                 // Only crit-jump when target is within reach
const CRIT_COOLDOWN_TICKS = 12;         // Min ticks between crit-jumps (~600ms)
                                        // — sword cooldown is ~12.5 ticks at 1.6 atk speed
const SHIELD_RANGED_RADIUS = 16;        // Raise shield if archer within this range
const SHIELD_MELEE_RADIUS = 4;          // Raise shield if melee threat within this range
const SHIELD_LOWER_MS = 120;            // Lower shield this long before a swing
const RANGED_ATTACKER_NAMES = new Set([
  'skeleton', 'stray', 'wither_skeleton',
  'pillager', 'piglin', 'blaze', 'ghast',
]);

// --- Recent attacker tracking -----------------------------------------------

function getRecentAttackers(bot) {
  if (!bot._recentAttackers) bot._recentAttackers = new Map();
  return bot._recentAttackers;
}

function markRecentAttacker(bot, entity) {
  if (!entity || entity === bot.entity) return;
  getRecentAttackers(bot).set(entity.id, Date.now() + RECENT_ATTACKER_TTL_MS);
}

function pruneRecentAttackers(bot) {
  const map = getRecentAttackers(bot);
  const now = Date.now();
  for (const [id, expires] of map) {
    if (expires <= now) map.delete(id);
  }
}

function isThreat(bot, entity) {
  if (entity === bot.entity || !entity.position) return false;
  if (entity.type === 'hostile') return true;
  const map = getRecentAttackers(bot);
  const expires = map.get(entity.id);
  if (expires && expires > Date.now()) return true;
  return false;
}

// --- Threat scanning --------------------------------------------------------

function listThreats(bot, range) {
  pruneRecentAttackers(bot);
  const pos = bot.entity.position;
  const out = [];
  for (const e of Object.values(bot.entities)) {
    if (!isThreat(bot, e)) continue;
    const d = e.position.distanceTo(pos);
    if (d > range) continue;
    out.push({ entity: e, dist: d });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

function findNearestHostile(bot, range) {
  const all = listThreats(bot, range);
  return all[0] || null;
}

function threatCentroid(threats) {
  if (!threats.length) return null;
  let x = 0, y = 0, z = 0;
  for (const t of threats) {
    x += t.entity.position.x;
    y += t.entity.position.y;
    z += t.entity.position.z;
  }
  return new Vec3(x / threats.length, y / threats.length, z / threats.length);
}

// --- Equip helpers ----------------------------------------------------------

const TOOL_TIERS = ['wooden', 'stone', 'golden', 'iron', 'diamond', 'netherite'];

// Base sword/axe damage in MC Java (without enchantments).
// Pulled from the wiki — used to compare swords vs axes of the same tier.
// Axes hit harder per swing but swing slower; for our purposes (mineflayer-pvp
// fires on cooldown, not max-DPS) the per-hit number is what matters.
const BASE_DAMAGE = {
  wooden_sword: 4,    stone_sword: 5,    iron_sword: 6,    golden_sword: 4,    diamond_sword: 7,    netherite_sword: 8,
  wooden_axe:   7,    stone_axe:   9,    iron_axe:   9,    golden_axe:   7,    diamond_axe:   9,    netherite_axe:   10,
};

// Enemies that take bonus damage from Smite (undead) or Bane of Arthropods.
const UNDEAD_MOBS = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin',
  'skeleton', 'stray', 'wither_skeleton', 'phantom', 'zoglin', 'wither',
]);
const ARTHROPOD_MOBS = new Set([
  'spider', 'cave_spider', 'silverfish', 'endermite', 'bee',
]);

function tierOf(name) {
  for (let i = TOOL_TIERS.length - 1; i >= 0; i--) {
    if (name.startsWith(TOOL_TIERS[i] + '_')) return i;
  }
  return -1;
}

/**
 * Read enchantment levels off an item. Works on both NBT shapes that mineflayer
 * produces (1.13+: item.nbt.value.Enchantments.value.value array; older:
 * item.enchants). Returns { sharpness, smite, bane, knockback, fireAspect, looting }.
 */
function readEnchants(item) {
  const out = { sharpness: 0, smite: 0, bane: 0, knockback: 0, fireAspect: 0, looting: 0 };
  if (!item) return out;

  // Convenient shortcut some mineflayer versions expose
  if (Array.isArray(item.enchants)) {
    for (const e of item.enchants) {
      const id = (e.name || '').replace(/^minecraft:/, '');
      const lvl = e.lvl ?? e.level ?? 0;
      if (id === 'sharpness') out.sharpness = lvl;
      else if (id === 'smite') out.smite = lvl;
      else if (id === 'bane_of_arthropods') out.bane = lvl;
      else if (id === 'knockback') out.knockback = lvl;
      else if (id === 'fire_aspect') out.fireAspect = lvl;
      else if (id === 'looting') out.looting = lvl;
    }
    return out;
  }

  // Raw NBT path
  try {
    const ench = item.nbt?.value?.Enchantments?.value?.value
              || item.nbt?.value?.ench?.value?.value;
    if (Array.isArray(ench)) {
      for (const e of ench) {
        const id = String(e.id?.value || '').replace(/^minecraft:/, '');
        const lvl = e.lvl?.value ?? 0;
        if (id === 'sharpness') out.sharpness = lvl;
        else if (id === 'smite') out.smite = lvl;
        else if (id === 'bane_of_arthropods') out.bane = lvl;
        else if (id === 'knockback') out.knockback = lvl;
        else if (id === 'fire_aspect') out.fireAspect = lvl;
        else if (id === 'looting') out.looting = lvl;
      }
    }
  } catch { /* ignore — fall through with zeros */ }
  return out;
}

/**
 * Score a weapon against a specific target. Higher = better.
 * Accounts for base damage, tier, enchantments, and mob-type bonuses.
 * If targetName is null, returns a generic score (used when picking on enable).
 */
function scoreWeapon(item, targetName) {
  if (!item) return -Infinity;
  const name = item.name;
  if (!name.endsWith('_sword') && !name.endsWith('_axe')) return -Infinity;

  let score = BASE_DAMAGE[name] ?? 0;
  // Tier as tiebreaker — important for non-standard weapons (mods, etc.)
  score += tierOf(name) * 0.1;

  const ench = readEnchants(item);

  // Sharpness: +0.5 per level after the first (which is +1) in modern MC
  if (ench.sharpness > 0) score += 0.5 + 0.5 * ench.sharpness;

  // Smite vs undead: +2.5 per level
  if (ench.smite > 0 && targetName && UNDEAD_MOBS.has(targetName)) {
    score += 2.5 * ench.smite;
  }
  // Bane vs arthropods: +2.5 per level
  if (ench.bane > 0 && targetName && ARTHROPOD_MOBS.has(targetName)) {
    score += 2.5 * ench.bane;
  }

  // Fire Aspect — minor bonus, irrelevant if the bot is meleeing in water
  if (ench.fireAspect > 0) score += 0.5;

  // Knockback: usually unwanted in swarm (pushes mob away mid-combo), but
  // useful for archers / creepers. We do NOT add a bonus here — neutral.

  // Durability tiebreaker: prefer the more-used item so we keep a fresh
  // backup, but only as a fractional nudge so it never overrides damage.
  if (typeof item.durabilityUsed === 'number' && typeof item.maxDurability === 'number') {
    const remaining = item.maxDurability - item.durabilityUsed;
    // Penalty if almost broken so we don't snap our weapon mid-fight
    if (remaining < 20) score -= 5;
  }

  return score;
}

/**
 * Pick the best weapon in inventory for the given target entity.
 * If no target, picks the generally-best weapon.
 * Returns the inventory item, or null if no weapon found.
 */
function pickBestWeapon(bot, targetEntity) {
  const targetName = targetEntity?.name || null;
  const items = bot.inventory.items().filter((i) =>
    i.name.endsWith('_sword') || i.name.endsWith('_axe')
  );
  if (!items.length) return null;
  // Also consider currently held item (might be in main-hand slot only)
  if (bot.heldItem && (bot.heldItem.name.endsWith('_sword') || bot.heldItem.name.endsWith('_axe'))) {
    if (!items.includes(bot.heldItem)) items.push(bot.heldItem);
  }
  let best = items[0];
  let bestScore = scoreWeapon(best, targetName);
  for (let i = 1; i < items.length; i++) {
    const s = scoreWeapon(items[i], targetName);
    if (s > bestScore) { bestScore = s; best = items[i]; }
  }
  return best;
}

/**
 * Equip the best weapon for the given target. Safe to call every tick — only
 * issues an equip packet when the held item actually needs to change.
 *
 * Optional `state` object lets us throttle equip attempts (avoid packet spam
 * if the equip races with mineflayer-pvp's own slot management).
 */
async function equipBestWeapon(bot, targetEntity, state) {
  const best = pickBestWeapon(bot, targetEntity);
  if (!best) return false;
  if (bot.heldItem?.name === best.name && bot.heldItem?.slot === best.slot) {
    return true;
  }
  // Throttle to once per 500ms — equipping mid-swing can desync mineflayer-pvp
  if (state) {
    const now = Date.now();
    if (now - (state.lastEquipAt || 0) < 500) return false;
    state.lastEquipAt = now;
  }
  try { await bot.equip(best, 'hand'); return true; }
  catch { return false; }
}

async function equipShield(bot) {
  const shield = bot.inventory.items().find((i) => i.name === 'shield');
  if (!shield) return false;
  // Already in off-hand?
  const offHand = bot.inventory.slots[45]; // 1.9+ off-hand slot
  if (offHand && offHand.name === 'shield') return true;
  try { await bot.equip(shield, 'off-hand'); return true; }
  catch { return false; }
}

function findPillarBlock(bot) {
  for (const name of PILLAR_BLOCKS) {
    const item = bot.inventory.items().find((i) => i.name === name);
    if (item) return item;
  }
  return null;
}

function findFood(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const foods = bot.inventory.items().filter((i) => mcData.foodsByName[i.name]);
  if (!foods.length) return null;
  // Prefer high-saturation, non-poisonous food
  const bad = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato',
    'pufferfish', 'chicken']); // raw chicken is bad; cooked is fine
  foods.sort((a, b) => {
    const aBad = bad.has(a.name) ? 1 : 0;
    const bBad = bad.has(b.name) ? 1 : 0;
    if (aBad !== bBad) return aBad - bBad;
    const aSat = mcData.foodsByName[a.name].saturation || 0;
    const bSat = mcData.foodsByName[b.name].saturation || 0;
    return bSat - aSat;
  });
  return foods[0];
}

// --- Strategies -------------------------------------------------------------

/**
 * Check if the column above the bot is clear enough for a pillar.
 * Returns { ok, reason }.
 */
function checkPillarClearance(bot, height) {
  const me = bot.entity.position.floored();
  // Bot occupies y and y+1. We need y+2..y+1+height to be air/replaceable.
  for (let dy = 2; dy <= 1 + height; dy++) {
    const b = bot.blockAt(me.offset(0, dy, 0));
    if (b && b.boundingBox === 'block') {
      return { ok: false, reason: `ceiling at +${dy}: ${b.name}` };
    }
  }
  return { ok: true };
}

/**
 * Pillar up `height` blocks. Returns { ok, placed, reason }.
 *
 * This is fragile if mineflayer-pvp or pathfinder is fighting us for control —
 * the caller MUST stop pvp + pathfinder first, and gate the main loop on
 * state.pillarInProgress so we get exclusive control of jump + look.
 */
async function pillarUp(bot, item, height = PILLAR_HEIGHT) {
  // Hard stop anything that drives controls
  try { bot.pvp.stop(); } catch { /* ignore */ }
  try { bot.pathfinder.stop(); } catch { /* ignore */ }
  bot.clearControlStates();

  const clear = checkPillarClearance(bot, height);
  if (!clear.ok) return { ok: false, placed: 0, reason: clear.reason };

  try {
    await bot.equip(item, 'hand');
  } catch (err) {
    return { ok: false, placed: 0, reason: `equip failed: ${err.message}` };
  }

  let placed = 0;

  for (let i = 0; i < height; i++) {
    const startY = Math.floor(bot.entity.position.y);
    // The block we want to place is at startY (where the bot's feet are).
    // After placing it'll push the bot up one block — we need to be on top.
    // Reference block is the one currently below the bot's feet (startY - 1).
    // Face vector (0,1,0) means "place on the top face of the reference".
    const refPos = bot.entity.position.floored().offset(0, -1, 0);
    const refBlock = bot.blockAt(refPos);
    if (!refBlock || refBlock.boundingBox !== 'block') {
      return { ok: false, placed, reason: `no solid block below at ${refPos}` };
    }

    // Look down so the place hits the top face cleanly
    try { await bot.look(bot.entity.yaw, Math.PI / 2, true); }
    catch { /* ignore */ }

    // Start jump
    bot.setControlState('jump', true);

    // Wait until we're airborne and above the current floor, then place
    const t0 = Date.now();
    let placedThisStep = false;
    while (Date.now() - t0 < PILLAR_STEP_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 50));
      // Are we high enough that placing on top of refBlock will land us on it?
      // We need to be airborne (off the original ground) AND our y >= startY + 0.5
      if (bot.entity.position.y >= startY + 0.5 && !bot.entity.onGround) {
        try {
          await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
          placedThisStep = true;
          placed++;
        } catch { /* try again next loop iteration */ }
        break;
      }
    }

    bot.setControlState('jump', false);

    if (!placedThisStep) {
      return { ok: false, placed, reason: 'jump+place window missed' };
    }

    // Wait until we land on the new block (onGround true and y advanced)
    const settleStart = Date.now();
    while (Date.now() - settleStart < 1000) {
      if (bot.entity.onGround && Math.floor(bot.entity.position.y) >= startY + 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return { ok: placed === height, placed, reason: null };
}

async function kiteStep(bot, threat) {
  // Step backwards relative to the threat's position.
  const me = bot.entity.position;
  const dx = me.x - threat.entity.position.x;
  const dz = me.z - threat.entity.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const goal = new goals.GoalNear(
    me.x + (dx / len) * KITE_RETREAT_BLOCKS,
    me.y,
    me.z + (dz / len) * KITE_RETREAT_BLOCKS,
    1,
  );
  try {
    // Don't block the loop — fire and forget, the next tick will reassess
    bot.pathfinder.setGoal(goal);
  } catch { /* ignore */ }
}

async function retreatFrom(bot, centroid) {
  const me = bot.entity.position;
  const dx = me.x - centroid.x;
  const dz = me.z - centroid.z;
  const len = Math.hypot(dx, dz) || 1;
  const tx = me.x + (dx / len) * RETREAT_DISTANCE;
  const tz = me.z + (dz / len) * RETREAT_DISTANCE;
  try {
    bot.pathfinder.setGoal(new goals.GoalNear(tx, me.y, tz, 2));
  } catch { /* ignore */ }
}

async function tryEat(bot, state) {
  const now = Date.now();
  if (now - state.lastEatAt < EAT_COOLDOWN_MS) return false;
  if (bot.food > EAT_HUNGER_THRESHOLD) return false;
  // Safe gap check
  const close = listThreats(bot, EAT_SAFE_GAP_BLOCKS);
  if (close.length > 0) return false;
  const food = findFood(bot);
  if (!food) return false;

  state.lastEatAt = now;
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    return true;
  } catch {
    return false;
  }
}

// --- Crit & shield managers -------------------------------------------------

/**
 * Returns true if the held item is a sword/axe — only then are crits valuable.
 */
function holdingMeleeWeapon(bot) {
  const n = bot.heldItem?.name;
  if (!n) return false;
  return n.endsWith('_sword') || n.endsWith('_axe');
}

/**
 * Has the bot got a shield in off-hand?
 */
function hasShieldInOffHand(bot) {
  const off = bot.inventory.slots[45];
  return !!(off && off.name === 'shield');
}

/**
 * Is the off-hand item currently being used (right-click held)?
 * mineflayer tracks this in bot.usingHeldItem / bot._client state. We probe
 * via the activatedItem path which is reliable across versions.
 */
function isOffHandActive(bot) {
  // bot.activatedItem returns the slot index of the actively-used item, if any
  // For off-hand right-click, slot is 45.
  // Fallback: track our own flag (set/cleared by raiseShield/lowerShield).
  return !!bot._shieldRaised;
}

/**
 * Crit manager — installs a physicsTick listener that jumps when the bot is
 * about to swing at a melee target. mineflayer-pvp swings at fixed intervals
 * once attack() is set; we can't perfectly sync to its internal timer, so we
 * use a simpler heuristic: while pvp.target is in reach and on-ground and the
 * crit cooldown elapsed, do a tiny jump. The next pvp swing will land while
 * we're falling → crit. False crits (mid-cooldown) are harmless.
 *
 * Returns a cleanup function.
 */
function installCritManager(bot, state) {
  state.lastCritTick = 0;

  const onTick = () => {
    if (!state.active) return;
    if (state.retreating || state.pillarInProgress) return;
    if (!bot.pvp?.target || !bot.pvp.target.isValid) return;
    if (!holdingMeleeWeapon(bot)) return;
    if (!bot.entity.onGround) return;
    if (bot.entity.isInWater || bot.entity.isInLava) return;
    if (bot.entity.isOnLadder) return;
    if (bot.entity.effects && bot.entity.effects[25]) return; // Levitation
    if (bot.entity.effects && bot.entity.effects[28]) return; // Slow Falling — breaks crits

    const dist = bot.pvp.target.position.distanceTo(bot.entity.position);
    if (dist > CRIT_REACH || dist < 1.5) return;

    // Throttle: don't jump more often than the sword can swing
    const now = bot._tickCounter || 0;
    if (now - state.lastCritTick < CRIT_COOLDOWN_TICKS) return;
    state.lastCritTick = now;

    // One-tick jump impulse. The bot will leave ground next physics step;
    // mineflayer-pvp's swing within the next few ticks will be a crit.
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 50);
  };

  // Maintain a tick counter so we can throttle independently of clock time.
  const onTickCount = () => { bot._tickCounter = (bot._tickCounter || 0) + 1; };

  bot.on('physicsTick', onTick);
  bot.on('physicsTick', onTickCount);

  return () => {
    bot.removeListener('physicsTick', onTick);
    bot.removeListener('physicsTick', onTickCount);
  };
}

/**
 * Shield manager — raises the off-hand shield when ranged or melee threats are
 * around, and briefly lowers it just before each swing so attacks register.
 *
 * Strategy:
 *   - If shield in off-hand AND (ranged threat in 16m OR melee threat in 4m):
 *       keep right-click held on off-hand (activateItem(true))
 *   - When pvp.target exists and we're about to swing (within reach), lower
 *     the shield for SHIELD_LOWER_MS to let the swing through, then re-raise.
 *   - Always lower while moving via pathfinder (kiting) — shield blocks sprint.
 *
 * Returns a cleanup function.
 */
function installShieldManager(bot, state) {
  state.shieldLoweredUntil = 0;

  const raise = () => {
    if (bot._shieldRaised) return;
    try {
      // activateItem(offHand=true) holds right-click on the off-hand item
      bot.activateItem(true);
      bot._shieldRaised = true;
    } catch { /* ignore */ }
  };

  const lower = () => {
    if (!bot._shieldRaised) return;
    try {
      bot.deactivateItem();
      bot._shieldRaised = false;
    } catch { /* ignore */ }
  };

  const onTick = () => {
    if (!state.active) {
      lower();
      return;
    }
    if (state.pillarInProgress) {
      lower();
      return;
    }
    if (!hasShieldInOffHand(bot)) {
      lower();
      return;
    }

    // Lower while kiting (need sprint) or retreating (need to run)
    if (state.retreating || state.mode === 'SWARM_KITE') {
      lower();
      return;
    }

    // Lower briefly around swings so they register
    const now = Date.now();
    if (now < state.shieldLoweredUntil) {
      lower();
      return;
    }

    // Decide whether a threat warrants the shield
    const threats = listThreats(bot, SHIELD_RANGED_RADIUS);
    let want = false;
    for (const t of threats) {
      if (t.dist <= SHIELD_MELEE_RADIUS) { want = true; break; }
      if (RANGED_ATTACKER_NAMES.has(t.entity.name) && t.dist <= SHIELD_RANGED_RADIUS) {
        want = true;
        break;
      }
    }

    if (want) raise(); else lower();
  };

  // Lower shield just before a swing. mineflayer-pvp emits 'attack' on each
  // swing in some versions; we hook the generic stoppedAttacking + a tick
  // pre-check. Easier: any time pvp.target is in reach, schedule a shield
  // lower window so the imminent swing connects.
  const onSwingPrep = () => {
    if (!state.active) return;
    if (!bot.pvp?.target || !bot.pvp.target.isValid) return;
    const dist = bot.pvp.target.position.distanceTo(bot.entity.position);
    if (dist <= CRIT_REACH) {
      state.shieldLoweredUntil = Date.now() + SHIELD_LOWER_MS;
    }
  };

  // Run swing-prep at a coarser cadence so we don't constantly drop the shield
  const swingPrepTimer = setInterval(onSwingPrep, 500);

  bot.on('physicsTick', onTick);

  return () => {
    clearInterval(swingPrepTimer);
    bot.removeListener('physicsTick', onTick);
    lower();
  };
}

// --- Main enable ------------------------------------------------------------

function enableDefense(bot) {
  if (bot._defenseMode?.active) {
    return `Defense mode is already ON. Currently ${bot._defenseMode.currentTarget ? `fighting ${bot._defenseMode.currentTarget}` : 'scanning for hostiles'}.`;
  }

  try { bot.pvp.stop(); } catch { /* ignore */ }

  try {
    if (!bot._combatMovements) bot._combatMovements = new Movements(bot);
    bot.pvp.movements = bot._combatMovements;
  } catch { /* ignore */ }

  const state = {
    active: true,
    currentTarget: null,
    interval: null,
    killCount: 0,
    mode: 'SOLO',         // SOLO | SWARM_PILLAR | SWARM_KITE | RETREAT
    retreating: false,
    lastEatAt: 0,
    lastModeSwitchAt: 0,
    pillarInProgress: false,
    lastPillarFailAt: 0,
    pillarHeight: 0,      // How many blocks we've pillared up so far
  };
  bot._defenseMode = state;

  // Fire-and-forget: equip best generic weapon + shield asynchronously.
  // The defense loop will re-equip with target-specific weapon once a threat
  // is identified (e.g. swap to Smite-V sword vs zombies).
  equipBestWeapon(bot, null, state).catch(() => {});
  equipShield(bot).catch(() => {});

  const onStoppedAttacking = () => {
    if (state.active) state.currentTarget = null;
  };
  bot.removeAllListeners('stoppedAttacking');
  bot.on('stoppedAttacking', onStoppedAttacking);

  // Install crit + shield managers. These run on physicsTick (20 Hz).
  const stopCritMgr = installCritManager(bot, state);
  const stopShieldMgr = installShieldManager(bot, state);

  // Main loop
  state.interval = setInterval(async () => {
    if (!state.active || !bot.entity) {
      clearInterval(state.interval);
      return;
    }

    // Hard guard: if a pillar attempt is in flight, do nothing this tick.
    // pillarUp owns jump/look/equip/pvp/pathfinder while it runs.
    if (state.pillarInProgress) return;

    const threats = listThreats(bot, DEFENSE_RANGE);
    const swarmCount = threats.filter((t) => t.dist <= SWARM_RADIUS).length;
    const hp = bot.health;

    // ---- RETREAT mode (overrides everything) -------------------------------
    if (state.retreating) {
      if (hp >= RESUME_HP_THRESHOLD || threats.length === 0) {
        state.retreating = false;
        state.mode = 'SOLO';
        try { bot.pathfinder.stop(); } catch { /* ignore */ }
      } else {
        // Keep retreating; periodically refresh the goal
        const c = threatCentroid(threats);
        if (c) await retreatFrom(bot, c);
        // Try to eat if it's safe
        await tryEat(bot, state).catch(() => {});
        return;
      }
    }

    if (hp <= RETREAT_HP_THRESHOLD && threats.length > 0) {
      state.retreating = true;
      state.mode = 'RETREAT';
      try { bot.pvp.stop(); } catch { /* ignore */ }
      const c = threatCentroid(threats);
      if (c) await retreatFrom(bot, c);
      return;
    }

    // ---- No threats: idle -------------------------------------------------
    if (!threats.length) {
      if (bot.pvp.target) {
        try { bot.pvp.stop(); } catch { /* ignore */ }
      }
      state.currentTarget = null;
      // Combat over: reset pillar tracker so the next ambush starts fresh.
      // (We don't auto-mine the pillar down — the agent can do that itself.)
      state.pillarHeight = 0;
      state.mode = 'SOLO';
      // Top up hunger in calm moments
      await tryEat(bot, state).catch(() => {});
      return;
    }

    // ---- Eat in lulls -----------------------------------------------------
    await tryEat(bot, state).catch(() => {});

    // ---- Mode selection ---------------------------------------------------
    const now = Date.now();
    const pillarOnCooldown = now - state.lastPillarFailAt < PILLAR_COOLDOWN_MS;
    if (swarmCount >= SWARM_THRESHOLD) {
      if (state.mode !== 'SWARM_PILLAR' && state.mode !== 'SWARM_KITE') {
        const pillarBlock = findPillarBlock(bot);
        const clearance = checkPillarClearance(bot, PILLAR_HEIGHT);
        if (pillarBlock && clearance.ok && !pillarOnCooldown) {
          state.mode = 'SWARM_PILLAR';
          state.lastModeSwitchAt = now;
        } else {
          state.mode = 'SWARM_KITE';
          state.lastModeSwitchAt = now;
        }
      }
    } else {
      if (state.mode !== 'SOLO') {
        state.mode = 'SOLO';
        state.lastModeSwitchAt = now;
      }
    }

    const nearest = threats[0];

    // ---- SWARM_PILLAR -----------------------------------------------------
    if (state.mode === 'SWARM_PILLAR' && state.pillarHeight < PILLAR_HEIGHT) {
      const pillarBlock = findPillarBlock(bot);
      if (!pillarBlock) {
        state.mode = 'SWARM_KITE'; // ran out of blocks mid-fight
      } else {
        state.pillarInProgress = true;
        const remaining = PILLAR_HEIGHT - state.pillarHeight;
        let result = { ok: false, placed: 0, reason: 'unknown' };
        try {
          result = await pillarUp(bot, pillarBlock, remaining);
        } catch (err) {
          result = { ok: false, placed: 0, reason: err.message };
        }
        state.pillarHeight += result.placed;
        if (!result.ok) {
          state.lastPillarFailAt = Date.now();
          state.mode = 'SWARM_KITE';
        }
        // After pillaring we placed blocks (not a weapon) in hand — re-equip
        // a weapon, biased toward the nearest threat below us.
        await equipBestWeapon(bot, threats[0]?.entity, state).catch(() => {});
        state.pillarInProgress = false;
        return; // Let next tick reassess from on top of the pillar
      }
    }

    // If we successfully pillared, drop back to SOLO so we fire pvp at mobs
    // below us. The crit manager handles jump-attacks from the pillar top.
    if (state.mode === 'SWARM_PILLAR' && state.pillarHeight >= PILLAR_HEIGHT) {
      state.mode = 'SOLO';
    }

    // ---- SWARM_KITE -------------------------------------------------------
    if (state.mode === 'SWARM_KITE') {
      // Always re-target the nearest threat — don't lock on
      if (bot.pvp.target !== nearest.entity) {
        // Re-equip for the new target before swinging (Smite vs zombies etc.)
        await equipBestWeapon(bot, nearest.entity, state).catch(() => {});
        try { bot.pvp.attack(nearest.entity); } catch { /* ignore */ }
        state.currentTarget = nearest.entity.name || 'unknown';
      }
      // Step back if a threat is in melee range
      if (nearest.dist < 2.5) {
        await kiteStep(bot, nearest).catch(() => {});
      }
      return;
    }

    // ---- SOLO -------------------------------------------------------------
    if (bot.pvp.target) {
      const t = bot.pvp.target;
      if (!t.isValid) {
        state.currentTarget = null;
        try { bot.pvp.stop(); } catch { /* ignore */ }
      } else {
        const tDist = t.position.distanceTo(bot.entity.position);
        if (tDist > VIEW_DISTANCE) {
          state.currentTarget = null;
          try { bot.pvp.stop(); } catch { /* ignore */ }
        } else if (nearest.entity !== t && nearest.dist < tDist * TARGET_SWITCH_RATIO) {
          state.currentTarget = nearest.entity.name || 'unknown';
          // Switching targets — re-pick weapon (new target may be a different mob type)
          await equipBestWeapon(bot, nearest.entity, state).catch(() => {});
          try { bot.pvp.attack(nearest.entity); } catch { /* ignore */ }
        } else {
          // Same target, but defensively re-check weapon every tick.
          // Cheap: equipBestWeapon is a no-op if the held item is still best.
          // This catches cases where the LLM swapped item slots mid-fight or
          // the previous best weapon broke (durability hit 0).
          await equipBestWeapon(bot, t, state).catch(() => {});
        }
        return;
      }
    }

    state.currentTarget = nearest.entity.name || 'unknown';
    // First engagement with this target — pick the right weapon for it
    await equipBestWeapon(bot, nearest.entity, state).catch(() => {});
    try { bot.pvp.attack(nearest.entity); }
    catch { state.currentTarget = null; }
  }, SCAN_INTERVAL_MS);

  state._cleanup = () => {
    bot.removeListener('stoppedAttacking', onStoppedAttacking);
    if (bot.listenerCount('stoppedAttacking') > 0) {
      bot.removeAllListeners('stoppedAttacking');
    }
    try { stopCritMgr(); } catch { /* ignore */ }
    try { stopShieldMgr(); } catch { /* ignore */ }
    // Make sure shield isn't stuck raised
    if (bot._shieldRaised) {
      try { bot.deactivateItem(); } catch { /* ignore */ }
      bot._shieldRaised = false;
    }
    // Clear lingering jump control
    try { bot.setControlState('jump', false); } catch { /* ignore */ }
  };

  return 'Defense mode ON. Auto-fighting hostile mobs with swarm/kite/retreat tactics. Use defense_mode(enabled=false) to disable.';
}

function disableDefense(bot) {
  if (!bot._defenseMode?.active) return 'Defense mode is already OFF.';
  const state = bot._defenseMode;
  state.active = false;
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  try { bot.pvp.stop(); } catch { /* ignore */ }
  try { bot.pathfinder.stop(); } catch { /* ignore */ }
  if (state._cleanup) state._cleanup();
  state.currentTarget = null;
  state.retreating = false;
  state.mode = 'SOLO';
  state.pillarHeight = 0;
  state.pillarInProgress = false;
  return 'Defense mode OFF. Stopped auto-attacking.';
}

module.exports = function ({ goals: _goals, Movements: _Movements }) {
  return {
    name: 'defense_mode',
    description:
      'Toggle automatic self-defense mode. When ON, the bot fights hostile mobs ' +
      'using situation-aware tactics: 1-on-1 melee, swarm-pillar (build up out of reach), ' +
      'swarm-kite (hit-and-run), or retreat (when HP is low). Auto-selects the best ' +
      'weapon for each target (Smite vs undead, Bane vs spiders, Sharpness otherwise) ' +
      'and re-equips on target switch or if the weapon is about to break. Auto-equips ' +
      'shield in off-hand, jumps for critical hits, raises shield against archers and ' +
      'melee threats, and eats food mid-combat when safe. Use defense_mode(enabled=false) ' +
      'to disable.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable defense mode, false to disable.',
        },
      },
      required: ['enabled'],
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      if (!bot.pvp) return 'Error: PVP plugin is not loaded. Cannot use defense mode.';

      // Soft warning when disabling defense while threats are nearby — the LLM
      // was repeatedly turning autopilot off mid-fight in earlier sessions.
      // We still honour the call (the user might want manual control), but
      // surface the consequence.
      if (args.enabled === false && bot._defenseMode?.active) {
        const here = bot.entity.position;
        let nearby = 0;
        let nearest = null;
        let nearestDist = Infinity;
        for (const e of Object.values(bot.entities)) {
          if (!e || e === bot.entity || !e.position) continue;
          if (e.type !== 'hostile') continue;
          const d = e.position.distanceTo(here);
          if (d > 16) continue;
          nearby++;
          if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        if (nearby > 0 && nearest) {
          const nName = nearest.name || nearest.displayName || 'unknown';
          const result = disableDefense(bot);
          return `${result} Warning: ${nearby} hostile${nearby > 1 ? 's' : ''} still within 16m (closest: ${nName} ${Math.round(nearestDist)}m). You are now exposed — re-enable with defense_mode(enabled=true) or fight manually with attack_entity.`;
        }
      }

      return args.enabled === true ? enableDefense(bot) : disableDefense(bot);
    },
  };
};

module.exports.enableDefense = enableDefense;
module.exports.disableDefense = disableDefense;
module.exports.markRecentAttacker = markRecentAttacker;
module.exports.isThreat = isThreat;
module.exports.equipBestWeapon = equipBestWeapon;
module.exports.pickBestWeapon = pickBestWeapon;
