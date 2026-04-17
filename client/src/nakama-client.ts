// src/lib/nakama-client.ts
// Singleton Nakama client + socket manager
import { Client } from "./vendor/nakama-js";
import type { Session, Match, Socket } from "./vendor/nakama-js";

const HOST = "game-design1.onrender.com";
const PORT = "443";
const USE_SSL = true;
const SERVER_KEY = import.meta.env.VITE_NAKAMA_KEY ?? "defaultkey";
const HTTP_KEY = import.meta.env.VITE_NAKAMA_HTTP_KEY ?? "defaulthttpkey";
export const OpCode = {
  GAME_STATE: 1,
  MAKE_MOVE: 2,
  PLAYER_READY: 3,
  GAME_OVER: 4,
  TIMER_TICK: 5,
  ERROR: 6,
  OPPONENT_STATUS: 7,
} as const;

export type Mark = "X" | "O" | "";

export interface PlayerInfo {
  userId: string;
  username: string;
  mark: "X" | "O";
}

export interface GameState {
  board: Mark[];
  currentTurnUserId: string | null;
  status: "waiting" | "playing" | "finished";
  winner: string | null;
  timeLeft: number | null;
  players: PlayerInfo[];
}

export interface GameOverPayload extends GameState {
  timeout?: boolean;
  timedOutUserId?: string;
  forfeit?: boolean;
  forfeitUserId?: string;
}

let _client: Client | null = null;
let _session: Session | null = null;
let _socket: Socket | null = null;

// ---------------- CLIENT ----------------
export function getClient(): Client {
  if (!_client) {
    _client = new Client(SERVER_KEY, HOST, String(PORT), USE_SSL);
    _client.ssl = USE_SSL;
  }
  return _client;
}

// ---------------- SESSION ----------------
export function getSession(): Session | null {
  return _session;
}

// ---------------- SOCKET ----------------
export function getSocket(): Socket | null {
  return _socket;
}

// ---------------- AUTH ----------------
export async function authenticateDevice(deviceId?: string): Promise<Session> {
  const id = deviceId ?? getOrCreateDeviceId();
  const client = getClient();

  _session = await client.authenticateDevice(
    id,
    true,
    generateUsername()
  );

  return _session;
}

// ---------------- SOCKET CONNECT ----------------
export async function openSocket(): Promise<Socket> {
  if (!_session) throw new Error("No session — authenticate first");
  if (_socket) return _socket;

  // ✅ FIXED (removed invalid args)
_socket = getClient().createSocket(USE_SSL);
  await _socket.connect(_session, true);

  return _socket;
}

// ---------------- SOCKET CLOSE ----------------
export function closeSocket() {
  // ✅ FIXED (no arguments)
  _socket?.disconnect();
  _socket = null;
}

// ---------------- MATCH ----------------
export async function joinMatchById(matchId: string): Promise<Match> {
  if (!_socket) throw new Error("Socket not open");
  return _socket.joinMatch(matchId);
}

// ---------------- MATCHMAKING ----------------
export async function findMatch(
  mode: "classic" | "timed"
): Promise<string> {
  if (!_socket) throw new Error("Socket not open");
  await _socket.addMatchmaker(mode);
  return "socket_matchmaker";
}

// ---------------- ROOM ----------------
export async function createRoom(
  mode: "classic" | "timed"
): Promise<string> {
  if (!_session) throw new Error("No session");

  const res = await callRpc(
    "create_room",
    JSON.stringify({ mode })
  );

  const data = JSON.parse(res.payload ?? "{}");
  return data.matchId as string;
}

// ---------------- GAME MOVE ----------------
export async function sendMove(
  matchId: string,
  position: number
): Promise<void> {
  if (!_socket) throw new Error("Socket not open");

  await _socket.sendMatchState(
    matchId,
    OpCode.MAKE_MOVE,
    JSON.stringify({ position })
  );
}

// ---------------- LEADERBOARD ----------------
export async function getLeaderboard(): Promise<
  { rank: number; userId: string; username: string; wins: number }[]
> {
  if (!_session) return [];

  const res = await callRpc("get_leaderboard", "");
  const data = JSON.parse(res.payload ?? "{}");

  return data.entries ?? [];
}

// ---------------- STATS ----------------
export async function getMyStats(): Promise<{
  wins: number;
  losses: number;
  draws: number;
}> {
  if (!_session)
    return { wins: 0, losses: 0, draws: 0 };

  const res = await callRpc("get_stats", "");
  return JSON.parse(res.payload ?? "{}");
}

// ---------------- RPC HANDLER ----------------
async function callRpc(
  id: string,
  payload: string
): Promise<{ payload?: string }> {
  const client = getClient() as any;
  const normalize = (res: any): { payload?: string } => {
    // Wrapped Nakama RPC response shape: { payload: string }
    if (res && typeof res.payload === "string") {
      return { payload: res.payload };
    }
    // Unwrapped response can be raw JSON/string.
    if (typeof res === "string") {
      return { payload: res };
    }
    if (res == null) {
      return { payload: "" };
    }
    return { payload: JSON.stringify(res) };
  };

  // Try token-auth RPC first when a session is available.
  if (_session && typeof client.rpc === "function") {
    try {
      return normalize(await client.rpc(_session, id, payload));
    } catch {
      // Fall through to HTTP key RPC as a compatibility fallback.
    }
  }

  // ✅ Fallback for older SDK / http_key RPC
  if (typeof client.rpcHttpKey === "function") {
    return normalize(await client.rpcHttpKey(HTTP_KEY, id, payload));
  }

  throw new Error("No compatible RPC method found on Nakama client");
}

// ---------------- DEVICE ID ----------------
function getOrCreateDeviceId(): string {
  const deviceKey = "ttt_device_id";
  const tabKey = "ttt_tab_id";

  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(deviceKey, deviceId);
  }

  let tabId = sessionStorage.getItem(tabKey);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(tabKey, tabId);
  }

  // Make auth identity unique per tab/window so two tabs can play each other.
  return `${deviceId}-${tabId}`;
}

// ---------------- USERNAME ----------------
function generateUsername(): string {
  const adj = ["swift", "bold", "sharp", "cool", "wise"];
  const noun = ["fox", "hawk", "wolf", "lynx", "bear"];
  const num = Math.floor(Math.random() * 9000) + 1000;

  return `${adj[Math.floor(Math.random() * adj.length)]}_${
    noun[Math.floor(Math.random() * noun.length)]
  }_${num}`;
}
