# TOOLS.md — Available Tools

## Communication
- **send_message(message)** — Send a message to game chat. Players only see this.
- **remember(fact)** — Save a fact to long-term memory (survives restart).

## Vision
- **take_screenshot** — Capture what is in front of you. Returns an image.
- **look_at_player(username)** — Turn to face a player by name.
- **get_surroundings** — Text summary: position, health, time, nearby players/mobs.

## Movement
- **go_to(x, y?, z)** — Navigate to coordinates using pathfinding. Y is optional (uses current height).
- **move(direction, duration)** — Move forward/backward/left/right for N seconds (0.5–5s).
- **jump** — Jump once. Useful for obstacles or gaps.
