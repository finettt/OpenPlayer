# Operational Reference: Minecraft Survival (Java 1.20.1)

This document is a **decision-making reference** for the AI agent operating in Minecraft Java 1.20.1 via the OpenPlayer tool system. It maps game knowledge to concrete tool calls, provides priority rules, and describes progression workflows.

Game mechanics apply to Java Edition 1.20.1, Survival mode, Normal difficulty unless noted.

---

## Progression: Day 1

### Wood & Basic Crafting

**Goal:** Obtain logs → planks → crafting table → sticks → wooden pickaxe.

```
1. find_block("oak_log", 20)         → get coordinates of nearest tree
2. go_to(x, y, z)                    → navigate to tree
3. mine_block_type("oak_log", 10)    → collect 10 logs (no tool needed)
4. craft("oak_planks", 40)           → convert logs to planks (1 log = 4 planks)
5. craft("stick", 8)                 → 2 planks → 4 sticks
6. create_workbench                  → craft + place crafting table nearby
7. craft("wooden_pickaxe")           → 3 planks + 2 sticks
```

**Tip:** Mine at least 10 logs upfront — you'll need planks for sticks, tools, torches, and building.

### First Tools & Stone

**Goal:** Wooden pickaxe → mine cobblestone → stone tools + furnace.

```
1. find_block("stone", 10)           → find exposed stone or dig down
2. go_to_y(<current_y - 3>)          → dig down a few layers
3. mine_block_type("stone", 20)      → collect ~20 cobblestone
4. craft("stone_pickaxe")            → 3 cobblestone + 2 sticks
5. craft("stone_axe")                → 3 cobblestone + 2 sticks
6. craft("stone_sword")              → 2 cobblestone + 1 stick
7. craft("furnace")                  → 8 cobblestone (ring shape)
```

**Priority:** stone_pickaxe → stone_sword → stone_axe → furnace. Wooden sword/shovel/hoe are not worth crafting — stone upgrade is immediate.

### Coal & Torches

**Goal:** Find coal or make charcoal for light.

```
1. find_block("coal_ore", 50)        → search for coal veins
2. mine_block_type("coal_ore", 16)   → mine the entire vein
3. craft("torch", 32)                → 1 coal + 1 stick = 4 torches
```

**If no coal found:** Smelt logs into charcoal (works identically to coal for torches):
```
1. approach(<furnace_x>, <furnace_y>, <furnace_z>)
2. smelt("oak_log", 8, "oak_planks") → charcoal; planks as fuel
3. craft("torch", 32)                → charcoal + stick = 4 torches each
```

### Food

**Goal:** Obtain ~32 raw meat, then cook it.

```
1. attack_entity("cow")              → or "pig", "sheep", "chicken"
2. collect_drops()                   → pick up drops
3. repeat until ~32 raw meat
4. smelt("raw_beef", 32)            → cooked_beef restores 8 hunger (vs 1.8 raw)
```

**Important:** Cooked meat restores dramatically more hunger. Always cook when possible. Hunger ≤ 6 prevents sprinting. Hunger = 0 causes health loss. Keep hunger above 18 for natural regeneration.

**Use `consume("best_food")` to auto-eat the best available food for current hunger level.**

### Shelter Before Nightfall

**Priority order:**

1. **Bed** (best option — skips night, sets respawn):
   ```
   1. attack_entity("sheep") × 3    → collect 3 wool
   2. craft("white_bed")             → 3 wool + 3 planks
   3. place_block(x, y, z)           → place bed (hold bed first)
   4. interact(x, y, z)              → right-click bed at night to sleep
   ```

2. **Enclosed room** (dirt/stone hut with door and torches):
   ```
   1. mine_block_type("dirt", 20)    → or use cobblestone
   2. place_block(...)               → build walls
   3. craft("oak_door")             → 6 planks
   4. place_block + interact         → place and open/close door
   5. place_block for torches        → light interior
   ```

3. **Hole in ground** (emergency):
   ```
   1. break_block(x, y, z)           → dig into hillside
   2. place_block(x, y, z)           → seal entrance with dirt
   → wait ~7-8 minutes real time for dawn
   ```

---

## Nighttime Operations

### If You Have a Bed
```
1. interact(<bed_x>, <bed_y>, <bed_z>)  → sleep, skip to dawn
```

