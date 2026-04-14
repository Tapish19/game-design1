# Multiplayer Tic-Tac-Toe · Nakama

Production-ready server-authoritative multiplayer Tic-Tac-Toe built on [Nakama](https://heroiclabs.com/nakama/).

---

## Architecture

```
client (React + Vite)
  │  WebSocket (persistent)
  ▼
nakama:7350  ←── match handler (TypeScript runtime)
  │                  • validates every move server-side
  │                  • manages turn timers via match loop tick
  │                  • broadcasts authoritative state to both clients
  ▼
cockroachdb  ←── users, sessions, storage objects, leaderboard
```

All game state lives on the server. The client is a pure view — it sends *intents* (move position) and receives *facts* (new board state). Players cannot manipulate state locally.

---

## Project structure

```
tictactoe/
├── server/
│   ├── src/
│   │   ├── main.ts           # Module entry — registers RPCs + match handler
│   │   └── match_handler.ts  # Authoritative game logic
│   ├── package.json
│   └── tsconfig.json
│
├── client/
│   ├── src/
│   │   ├── lib/
│   │   │   └── nakama-client.ts   # Singleton client + socket manager
│   │   ├── hooks/
│   │   │   └── useGame.ts         # Match state + socket event wiring
│   │   ├── components/
│   │   │   └── GameBoard.tsx      # Grid, player badges, timer
│   │   ├── pages/
│   │   │   ├── Lobby.tsx          # Matchmaking, room create/join
│   │   │   ├── Game.tsx           # Game page + post-game overlay
│   │   │   └── Leaderboard.tsx    # Rankings + personal stats
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.ts
│   ├── Dockerfile
│   └── nginx.conf
│
├── infra/
│   └── nakama.yml        # Nakama server config
│
├── docker-compose.yml          # Local dev stack
├── docker-compose.prod.yml     # Production overrides + Traefik TLS
└── Makefile
```

---

## Quick start (local)

### Prerequisites
- Docker + Docker Compose v2
- Node.js 20+

### 1 · Build the server runtime

```bash
cd server
npm install
npm run build          # outputs server/dist/main.js
```

### 2 · Start the backend stack

```bash
# From repo root
docker compose up -d

# Verify Nakama is healthy
curl http://localhost:7350/healthcheck
```

Nakama console → http://localhost:7351 (admin / admin)

### 3 · Start the client dev server

```bash
cd client
cp .env.example .env.local    # defaults point to localhost
npm install
npm run dev                   # http://localhost:3000
```

Open two browser windows to play against yourself.

---

## Nakama match handler — key design decisions

### Server tick rate
`TICK_RATE = 5` (5 ticks/second). The match loop runs every 200 ms, which is fast enough for turn-based play and timer enforcement without excessive CPU use.

### Move validation flow
```
client sends MAKE_MOVE (opcode 2)
  → matchLoop receives message
  → check: game status === "playing"
  → check: sender === currentTurnUserId
  → check: position 0-8 and board[position] === null
  → apply move to authoritative board
  → check win / draw
  → if game over → persist leaderboard → broadcast GAME_OVER
  → else → advance turn → reset timer → broadcast GAME_STATE
```

### Turn timer
`TURN_TIMEOUT_TICKS = 150` (150 ticks ÷ 5 tps = 30 seconds). Decremented every tick in `matchLoop`. When it reaches zero, the active player forfeits and the opponent wins. Timer events are broadcast every second (every 5 ticks) to drive the UI countdown.

### Disconnect handling
When a player's socket closes, `matchLeave` adds them to `state.disconnected` with a tick counter. The match loop increments this counter. After `DISCONNECT_GRACE_TICKS = 75` (15 seconds), the disconnected player forfeits. If they reconnect within the window, their presence is restored and the game continues.

### Concurrent games
Each Nakama match is fully isolated in its own goroutine with its own state object. There is no shared mutable state between matches. The number of concurrent games is limited only by server memory.

---

## Matchmaking modes

| Mode | Description |
|------|-------------|
| **Classic** | Standard game, no time limit per turn |
| **Timed** | 30-second turn timer; forfeit on timeout |

The matchmaker query `properties.mode:timed` ensures players are only paired with others using the same mode.

---

## RPCs

| RPC | Payload | Returns |
|-----|---------|---------|
| `find_match` | `{ mode: "classic" \| "timed" }` | `{ ticket: string }` — matchmaker ticket |
| `create_room` | `{ mode: "classic" \| "timed" }` | `{ matchId: string }` — private room code |
| `get_stats` | — | `{ wins, losses, draws }` |
| `get_leaderboard` | — | `{ entries: [{ rank, userId, username, wins }] }` |

---

## WebSocket opcodes

| Code | Direction | Meaning |
|------|-----------|---------|
| 1 | Server → Client | `GAME_STATE` — full board + metadata |
| 2 | Client → Server | `MAKE_MOVE` — `{ position: 0-8 }` |
| 4 | Server → Client | `GAME_OVER` — final state + reason |
| 5 | Server → Client | `TIMER_TICK` — `{ timeLeft, userId }` |
| 6 | Server → Client | `ERROR` — `{ message }` |
| 7 | Server → Client | `OPPONENT_STATUS` — `{ status: "disconnected" \| "reconnected" }` |

---

## Production deployment (DigitalOcean example)

### 1 · Provision a droplet
A 2 vCPU / 4 GB droplet comfortably handles hundreds of concurrent games.

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
```

### 2 · Clone and configure

```bash
git clone https://github.com/yourorg/tictactoe.git
cd tictactoe

cat > .env.prod <<EOF
NAKAMA_SERVER_KEY=change-me-strong-random-key
NAKAMA_CONSOLE_PASSWORD=change-me
ACME_EMAIL=you@yourdomain.com
EOF
```

### 3 · Point DNS
Add an A record: `api.yourdomain.com` → droplet IP  
Add an A record: `yourdomain.com` → droplet IP

### 4 · Deploy

```bash
make deploy
```

Traefik will provision Let's Encrypt TLS automatically. The game will be live at `https://yourdomain.com`.

### Scaling
For higher load, run Nakama behind a load balancer with multiple nodes and a shared CockroachDB cluster. Sticky sessions (or a consistent hash on `userId`) ensure WebSocket connections route to the same Nakama node. CockroachDB handles cross-node data consistency.

---

## Leaderboard

The global leaderboard uses Nakama's built-in leaderboard system (`leaderboardRecordWrite`). It is `DESCENDING` by score (wins) with no reset schedule (all-time). Win/loss/draw stats are also persisted to Nakama storage objects (`player_stats` collection) for personal stat display.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NAKAMA_SERVER_KEY` | `defaultkey` | Shared secret for client–server auth |
| `NAKAMA_CONSOLE_PASSWORD` | `admin` | Nakama admin console password |
| `ACME_EMAIL` | — | Email for Let's Encrypt (prod only) |
| `VITE_NAKAMA_HOST` | `127.0.0.1` | Nakama host (baked into client build) |
| `VITE_NAKAMA_PORT` | `7350` | Nakama port |
| `VITE_NAKAMA_SSL` | `false` | Use WSS/HTTPS |
| `VITE_NAKAMA_KEY` | `defaultkey` | Server key (client-side, not secret) |

---

## Bonus features checklist

- [x] Server-authoritative game logic (all moves validated server-side)
- [x] Auto matchmaking (Nakama matchmaker pool)
- [x] Private rooms (create + join by code)
- [x] Disconnect handling with grace period + forfeit
- [x] Concurrent game sessions (isolated per match)
- [x] Leaderboard (wins, global ranking)
- [x] Personal stats (wins / losses / draws / win rate)
- [x] Timed mode (30 s per turn, server-enforced)
- [x] Auto-forfeit on timeout
- [x] Mode selection in matchmaking (classic vs timed)
- [x] TLS + production deployment via Docker Compose + Traefik
