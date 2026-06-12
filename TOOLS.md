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

## Crafting & Smelting
- **create_workbench** — Craft a crafting table from 4 planks and place it nearby. Needed for 3×3 recipes.
- **craft(item, count?)** — Craft an item by name (e.g. oak_planks, stick, wooden_pickaxe). For 3×3 recipes, must be near a crafting table. Count defaults to 1.
- **smelt(item, count?, fuel?)** — Smelt items in a nearby furnace (e.g. raw_iron, raw_beef, sand). Auto-selects fuel if not specified. Count defaults to 1.
- **get_recipe(item, depth?)** — Look up crafting recipes for an item. Shows ingredients, whether a crafting table is needed, and checks if you have the materials. Depth controls recipe recursion: depth=1 (default) shows direct ingredients only; depth=2+ resolves sub-ingredients recursively. For example, `get_recipe(wooden_pickaxe, depth=3)` shows you need 2 oak_log total (3 planks→1 log, 2 sticks→2 planks→1 log). At depth=2 it would show 1 oak_log + 2 oak_planks (sticks resolved but planks not fully).

## Block Interaction
- **break_block(x, y, z)** — Break a block at coordinates. Auto-selects best tool. Must be within ~6 blocks.
- **place_block(x, y, z, face?)** — Place currently held block on a face of a reference block. Face defaults to up.
- **interact(x, y, z)** — Right-click a block (doors, levers, chests, furnaces, beds, etc.). Must be within ~5 blocks.

## Item Collection
- **collect_drops(radius?, timeout?)** — Collect dropped items on the ground within radius. Walks to each item entity and picks it up. Radius defaults to 16 blocks, timeout defaults to 30s. Reports what was collected, unreachable items, and remaining drops.

## Inventory & Status
- **equip(item, destination?)** — Equip an item from inventory to a specific slot. Destinations: hand, off-hand, head, torso, legs, feet. Aliases: helmet, chestplate, chest, leggings, boots, offhand. Defaults to hand for tools/weapons, or the matching armor slot for armor items. Partial names supported (e.g. "sword" picks the best available sword). Returns error if item is missing.
- **drop_item(item, count?, username?)** — Drop items from inventory by name. Count defaults to all matching items. Faces the target player first if provided or if exactly one nearby player is present.
- **get_inventory** — List all items in inventory, hotbar, and armor slots.
- **get_health_status** — Get current health, food, and saturation levels.
- **get_active_effects** — List active potion effects with duration and amplifier.

## Flow Control
- **end_loop** — Finish the current reasoning loop. Call this when you are completely done with all actions and messages for the current user request. **Required** to end a turn.

## Utility
- **list_tools** — List all available tools and their descriptions.