### If No Bed — Mine
```
1. go_to_y(<current_y - 10>)        → descend staircase (NOT straight down!)
2. mine_block_type("coal_ore", 16)   → gather coal
3. mine_block_type("iron_ore", 16)   → gather iron
4. mine_block_type("stone", 32)      → expand tunnel
```

### Light & Mob Spawning

- Hostile mobs spawn at **light level 0** only
- One torch = light 14, decreasing by 1 per block taxicab distance
- Place torches every 12-14 blocks in open areas
- Mobs don't spawn within 24 blocks of you
- **Always light your base interior and entrance**

---

## Iron Age

### Finding & Processing Iron

Iron ore generates underground, most commonly at **Y = 16** and **Y = 232** (mountains). Requires stone pickaxe or better.

```
1. go_to_y(16)                       → descend to iron level
2. find_block("iron_ore", 50)        → locate vein
3. mine_block_type("iron_ore", 20)   → collect raw iron
4. smelt("raw_iron", 20)             → smelt into iron ingots
```

### Iron Crafting Priority

```
1. craft("iron_pickaxe")             → 3 ingots — can mine diamonds, gold, redstone, emerald
2. craft("shield")                   → 1 ingot + 6 planks — blocks arrows, explosions, blaze fireballs
3. equip("shield", "offhand")        → always in off-hand!
4. craft("iron_sword")               → 2 ingots
5. craft("iron_helmet")              → 5 ingots
6. craft("iron_chestplate")          → 8 ingots
7. craft("iron_leggings")            → 7 ingots
8. craft("iron_boots")               → 4 ingots
```

Full iron armor set = 24 ingots. **Shield is the single biggest survivability upgrade.**

### Water Bucket

```
1. craft("bucket")                   → 3 iron ingots (V shape)
2. find_block("water", 10)           → find water source
3. approach(x, y, z)                 → get adjacent
4. hold_item("bucket")               → hold bucket in hand
5. interact(x, y, z)                 → right-click water to fill
```

**Water bucket uses:** Place on lava → obsidian; extinguish self; break falls; wash away gravel/sand; slow/kill endermen. **Always carry one.**

---

## Diamond Age

### Preparation Checklist

Before deep mining, verify via `get_inventory`:
- [ ] Iron pickaxe (bring spare)
- [ ] Shield (off-hand)
- [ ] Full iron armor
- [ ] 32+ torches
- [ ] 20+ cooked food
- [ ] Water bucket
- [ ] Crafting table
- [ ] Furnace

### Strip Mining for Diamonds

Diamond ore: **Y = −64 to Y = 16**, peak at **Y = −59**. Veins of 1-4 blocks.

```
1. go_to_y(-59)                      → descend to diamond level (staircase, NOT straight down)
2. mine_block_type("diamond_ore", 5, 50, 300)  → find and mine diamonds
```

**If strip mining manually:**
```
1. go_to(x, -59, z)                 → start position
2. break_block(x+1, -59, z)         → dig forward
3. break_block(x+2, -59, z)         → 1×2 tunnel
4. ... repeat, placing torches periodically
5. Every 2 blocks, dig branch tunnels left and right
```

**DANGER:** Never dig straight down. Never dig straight ahead at eye level into unexplored areas — lava may be behind the next block.

### First Diamonds — Allocation Priority

```
1. craft("diamond_pickaxe")          → 3 diamonds — REQUIRED to mine obsidian
2. craft("diamond_sword")            → 2 diamonds — significant damage upgrade
3. craft("diamond_chestplate")       → 8 diamonds — largest single armor upgrade
```

### Obsidian & Nether Portal

```
1. find_block("lava", 30)            → find lava source
2. approach(x, y, z)                 → get adjacent (carefully!)
3. hold_item("water_bucket")         → hold water bucket
4. interact(<block_near_lava>)       → place water next to lava → creates obsidian
5. collect_drops()                   → pick up bucket after water placed
6. mine_block_type("obsidian", 14)   → mine 14 obsidian (diamond pickaxe, ~10s per block)
7. build_portal                      → builds frame + lights it in one step
   — OR manually:
   a. place_block 14 obsidian in a 4×5 frame
   b. craft("flint_and_steel") if needed
   c. hold_item("flint_and_steel") + interact on interior ground block
8. approach(<portal_block>) or go_to → step into portal
```

