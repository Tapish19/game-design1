// main.ts
// Nakama module entry — registers all RPCs and the match handler

import {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLeave,
  matchLoop,
  matchTerminate,
  matchSignal,
} from "./match_handler";

interface StatsRecord {
  wins: number;
  losses: number;
  draws: number;
}

function normalizeStatsRecord(raw: unknown): StatsRecord {
  const empty: StatsRecord = { wins: 0, losses: 0, draws: 0 };
  if (raw == null) return empty;

  let value: any = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return empty;
    }
  }
  if (value && typeof value === "object" && "value" in value) {
    value = (value as any).value;
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return empty;
    }
  }
  if (!value || typeof value !== "object") return empty;

  return {
    wins: Number((value as any).wins ?? 0),
    losses: Number((value as any).losses ?? 0),
    draws: Number((value as any).draws ?? 0),
  };
}

function readStatsRecord(nk: nkruntime.Nakama, userId: string): StatsRecord {
  let records: any[] = [];
  try {
    records = nk.storageRead([{
      collection: "player_stats",
      key: "record",
      userId,
    }]);
  } catch {}

  if (!records || records.length === 0) {
    try {
      records = nk.storageRead([{
        collection: "player_stats",
        key: "record",
        // @ts-ignore runtime variant compatibility
        user_id: userId,
      }]);
    } catch {}
  }

  if (!records || records.length === 0) {
    return { wins: 0, losses: 0, draws: 0 };
  }
  return normalizeStatsRecord(records[0].value);
}

// ── RPC: Create or find a match ──────────────────────────────────────────────

const rpcFindMatch: nkruntime.RpcFunction = (
  ctx, logger, nk, payload
) => {
  let mode = "classic";
  if (payload) {
    try {
      const data = JSON.parse(payload);
      if (data.mode === "timed") mode = "timed";
    } catch {}
  }

  // Use Nakama's built-in matchmaker for auto-pairing
  // Returns a matchmaker ticket; client listens for the matched event
  const ticket = nk.matchmakerAdd(
    ctx,
    2,         // minCount
    2,         // maxCount
    `properties.mode:${mode}`, // query — match same mode
    { mode },  // string properties
    {}         // numeric properties
  );

  return JSON.stringify({ ticket });
};

// ── RPC: Create a private room ───────────────────────────────────────────────

const rpcCreateRoom: nkruntime.RpcFunction = (
  ctx, logger, nk, payload
) => {
  let mode = "classic";
  if (payload) {
    try {
      const data = JSON.parse(payload);
      if (data.mode === "timed") mode = "timed";
    } catch {}
  }

  const matchId = nk.matchCreate("tictactoe", { mode });
  logger.info("Created private room: %v (mode=%v)", matchId, mode);
  return JSON.stringify({ matchId });
};

// ── RPC: Get player stats ────────────────────────────────────────────────────

const rpcGetStats: nkruntime.RpcFunction = (
  ctx, logger, nk, payload
) => {
  if (!ctx.userId) throw new Error("Not authenticated");
  return JSON.stringify(readStatsRecord(nk, ctx.userId));
};

// ── RPC: Get leaderboard ─────────────────────────────────────────────────────

const rpcGetLeaderboard: nkruntime.RpcFunction = (
  ctx, logger, nk, payload
) => {
  let result: any = null;
  const nkAny = nk as any;

  try {
    result = nkAny.leaderboardRecordsList("global_wins", [], 20, null, 0);
  } catch (firstError) {
    try {
      result = nkAny.leaderboardRecordsList("global_wins", [], 20, null);
    } catch (secondError) {
      logger.error("get_leaderboard failed: %v / %v", firstError, secondError);
      return JSON.stringify({ entries: [] });
    }
  }

  const records = Array.isArray(result)
    ? result
    : (result?.records ?? []);

  const userIds = records
    .map((r: any) => r.ownerId ?? r.owner_id)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  const statsByUserId = new Map<string, StatsRecord>();
  for (const userId of userIds) {
    statsByUserId.set(userId, readStatsRecord(nk, userId));
  }

  const entries = records.map((r: any) => ({
    rank: r.rank,
    userId: r.ownerId ?? r.owner_id,
    username: r.username ?? "Unknown",
    wins: r.score ?? 0,
    losses: statsByUserId.get(r.ownerId ?? r.owner_id)?.losses ?? 0,
    draws: statsByUserId.get(r.ownerId ?? r.owner_id)?.draws ?? 0,
  }));

  return JSON.stringify({ entries });
};

// ── Module init ──────────────────────────────────────────────────────────────

function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
) {
  // Ensure the leaderboard exists
  try {
    nk.leaderboardCreate(
  "global_wins",
  false,
  "desc",       // sort order
  "increment",  // operator
  null          // reset schedule
);

  } catch {
    // Already exists
  }

  // Register match handler
  initializer.registerMatch("tictactoe", {
    matchInit,
    matchJoinAttempt,
    matchJoin,
    matchLeave,
    matchLoop,
    matchTerminate,
    matchSignal,
  });

  // Register RPCs
  initializer.registerRpc("find_match", rpcFindMatch);
  initializer.registerRpc("create_room", rpcCreateRoom);
  initializer.registerRpc("get_stats", rpcGetStats);
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);

  logger.info("Tic-Tac-Toe module loaded");
}

// Required export for Nakama to pick up the module
// @ts-ignore
!InitModule && InitModule(null!, null!, null!, null!);
