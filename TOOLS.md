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