**build_portal:** The one-shot tool (`build_portal`) handles everything — frame construction, auto-crafting flint_and_steel if you have iron + flint, and lighting. Stand on flat ground and call it. If materials are missing it reports exactly what you need.

---

## The Nether

### Critical Rules

- **NEVER place a bed** — it will explode with lethal force
- **Water evaporates instantly** — water bucket useless here (except in cauldrons)
- **Lava flows 2× farther and 3× faster** than Overworld
- **Mark your path** with torches on one side
- **Always carry flint_and_steel** — ghasts can destroy portal frames
- **Horizontal distances 8:1** — 1 Nether block = 8 Overworld blocks
- Use `remember("nether_portal_overworld: x, y, z")` to save portal coords

### Nether Biomes

| Biome | Key Features | Danger Level |
|---|---|---|
| **Nether Wastes** | Gold nuggets, nether quartz, piglins, ghasts, magma cubes | Medium |
| **Crimson Forest** | Hoglins (food/leather), crimson stems (wood), piglins | Medium-High |
| **Warped Forest** | Many endermen — best for pearl farming, relatively safe | Low-Medium |
| **Soul Sand Valley** | Skeletons, ghasts; soul sand slows movement | High |
| **Basalt Deltas** | Magma cubes, jagged terrain | High |

### Finding the Fortress

Nether fortresses generate along north-south axes in strips ~400 blocks apart. They're made of nether_bricks and contain blaze spawners.

**Search strategy:**
```
1. find_block("nether_bricks", 100)   → check loaded chunks first
2. If not found, pick a direction (north/south) and:
   a. go_to(current_x + 100, current_y, current_z)  → walk 100 blocks
   b. scan_area(64, "spawners") or find_block("nether_bricks", 100)
   c. repeat until found, expanding search by 100 blocks each iteration
   d. After 500+ blocks in one direction, try east/west
      (fortresses run north-south; you'll cross one by going east-west)
3. Once fortress found, remember() its coordinates
```

Fortress landmarks: nether_brick buildings, open corridors, blaze spawners (caged spawners in lava-lit rooms). If you see nether_bricks on scan_area, go toward them.

### Blaze Combat

**Goal:** Kill blazes for blaze rods → blaze powder.

```
1. equip("shield", "offhand")         → ALWAYS before engaging blazes
2. equip("iron_sword") or better      → diamond_sword preferred
3. defense_mode(true)                 → enables auto-aggro on hostiles
4. approach(<blaze_spawner_coords>)   → get near the spawner room
5. attack_entity("blaze")             → engage nearest blaze
6. collect_drops()                    → pick up blaze rods
7. repeat until 10+ blaze rods
```

**Critical tactics:**
- **Shield blocks fireballs 100%** — keep it in off-hand at all times. A blaze fireball deals 9 damage (4.5 hearts) without a shield, and 0 with a successful block.
- **Attack in melee when the blaze isn't firing** — blazes have a cooldown after each fireball. Rush in during the gap.
- **2-block-high ceiling** — build cobblestone/dirt over your head. Blazes are 1.8 blocks tall and need 2 blocks of height to path toward you; with a 2-high ceiling they can't reach you but you can hit them.
- **Kite them away from the spawner** — killing blazes near the spawner means more blazes spawn while you fight. Draw them into a corridor to thin the horde.
- **Fire Resistance potion** makes the fight trivial — if you have magma cream + potion supplies, brew it before engaging.
- **Avoid standing in lava** — fortress floors often have lava. Use scan_area("hazards") to check before engaging.
- **Start with defense_mode on** — it auto-attacks the nearest hostile. If you're overwhelmed, retreat down a corridor and pillar up with place_block.
- **Don't chase blazes over open lava** — let them come to you. If a blaze flies over lava, wait for it to return or find a better angle.

### Ender Pearls

Need ~15-20 ender pearls. Two strategies:

