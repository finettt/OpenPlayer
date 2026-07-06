'use strict';

/**
 * build_portal — Build and light a Nether portal.
 *
 * Constructs a 4×5 obsidian frame at the bot's current position, then
 * lights it with flint_and_steel or fire_charge if one is available.
 * If no igniter is present the frame is still built — the LLM can decide
 * how to obtain one and light it via interact().
 */

module.exports = function ({ vec3, goals }) {
  return {
    name: 'build_portal',
    description:
      'Build and light a Nether portal at your current location. ' +
      'Requires at least 14 obsidian in inventory. ' +
      'Places a 4×5 obsidian frame (corners included for structural ' +
      'reliability), then lights it with flint_and_steel or fire_charge. ' +
      'Reports which materials are missing if construction cannot proceed.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(args, ctx) {
      const bot = ctx.bot;
      const pos = bot.entity.position;

      // ── 1. Count obsidian ──────────────────────────────────────────────────
      const obsidianItems = bot.inventory.items().filter(i => i.name === 'obsidian');
      let obsidianTotal = 0;
      for (const item of obsidianItems) obsidianTotal += item.count;
      if (obsidianTotal < 14) {
        return `Need 14 obsidian to build the portal frame, but ` +
          `you only have ${obsidianTotal}. Mine ${14 - obsidianTotal} more ` +
          `(lava + water → obsidian → diamond pickaxe).`;
      }

      // ── 2. Determine portal origin ────────────────────────────────────────
      // Portal occupies a 4-wide × 5-tall wall in the X-Y plane at the
      // bot's current Z.  Bot stands 1 block south of centre while building.
      const oX = Math.floor(pos.x);
      const oY = Math.floor(pos.y);
      const oZ = Math.floor(pos.z);

      // ── 3. Site survey ────────────────────────────────────────────────────
      for (let dx = 0; dx < 4; dx++) {
        const gb = bot.blockAt(vec3(oX + dx, oY - 1, oZ));
        if (!gb) return `Unloaded area at (${oX + dx}, ${oY - 1}). Move somewhere loaded.`;
        const name = gb.name;
        if (name === 'air' || name === 'cave_air' || name === 'lava' || name === 'water') {
          return `Ground at (${oX + dx}, ${oY - 1}) is ${name} — not solid. ` +
            `Find flat, solid ground.`;
        }
      }
      for (let dx = 1; dx < 3; dx++) {
        for (let dy = 1; dy < 4; dy++) {
          const ib = bot.blockAt(vec3(oX + dx, oY + dy, oZ));
          if (ib && ib.name !== 'air' && ib.name !== 'cave_air') {
            return `Portal interior blocked at (${oX + dx}, ${oY + dy}) by ` +
              `${ib.name}. Clear it first.`;
          }
        }
      }
      for (let dx = 0; dx < 4; dx++) {
        const tb = bot.blockAt(vec3(oX + dx, oY + 4, oZ));
        if (tb && tb.name !== 'air' && tb.name !== 'cave_air') {
          return `Portal top blocked at (${oX + dx}, ${oY + 4}) by ${tb.name}. Clear it first.`;
        }
      }

      // ── 4. Check for igniter ───────────────────────────────────────────────
      const hasIgniter = bot.inventory.items().some(i =>
        i.name === 'flint_and_steel' || i.name === 'fire_charge'
      );

      // ── 5. Equip obsidian ─────────────────────────────────────────────────
      try {
        await bot.equip(obsidianItems[0], 'hand');
      } catch (err) {
        return `Failed to equip obsidian: ${err.message}`;
      }

      // ── 6. Move bot to build position ─────────────────────────────────────
      // Stand 1 block south of the portal centre, at ground level, so
      // the bot can reach every block in the 4×5 frame (max distance ~4.4 m).
      const buildPos = vec3(oX + 1.5, oY, oZ - 1);
      try {
        if (bot.pathfinder && goals) {
          bot.pathfinder.setMovements(new (require('mineflayer-pathfinder').Movements)(bot));
          bot.pathfinder.setGoal(new goals.GoalBlock(oX + 1, oY, oZ - 1));
          // Wait briefly — don't block the rest of construction on pathfind.
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              bot.pathfinder.setGoal(null);
              resolve();
            }, 3000);
            const check = setInterval(() => {
              const d = bot.entity.position.distanceTo(buildPos);
              if (d < 3) {
                clearInterval(check);
                clearTimeout(timeout);
                bot.pathfinder.setGoal(null);
                resolve();
              }
            }, 200);
          });
        }
      } catch {
        // Non-fatal — the bot might already be close enough.
      }

      // ── 7. Build the frame ─────────────────────────────────────────────────
      // Frame layout (relative to origin oX, oY, oZ):
      //
      //   (0,4) (1,4) (2,4) (3,4)    ← top row
      //   (0,3)                     (3,3)
      //   (0,2)                     (3,2)    ← columns
      //   (0,1)                     (3,1)
      //   (0,0) (1,0) (2,0) (3,0)    ← bottom row
      //
      // We place in dependency-safe order so each block has an adjacent
      // reference already placed.

      /** Check the block at (x, y, z) is now obsidian. */
      const confirmPlaced = async (x, y, z, label) => {
        for (let retry = 0; retry < 15; retry++) {
          const b = bot.blockAt(vec3(x, y, z));
          if (b && b.name === 'obsidian') return true;
          await new Promise(r => setTimeout(r, 300));
        }
        throw new Error(`${label} at (${x},${y},${z}) did not appear after placement`);
      };

      /** Ensure the bot's held item is obsidian (re-equip if the stack ran out). */
      const ensureObsidian = async () => {
        if (!bot.heldItem || bot.heldItem.name !== 'obsidian') {
          const ob = bot.inventory.items().find(i => i.name === 'obsidian');
          if (!ob) throw new Error('Ran out of obsidian mid-build');
          await bot.equip(ob, 'hand');
          // Short settle so the server processes the equip.
          await new Promise(r => setTimeout(r, 100));
        }
      };

      /** Place a single obsidian block. */
      const place = async (refX, refY, refZ, fX, fY, fZ, targetX, targetY, targetZ, label) => {
        await ensureObsidian();
        const ref = bot.blockAt(vec3(refX, refY, refZ));
        if (!ref) throw new Error(`Reference block missing for ${label} at (${refX},${refY},${refZ})`);
        const face = vec3(fX, fY, fZ);
        await bot.placeBlock(ref, face);
        await confirmPlaced(targetX, targetY, targetZ, label);
      };

      try {
        // Bottom row — place on ground (ref = ground block, face = up)
        for (let dx = 0; dx < 4; dx++) {
          await place(
            oX + dx, oY - 1, oZ,  0, 1, 0,
            oX + dx, oY, oZ,
            `bottom-${dx}`
          );
        }

        // Left column — place on previous block (ref = block below, face = up)
        for (let dy = 1; dy < 5; dy++) {
          await place(
            oX, oY + dy - 1, oZ,  0, 1, 0,
            oX, oY + dy, oZ,
            `left-${dy}`
          );
        }

        // Right column — place on previous block (ref = block below, face = up)
        for (let dy = 1; dy < 5; dy++) {
          await place(
            oX + 3, oY + dy - 1, oZ,  0, 1, 0,
            oX + 3, oY + dy, oZ,
            `right-${dy}`
          );
        }

        // Top row (middle blocks) — ref = block to the left, face = east
        for (let dx = 1; dx < 3; dx++) {
          await place(
            oX + dx - 1, oY + 4, oZ,  1, 0, 0,
            oX + dx, oY + 4, oZ,
            `top-${dx}`
          );
        }

      } catch (err) {
        // Frame is partially built — report what happened so the LLM can
        // decide whether to retry or debug.
        return `Portal frame partially built but construction failed: ${err.message}. ` +
          `Complete or remove the frame and try again from a clearer spot.`;
      }

      // ── 8. Light the portal ──────────────────────────────────────────────
      // Move the bot OUT of the portal interior first.
      const lightPos = vec3(oX + 1.5, oY, oZ - 2);
      try {
        if (bot.pathfinder) {
          bot.pathfinder.setGoal(new goals.GoalBlock(oX + 1, oY, oZ - 2));
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              bot.pathfinder.setGoal(null);
              resolve();
            }, 3000);
            const check = setInterval(() => {
              const d = bot.entity.position.distanceTo(lightPos);
              if (d < 3) {
                clearInterval(check);
                clearTimeout(timeout);
                bot.pathfinder.setGoal(null);
                resolve();
              }
            }, 200);
          });
        }
      } catch { /* best-effort */ }

      // Resolve igniter from inventory
      let igniterItem = bot.inventory.items().find(i => i.name === 'flint_and_steel')
                     || bot.inventory.items().find(i => i.name === 'fire_charge');

      if (!igniterItem) {
        return `Portal frame built at (${oX}, ${oY}, ${oZ}) → (${oX + 3}, ${oY + 4}, ${oZ}) ` +
          `but NOT lit: no flint_and_steel or fire_charge available. ` +
          `Craft flint_and_steel (1 iron_ingot + 1 flint) and use interact() ` +
          `on the interior ground block of the frame to light it.`;
      }

      try {
        await bot.equip(igniterItem, 'hand');
        await new Promise(r => setTimeout(r, 150));

        // Right-click the ground block INSIDE the portal frame with the
        // igniter.  This places fire on the interior floor, activating
        // the portal.
        const interiorGround = bot.blockAt(vec3(oX + 1, oY - 1, oZ));
        if (!interiorGround) {
          return `Frame built but lighting failed: interior ground not loaded.`;
        }
        await bot.activateBlock(interiorGround);
        await new Promise(r => setTimeout(r, 500));

        // Confirm the portal is active
        const portalBlock = bot.blockAt(vec3(oX + 1, oY + 1, oZ));
        if (portalBlock && portalBlock.name === 'nether_portal') {
          return `Nether portal built and lit at (${oX}, ${oY}, ${oZ}) → ` +
            `(${oX + 3}, ${oY + 4}, ${oZ}). Walk into the purple ` +
            `portal blocks (use approach() or go_to) to enter the Nether.`;
        }

        // Portal might still be lighting (fire needs a moment)
        for (let retry = 0; retry < 10; retry++) {
          await new Promise(r => setTimeout(r, 500));
          const check = bot.blockAt(vec3(oX + 1, oY + 1, oZ));
          if (check && check.name === 'nether_portal') {
            return `Nether portal built and lit at (${oX}, ${oY}, ${oZ}) → ` +
              `(${oX + 3}, ${oY + 4}, ${oZ}). Portal is active.`;
          }
        }

        return `Portal frame built at (${oX}, ${oY}, ${oZ}) but the portal ` +
          `did not activate. Try lighting it again manually: hold ` +
          `${igniterItem.name} and interact() with the ground inside the frame.`;
      } catch (err) {
        return `Portal frame built at (${oX}, ${oY}, ${oZ}) but lighting ` +
          `failed: ${err.message}. Try lighting manually.`;
      }
    },
  };
};
