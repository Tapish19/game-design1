# Multiplayer Tic-Tac-Toe (Nakama + React)

Server-authoritative multiplayer Tic-Tac-Toe built with:

- **Nakama** (real-time game server + RPC)
- **CockroachDB** (persistent storage)
- **TypeScript runtime module** for authoritative match logic
- **React + Vite client**

This README covers setup, architecture, deployment, API/server configuration, and multiplayer testing.

---

## 1) Setup and installation

### Prerequisites

- Docker + Docker Compose v2
- Node.js 20+
- npm

### Clone and install

```bash
git clone <your-repo-url>
cd game-design1

# Server runtime (Nakama JS module)
cd server
npm install
npm run build

# Client app
cd ../client
npm install
```

### Run locally with Docker

From repository root:

```bash
docker compose up -d
```

This starts:

- `cockroachdb` on ports `26257` (SQL) and `8081` (admin UI proxy)
- `nakama` on ports `7349`, `7350`, `7351`

Health check:

```bash
curl http://localhost:7350/healthcheck
```

Nakama console:

- URL: `http://localhost:7351`
- Username: <ADMIN_USERNAME>
- Password: <ADMIN_PASSWORD>

### Start the client

```bash
cd client
npm run dev
```

Vite dev server runs at `http://localhost:3000`.

---

## 2) Architecture and design decisions

### High-level architecture

```text
React Client (Vite)
  └─ websocket + RPC ──> Nakama
                           ├─ match handler (server-authoritative game state)
                           ├─ RPC endpoints (find/create room, stats, leaderboard)
                           └─ storage + leaderboard ops
                                   └─ CockroachDB
```

### Design decisions

#### Server-authoritative game logic

The client sends **intent** (`MAKE_MOVE`), and the Nakama match loop validates and applies all state changes. This prevents client-side cheating and guarantees consistent state across both players.

#### Tick-based timing

- `TICK_RATE = 5` (200ms loop)
- `TURN_TIMEOUT_TICKS = 150` (30s timed turn)
- `DISCONNECT_GRACE_TICKS = 75` (15s reconnect grace)

A tick loop keeps turn timers, disconnect grace windows, and forfeit logic deterministic.

#### Match isolation and concurrency

Each match maintains an isolated in-memory state object in Nakama, allowing many games to run concurrently without shared mutable match state.

#### Persistent progression

- Global wins leaderboard: `global_wins`
- Per-player stats in storage object:
  - collection: `player_stats`
  - key: `record`

---

## 3) API/server configuration details

### Nakama runtime registration

The module registers:

- Match handler: `tictactoe`
- RPCs:
  - `find_match`
  - `create_room`
  - `get_stats`
  - `get_leaderboard`

### RPC API

| RPC | Input | Output |
| --- | --- | --- |
| `find_match` | `{ "mode": "classic" | "timed" }` | `{ "ticket": "..." }` |
| `create_room` | `{ "mode": "classic" | "timed" }` | `{ "matchId": "..." }` |
| `get_stats` | none | `{ "wins": n, "losses": n, "draws": n }` |
| `get_leaderboard` | none | `{ "entries": [{ rank, userId, username, wins, losses, draws }] }` |

### Match WebSocket opcodes

| Opcode | Direction | Description |
| --- | --- | --- |
| `1` | Server → Client | `GAME_STATE` |
| `2` | Client → Server | `MAKE_MOVE` |
| `3` | Reserved | `PLAYER_READY` (defined, not currently used by client flow) |
| `4` | Server → Client | `GAME_OVER` |
| `5` | Server → Client | `TIMER_TICK` |
| `6` | Server → Client | `ERROR` |
| `7` | Server → Client | `OPPONENT_STATUS` |

### Core server config

From `nakama/local.yml`:

- Runtime JS entrypoint: `index.js`
- Runtime module path: `/nakama/data/modules`
- Session token expiry: `7200` seconds
- Console auth configured in file (local/dev)

### Environment variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `NAKAMA_SERVER_KEY` | `defaultkey` | Shared key used by client + server |
| `NAKAMA_CONSOLE_USERNAME` | `admin` | Console login user |
| `NAKAMA_CONSOLE_PASSWORD` | `admin1234` | Console login password |
| `VITE_NAKAMA_HOST` | `127.0.0.1` / `api.example.com` | Client target host |
| `VITE_NAKAMA_PORT` | `7350` / `443` | Client target port |
| `VITE_NAKAMA_SSL` | `false` / `true` | ws vs wss |
| `VITE_NAKAMA_KEY` | same as server key | Client Nakama server key |
| `ACME_EMAIL` | `ops@example.com` | TLS cert email (Traefik production mode) |

---

## 4) Deployment process documentation

Below are two supported deployment patterns:

### A) Docker Compose production stack (single VM)

Use:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

This enables:

- `traefik` TLS termination
- `frontend` container build with production Vite args
- `nakama` with production env overrides

Good for a single host setup.

### B) CockroachDB Cloud + Render + Vercel (recommended managed path)

This project is deployed using:

- CockroachDB CockroachDB Cloud (database)
- Render Render (Nakama backend)
- Vercel Vercel (React frontend)

#### 1️⃣ CockroachDB Cloud (Database Setup)

##### Step 1: Create Cluster

- Log into CockroachDB Cloud
- Create a Serverless cluster
- Select region close to your users

##### Step 2: Create Database

```sql
CREATE DATABASE <DATABASE_NAME>;
```

##### Step 3: Create SQL User

```sql
CREATE USER <DB_USER> WITH PASSWORD '<DB_PASSWORD>';
```

##### Step 4: Grant Permissions

```sql
GRANT ALL ON DATABASE <DATABASE_NAME> TO <DB_USER>;
GRANT ALL ON SCHEMA public TO <DB_USER>;
```

👉 Nakama will automatically create required tables (storage, leaderboard_record, etc.) during first startup.

##### Step 5: Configure Network Access

Go to Network Access.

Add:

```text
0.0.0.0/0
```

👉 This allows your backend (Render) to connect.  
👉 In production, restrict this to specific IP ranges.

##### Step 6: Connection String

Format:

```text
postgresql://<DB_USER>:<DB_PASSWORD>@<HOST>:26257/<DATABASE_NAME>?sslmode=verify-full
```

#### 2️⃣ Render (Nakama Backend Deployment)

##### Step 1: Create Web Service

- Platform: Docker
- Image: `heroiclabs/nakama:<VERSION>`

##### Step 2: Add Runtime Module

Ensure your compiled server file is placed at:

```text
/nakama/data/modules/index.js
```

👉 This file contains your match handler and RPC logic.

##### Step 3: Configure Environment Variables

Set the following in Render:

```text
NAKAMA_SERVER_KEY=<SERVER_KEY>
NAKAMA_CONSOLE_USERNAME=<ADMIN_USERNAME>
NAKAMA_CONSOLE_PASSWORD=<ADMIN_PASSWORD>
NAKAMA_DATABASE_ADDRESS=<CONNECTION_STRING>
```

##### Step 4: Deploy & Verify

After deployment:

- Backend URL will be: `https://<RENDER_SERVICE_DOMAIN>`
- Test health:

```bash
curl https://<RENDER_SERVICE_DOMAIN>/healthcheck
```

##### Step 5: Verify Nakama Console (Optional)

Open:

```text
https://<RENDER_SERVICE_DOMAIN>/console
```

Login using your console credentials.

#### 3️⃣ Vercel (Frontend Deployment)

##### Step 1: Deploy Project

- Import repository into Vercel
- Select `client/` as root
- Framework: Vite

##### Step 2: Set Environment Variables

```text
VITE_NAKAMA_HOST=<RENDER_SERVICE_DOMAIN>
VITE_NAKAMA_PORT=443
VITE_NAKAMA_SSL=true
VITE_NAKAMA_KEY=<SERVER_KEY>
```

##### 5. Smoke test production

- Open two browser sessions.
- Create/join room and complete full match.
- Confirm leaderboard updates.

---

## 5) How to test multiplayer functionality

### Local manual test (required)

1. Start backend + client.
2. Open two browser windows (or one normal + one incognito).
3. In both clients, authenticate and join the same mode.
4. Verify:
   - Both players receive game state updates.
   - Turn enforcement works (cannot move out of turn).
   - Win and draw conditions end match correctly.
   - In timed mode, timeout causes forfeit after ~30s.
   - Disconnect one client and reconnect within ~15s grace.
   - Leaderboard/stats update after game completion.

### Suggested command checks

From `server/`:

```bash
npm run build
```

From repo root:

```bash
docker compose ps
curl http://localhost:7350/healthcheck
```

### Optional regression checklist

- Create private room via `create_room` RPC.
- Join matchmade queue via `find_match` RPC in same mode from two clients.
- Verify `get_stats` reflects wins/losses/draws.
- Verify `get_leaderboard` includes recent winner.

---

## Repository structure

```text
.
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── GameBoard.tsx
│   │   ├── Leaderboard.tsx
│   │   ├── main.tsx
│   │   ├── useGame.ts
│   │   └── nakama-client.ts
├── server/
│   ├── src/
│   │   ├── main.ts
│   │   └── match_handler.ts
│   └── dist/
├── nakama/
│   ├── local.yml
│   └── data/modules/index.js
├── docker-compose.yml
└── docker-compose.prod.yml
```