**Strategy 1 — Piglin Trading:**
```
1. mine_block_type("gold_ore", 32)   → obtain gold
2. smelt("raw_gold", 32)             → smelt to ingots
3. equip("golden_helmet")            → wear at least 1 gold armor piece
4. hold_item("gold_ingot")           → hold gold
5. drop_item("gold_ingot", 1)        → throw gold near piglin
6. collect_drops()                   → pick up traded items
7. repeat — ~4% chance of 2-4 pearls per trade; bring 20+ ingots
```

**Strategy 2 — Warped Forest Farming:**
```
1. find_block("warped_nylium", 64)   → locate Warped Forest
2. go_to(x, y, z)                    → enter the biome
3. attack_entity("enderman")         → kill endermen one at a time
4. collect_drops()                   → collect ender pearls
5. repeat
```

**Note:** You cannot wear a carved pumpkin via `equip` for enderman protection. Instead, avoid looking directly at them — attack one at a time and use `defense_mode`.

### Nether Dangers Reference

| Mob | Damage | Behavior | Counter |
|---|---|---|---|
| **Ghast** | 17 (explosion) | Floats, shoots fireballs from distance | Reflect fireball by attacking it; shield blocks damage |
| **Wither Skeleton** | 8 + Wither effect | Tall, found in fortresses | 2-block ceiling (too tall to reach you) |
| **Piglin Brute** | 13 melee | Always hostile regardless of gold armor | Avoid Bastion Remnants unless prepared |
| **Lava** | High + items lost | Flows fast, sea level Y=31 | Watch step, keep water bucket (for Overworld only) |

---

## Finding the Stronghold

### Eyes of Ender

```
1. craft("blaze_powder", 10)         → 1 blaze rod = 2 blaze powder
2. craft("ender_eye", 12)            → 1 ender pearl + 1 blaze powder each
```

Make 12-15 Eyes of Ender. Each thrown Eye has 20% chance to shatter.

### Locating the Stronghold

```
1. hold_item("ender_eye")            → hold Eye of Ender
2. interact(x, y, z) or place_block  → throw Eye (right-click)
3. Note the direction it flies        → use take_screenshot or observe coordinates
4. go_to in that direction ~50-100 blocks
5. Repeat throw every 50-100 blocks
6. When Eye moves downward → stronghold is below
7. go_to_y(<target_y>)               → descend staircase (NOT straight down)
```

Strongholds generate 640-2,240 blocks from world spawn, in rings. Made of stone brick with maze-like corridors.

### Activating the End Portal

```
1. scan_area(32, "spawners")         → find silverfish spawner (marks portal room)
2. Approach the portal frame
3. hold_item("ender_eye")
4. interact(<each_empty_frame_block>) → insert Eye into each frame block
5. 12 frame blocks total; 1-3 usually pre-filled
6. Portal activates → step in
```

---

## The End

### Preparation Checklist

Verify via `get_inventory` and `get_health_status`:
- [ ] Diamond or iron pickaxe
- [ ] Diamond or iron sword
- [ ] Shield (off-hand)
- [ ] Full iron or diamond armor
- [ ] Bow + 64+ arrows
- [ ] 40+ cooked food
- [ ] 2 water buckets (water works in The End)
- [ ] Crafting table
- [ ] 128+ building blocks (cobblestone)
- [ ] 64+ torches
- [ ] Spare Eyes of Ender

### Ender Dragon Fight

**Dragon stats:** 200 HP (100 hearts). Two phases:

**Phase 1 — Airborne:** Dragon circles, dives, breathes dragon breath (purple lingering cloud), shoots fireballs.

**Phase 2 — Perching:** Dragon lands on center portal, roars, breathes dragon breath. **Vulnerable to melee for ~5 seconds.**

### Step 1: Destroy End Crystals

10 crystals on obsidian pillars (3-60+ blocks tall). They heal the dragon.

```
1. find_block("end_crystal", 64)     → locate crystal
2. attack_entity("end_crystal")      → shoot with bow or melee
   — OR hold_item("bow") + attack from range
3. For caged crystals: build up with place_block, break_block iron bars, then destroy crystal
4. Use water bucket to break falls if knocked off
5. repeat for all 10 crystals
```

### Step 2: Fight the Dragon

```
1. defense_mode(true)                → auto-fight nearby endermen
2. When dragon perches:
   attack_entity("Ender Dragon")     → hit head for double damage
3. When dragon airborne:
   take_screenshot                   → track position
   use bow for ranged damage
4. Block dragon breath with shield
5. consume("best_food")              → keep hunger up for regeneration
```

