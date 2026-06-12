# TOOLS.md — Available Tools

## Communication
- **send_message(message)** — Send a message to game chat. Players only see this.
- **remember(fact)** — Save a fact to long-term memory (survives restart).

## Vision
- **take_screenshot** — Capture what is in front of you. Returns an image.
- **look_at_player(username)** — Turn to face a player by name.
- **get_surroundings** — Text summary: position, health, time, nearby players/mobs.
- **scan_area(radius?, filter?)** — Scan nearby blocks and entities for a richer situational summary. Reports counts and nearest positions of ores, hazards, resources, water, wood, portals, spawners, and mob types. Radius defaults to 32 (4-64). Filter by category: hazards, ores, resources, water, wood, portals, spawners, mobs, all (default).

## Movement
- **go_to(x, y?, z)** — Navigate near coordinates using pathfinding. Gets within 2-3 blocks of target. Y is optional (uses current height).
- **go_to_y(y)** — Navigate to a specific Y level (height). Use for ascending/descending. Range: 1-319.
- **approach(x, y?, z)** — Navigate adjacent to a specific block. Use for chests, crafting tables, doors, levers. Y is optional.
- **find_block(type, radius?)** — Find nearest block of a type in loaded chunks. Returns coordinates. Default radius: 50 blocks.
- **move(direction, duration)** — Move forward/backward/left/right for N seconds (0.5–5s).
- **jump** — Jump once. Useful for obstacles or gaps.

## Player Interaction
- **goto_player(username, distance?, timeout?)** — Navigate to a player and stop on arrival. One-shot move (not continuous). Distance defaults to 2 blocks, timeout defaults to 30s.
- **follow_player(username, distance?)** — Start following a player continuously. Use cancel_follow to stop.
- **cancel_follow** — Stop following a player.
- **lock_view(username)** — Continuously look at a player. Use cancel_lock_view to stop.
- **cancel_lock_view** — Stop locking your view on a player.

## Combat
- **attack_entity(target, type_filter?)** — Attack a nearby entity (mob or player). Target selectors: "nearest" (closest entity), "nearest_hostile", "nearest_passive", an entity name (e.g. "zombie", "skeleton", "blaze", "enderman", "cow"), or a player username. Use type_filter with "nearest" to narrow to "hostile", "passive", or "mob". The bot pursues and attacks with the best available weapon (or bare hand) until the target dies, you call attack_entity again, or you stop defence_mode. Returns an error if no matching entity is found or target is out of range (>48m).
- **defence_mode(enabled)** — Toggle automatic self-defence mode. When enabled (true), the bot continuously fights the nearest hostile mob within 16 blocks, switching to closer targets if they appear. When disabled (false), stops auto-attacking. Use this to protect yourself without manually calling attack_entity for each threat.

## Crafting & Smelting
- **create_workbench** — Craft a crafting table from 4 planks and place it nearby. Needed for 3×3 recipes.
- **craft(item, count?)** — Craft an item by name (e.g. oak_planks, stick, wooden_pickaxe). For 3×3 recipes, must be near a crafting table. Count defaults to 1.
- **smelt(item, count?, fuel?)** — Smelt items in a nearby furnace (e.g. raw_iron, raw_beef, sand). Auto-selects fuel if not specified. Count defaults to 1.
- **get_recipe(item, depth?)** — Look up crafting recipes for an item. Shows ingredients, whether a crafting table is needed, and checks if you have the materials. Depth controls recipe recursion: depth=1 (default) shows direct ingredients only; depth=2+ resolves sub-ingredients recursively. For example, `get_recipe(wooden_pickaxe, depth=3)` shows you need 2 oak_log total (3 planks→1 log, 2 sticks→2 planks→1 log). At depth=2 it would show 1 oak_log + 2 oak_planks (sticks resolved but planks not fully).

## Block Interaction
- **break_block(x, y, z)** — Break a block at coordinates. Auto-selects best tool. Must be within ~6 blocks.
- **mine_block_type(type, count?, radius?, timeout?)** — Gather N blocks of a given type. Automatically finds, navigates to, breaks, and collects blocks. Use for resource gathering (wood, stone, coal, iron_ore, etc.). Partial names work (e.g. "log" matches oak_log, birch_log). Checks if you have the required harvest tool before starting (e.g. pickaxe for stone) and auto-equips the best tool for each break. Count defaults to 1 (1-64), radius defaults to 50 (10-128), timeout defaults to 120s (30-300). Reports gathered count and stopping reason (count reached, no more blocks, timeout, too many unreachable, or too many break failures).
- **place_block(x, y, z, face?)** — Place currently held block on a face of a reference block. Face defaults to up.
- **interact(x, y, z)** — Right-click a block (doors, levers, chests, furnaces, beds, etc.). Must be within ~5 blocks.

## Item Collection
- **collect_drops(radius?, timeout?)** — Collect dropped items on the ground within radius. Walks to each item entity and picks it up. Radius defaults to 16 blocks, timeout defaults to 30s. Reports what was collected, unreachable items, and remaining drops.

## Inventory & Status
- **hold_item(item)** — Hold a specific item in your hand by name. If the item is already in your hotbar, switches to that slot instantly. If it's in your main inventory, moves it to the current hotbar slot. Partial names work (e.g. "sword" picks the best sword available). Returns error if item is not in your inventory. Use this before place_block, interact, or attack_entity to ensure the correct item is held.
- **equip(item, destination?)** — Equip an item from inventory to a specific slot. Destinations: hand, off-hand, head, torso, legs, feet. Aliases: helmet, chestplate, chest, leggings, boots, offhand. Defaults to hand for tools/weapons, or the matching armor slot for armor items. Partial names supported (e.g. "sword" picks the best available sword). Returns error if item is missing.
- **drop_item(item, count?, username?)** — Drop items from inventory by name. Count defaults to all matching items. Faces the target player first if provided or if exactly one nearby player is present.
- **get_inventory** — List all items in inventory, hotbar, and armor slots.
- **get_health_status** — Get current health, food, and saturation levels.
- **get_active_effects** — List active potion effects with duration and amplifier.

## Flow Control
- **end_loop** — Finish the current reasoning loop. Call this when you are completely done with all actions and messages for the current user request. **Required** to end a turn.

## Utility
- **list_tools** — List all available tools and their descriptions.
