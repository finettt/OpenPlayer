# TOOLS.md — Available Tools

## Communication
- **send_message(message)** — Send a message to game chat. Players only see this.
- **remember(fact)** — Save a fact to long-term memory (survives restart).

## Vision
- **take_screenshot** — Capture what is in front of you. Returns an image.
- **look_at_player(username)** — Turn to face a player by name.
- **get_surroundings** — Text summary: position, health, time, nearby players/mobs.

## Movement
- **go_to(x, y?, z)** — Navigate near coordinates using pathfinding. Gets within 2-3 blocks of target. Y is optional (uses current height).
- **go_to_y(y)** — Navigate to a specific Y level (height). Use for ascending/descending. Range: 1-319.
- **approach(x, y?, z)** — Navigate adjacent to a specific block. Use for chests, crafting tables, doors, levers. Y is optional.
- **find_block(type, radius?)** — Find nearest block of a type in loaded chunks. Returns coordinates. Default radius: 50 blocks.
- **move(direction, duration)** — Move forward/backward/left/right for N seconds (0.5–5s).
- **jump** — Jump once. Useful for obstacles or gaps.

## Player Interaction
- **follow_player(username, distance?)** — Start following a player continuously. Use cancel_follow to stop.
- **cancel_follow** — Stop following a player.
- **lock_view(username)** — Continuously look at a player. Use cancel_lock_view to stop.
- **cancel_lock_view** — Stop locking your view on a player.

## Crafting & Smelting
- **create_workbench** — Craft a crafting table from 4 planks and place it nearby. Needed for 3×3 recipes.
- **craft(item, count?)** — Craft an item by name (e.g. oak_planks, stick, wooden_pickaxe). For 3×3 recipes, must be near a crafting table. Count defaults to 1.
- **smelt(item, count?, fuel?)** — Smelt items in a nearby furnace (e.g. raw_iron, raw_beef, sand). Auto-selects fuel if not specified. Count defaults to 1.
- **get_recipe(item)** — Look up crafting recipes for an item. Shows ingredients, whether a crafting table is needed, and checks if you have the materials.

## Block Interaction
- **break_block(x, y, z)** — Break a block at coordinates. Auto-selects best tool. Must be within ~6 blocks.
- **place_block(x, y, z, face?)** — Place currently held block on a face of a reference block. Face defaults to up.
- **interact(x, y, z)** — Right-click a block (doors, levers, chests, furnaces, beds, etc.). Must be within ~5 blocks.

## Inventory & Status
- **drop_item(item, count?, username?)** — Drop items from inventory by name. Count defaults to all matching items. Faces the target player first if provided or if exactly one nearby player is present.
- **get_inventory** — List all items in inventory, hotbar, and armor slots.
- **get_health_status** — Get current health, food, and saturation levels.
- **get_active_effects** — List active potion effects with duration and amplifier.

## Utility
- **list_tools** — List all available tools and their descriptions.