**Tip:** Do NOT provoke endermen unless necessary. If they attack, `defense_mode` handles them.

### After Victory

```
1. collect_drops()                   → 12,000 XP from dragon
2. For Dragon Egg: break_block under egg, place torch below → egg drops as item
3. collect_drops()                   → pick up egg
4. approach(<exit_portal>)           → step into bedrock portal to return
```

---

## Enchanting

### Enchanting Table

```
1. craft("book", 15)                 → 3 paper + 1 leather each
2. craft("enchanting_table")         → 4 obsidian + 2 diamonds + 1 book
3. craft("bookshelf", 15)            → 6 planks + 3 books each
4. place_block for table             → place table
5. Place 15 bookshelves with 1-block air gap around table
6. interact(<enchanting_table>)      → open enchanting UI
```

Max enchantment level = 30 (requires 15 bookshelves).

### Anvil

```
1. craft("anvil")                    → 31 iron ingots (3 blocks + 1 + 4)
2. place_block for anvil
3. interact(<anvil>)                 → combine enchanted books with items
```

Anvil cost increases per use. If cost exceeds 39 levels → "Too Expensive!" — operation blocked.

### Key Enchantments

| Enchantment | Item | Max Level | Effect |
|---|---|---|---|
| Sharpness | Sword | V | +1.25 damage per level |
| Efficiency | Pickaxe/Axe/Shovel | V | +5 mining speed per level |
| Unbreaking | Any tool/armor | III | Chance to avoid durability loss |
| Fortune | Pickaxe | III | Up to 4× ore drops |
| Silk Touch | Pickaxe | I | Blocks drop themselves |
| Protection | Armor | IV | -4% damage per level |
| Mending | Any | I | Repairs with XP (treasure only — villager trading, fishing, loot) |
| Feather Falling | Boots | IV | -12% fall damage per level |
| Looting | Sword | III | More mob drops |

### Enchantment Priority Recommendations

**Pickaxe:** Efficiency V + Unbreaking III + Fortune III (or Silk Touch)
**Sword:** Sharpness V + Unbreaking III + Looting III + Mending
**Armor:** Protection IV + Unbreaking III on all; Feather Falling IV on boots; Mending where possible

---

## Brewing

### Setup

```
1. craft("brewing_stand")            → 1 blaze rod + 3 cobblestone
2. craft("glass_bottle", 3)          → 3 glass
3. approach(<water_source>)          → find water
4. hold_item("glass_bottle")
5. interact(<water_block>)           → fill bottles
6. interact(<brewing_stand>)         → open brewing UI
```

Fuel: blaze powder. Base: water bottles.

### Key Potions

| Potion | Ingredient | Duration | Use Case |
|---|---|---|---|
| Fire Resistance | Magma cream | 3 min (8 w/ Redstone) | **Essential for Nether** |
| Swiftness | Sugar | 3 min (8 w/ Redstone) | Travel speed +20% |
| Night Vision | Golden carrot | 3 min (8 w/ Redstone) | See in dark |
| Strength | Blaze powder | 3 min | +3 melee damage |
| Slow Falling | Phantom membrane | 1:30 | **End fight — no fall damage** |
| Healing | Glistering melon | Instant | +2 HP |

**Modifiers:** Redstone = longer duration; Glowstone = stronger effect; Gunpowder = splash (throwable); Dragon's Breath = lingering (AoE).

---

## Netherite

### Ancient Debris

Found in Nether at **Y = 8–22**, peak at **Y = 15**. Blast-resistant, doesn't burn in lava. Requires diamond pickaxe.

```
1. go_to_y(15)                       → go to optimal Y level in Nether
2. mine_block_type("ancient_debris", 4, 50, 300)  → find and mine
3. smelt("ancient_debris", 4)        → netherite scrap (1 debris = 1 scrap)
```

### Crafting Netherite

```
1. craft("netherite_ingot")          → 4 netherite scrap + 4 gold ingots
2. craft("smithing_table")           → 2 iron ingots + 4 planks
3. place_block for smithing_table
4. interact(<smithing_table>)        → upgrade diamond item + netherite ingot + netherite_upgrade_template
```

**Note:** Netherite Upgrade Smithing Template found only in Bastion Remnant chests. Templates can be duplicated: 1 template + 7 diamonds + 1 block of source material on crafting table.

Netherite gear: higher durability, knockback resistance, immune to fire/lava (items won't burn if dropped).

---

## Village Trading

Villagers are valuable trading partners. Profession determined by nearby workstation:

| Villager | Workstation | Sells | Key Item |
|---|---|---|---|
| **Librarian** | Lectern | Enchanted books | **Mending** (most reliable source) |
| **Armorer** | Blast furnace | Diamond armor | Diamond chestplate, etc. |
| **Cleric** | Brewing stand | Ender pearls, glowstone | Alternative to Nether pearl farming |
| **Farmer** | Composter | Golden carrots, food | Buys wheat |
| **Weaponsmith** | Grindstone | Enchanted swords | Diamond sword |

Trade levels: Novice → Master (more trades = better items).

**Curing zombie villagers** (Weakness splash potion + Golden Apple) permanently reduces all prices for that villager.

---

## Version 1.20.1 Features

### Cherry Grove
Decorative biome with pink petals and cherry trees. Bees spawn frequently. No unique survival resources; distinct wood type.

### Archaeology
- Craft brush: `craft("brush")` — 1 stick + 1 copper ingot + 1 feather
- Find Suspicious Sand/Gravel in desert temples, desert wells, ocean ruins
- Use `interact` on suspicious blocks to brush and excavate: pottery sherds, armor trim templates, emeralds, rarely diamonds
- 4 pottery sherds → Decorated Pot

### Smithing Templates
- Netherite Upgrade templates: Bastion Remnant chests only
- Armor trim templates: cosmetic, found in various structures
- Duplicate: 1 template + 7 diamonds + 1 source block on crafting table

---

## Progression Summary

| Stage | Key Actions | Tool Workflow |
|---|---|---|
| **Day 1** | Wood → stone tools → food → shelter/bed → torches | `mine_block_type` → `craft` → `attack_entity` → `create_workbench` |
| **Iron Age** | Mine Y=16 → smelt iron → iron tools/armor/shield | `go_to_y(16)` → `mine_block_type("iron_ore")` → `smelt` → `craft` → `equip` |
| **Diamond Age** | Strip mine Y=−59 → diamond pickaxe → obsidian → portal | `go_to_y(-59)` → `mine_block_type("diamond_ore")` → `mine_block_type("obsidian")` → `build_portal` |
| **Nether** | Blazes → blaze rods → ender pearls | `build_portal` → `attack_entity("blaze")` → `collect_drops` → trade/farm pearls |
| **Stronghold** | Eyes of Ender → locate → activate portal | `craft("ender_eye")` → throw & follow → `interact` portal frames |
| **The End** | Destroy crystals → fight dragon → exit | `attack_entity` → `consume("best_food")` → `collect_drops` |

---

## Gathering Blaze Rods — Complete Walkthrough

The full chain from a fresh world to blaze rods, tying all the above sections together:

### Phase 1: Prep (Day 1 → Iron)

```
1. get_surroundings or scan_area         → pick a direction with trees
2. Day 1 loop: wood → stone tools → food → shelter (see Day 1 section)
3. Iron Age loop: mine Y=16 → smelt → iron pickaxe, sword, shield, full iron armor
4. equip("shield", "offhand")            → permanent — never unequip
5. todo add "gather 14+ obsidian"
6. todo add "build nether portal"
7. todo add "gather 10+ blaze rods"
```

### Phase 2: Obsidian (Diamond Pickaxe)

```
1. craft("iron_pickaxe")                 → need iron to mine diamonds
2. go_to_y(-59)                          → diamond level
3. mine_block_type("diamond_ore", 5)     → at least 3 for pickaxe + spare
4. craft("diamond_pickaxe")              → 3 diamonds + 2 sticks
5. find_block("lava", 30)                → find lava pool
6. approach(lava_x, lava_y, lava_z)      → get close (not IN the lava)
7. hold_item("water_bucket")             → water + lava = obsidian
8. interact(near_lava_block)             → pour water over lava
9. collect_drops()                       → pick up empty bucket
10. mine_block_type("obsidian", 14)      → diamond pickaxe only!
11. If < 14 obsidian: find more lava, repeat water-pouring
```

### Phase 3: Portal & Nether Entry

```
1. Find flat 5×5 area near your base
2. get_inventory                       → verify: 14+ obsidian
3. build_portal                        → builds frame + lights it
   If no igniter:
   a. mine_block_type("gravel")        → get flint (1/10 chance per gravel)
   b. craft("flint_and_steel")         → 1 iron_ingot + 1 flint
   c. hold_item("flint_and_steel")
   d. interact with ground inside the portal frame → lights it
4. remember("portal_coords: x, y, z in overworld")
5. approach(portal_block) or go_to     → walk into the portal
   → Dimension changes to the_nether automatically
   → SYSTEM will print Nether rules on arrival
```

### Phase 4: Find the Fortress

```
1. get_surroundings                    → check spawn safety
2. defense_mode(true)                  → ghasts, zombie piglins, etc.
3. find_block("nether_bricks", 100)    → is fortress in loaded chunks?
4. If not found — search pattern:
   a. Remember starting coords: remember("nether_spawn: x, y, z")
   b. Walk ~100 blocks east: go_to(spawn_x + 100, current_y, spawn_z)
   c. scan_area(64, "spawners")        → check for fortress
   d. If not found, walk another 100 blocks east
   e. Repeat until fortress found or 500+ blocks traveled
   f. If 500 blocks east with no result, try west from spawn
   g. Then try north-south (fortresses run north-south, so east-west
      is the best direction to CROSS one)
5. remember("fortress_coords: x, y, z")
6. go_to(x, y, z)                     → approach the fortress
```

### Phase 5: Blaze Hunting

```
1. scan_area(32, "spawners")          → find blaze spawner room
2. equip("shield", "offhand")         → critical — blocks fireballs
3. equip("iron_sword")                → or diamond_sword if available
4. defense_mode(true)                 → auto-aggro blazes + other hostiles
5. approach(spawner_x, spawner_y, spawner_z)  → get LOS to blazes
6. attack_entity("blaze")             → engage
7. collect_drops()                    → pick up blaze rods
8. Repeat 6-7 until you have 10+ blaze rods
9. If overwhelmed:
   - place_block under yourself to pillar up + cover
   - retreat to a corridor (blazes can't chase well in tight spaces)
   - eat: consume("best_food")
   - wait for HP regen, then re-engage
```

### Phase 6: Return

```
1. confirm count: get_inventory        → should have 10+ blaze rods
2. go_to(nether_spawn_coords)          → return to portal
3. approach(portal_block) or go_to     → step back into Overworld
4. remember("blaze_rod_count: N")
5. todo complete "gather 10+ blaze rods"
6. Now you can craft blaze powder: craft("blaze_powder", 8)
   → 1 blaze rod = 2 blaze powder
   → Used for Eyes of Ender and potion brewing
```

**Estimated resources needed:** 14 obsidian, 1 diamond pickaxe, full iron armor, shield, iron or diamond sword, 20+ food, 64+ torches (for the Nether), flint_and_steel.

---

## Survival Rules for the Agent

1. **Never dig straight down** — always use `go_to_y` or staircase patterns
2. **Always carry a water bucket** — saves from lava, fire, falls, endermen
3. **Never place a bed in the Nether or the End** — it will explode
4. **Keep shield in off-hand** — `equip("shield", "offhand")` blocks arrows, explosions, blaze fireballs, dragon breath
5. **Cook all food** — `smelt("raw_beef")` before `consume`
6. **Keep hunger above 18** — enables natural health regeneration; `consume("best_food")` when low
7. **Enable defense_mode when in danger** — auto-fights hostiles within 16 blocks; the system auto-enables it when you take damage
8. **Use `remember()` for critical facts** — portal coordinates, base location, resource positions
9. **Use `todo` for multi-step tasks** — add tasks before starting, mark in_progress while working, complete when done
10. **Use `get_surroundings` or `take_screenshot` before acting** — situational awareness prevents walking into lava or hostile mobs
11. **Use `send_message` to communicate** — plain text is invisible to players
12. **Always call `end_loop` when done** — without it, you will be stuck in a reasoning loop
