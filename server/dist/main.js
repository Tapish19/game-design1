"use strict";
// main.ts
// Nakama module entry — registers all RPCs and the match handler
Object.defineProperty(exports, "__esModule", { value: true });
const match_handler_1 = require("./match_handler");
function normalizeStatsRecord(raw) {
    var _a, _b, _c;
    const empty = { wins: 0, losses: 0, draws: 0 };
    if (raw == null)
        return empty;
    let value = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        }
        catch {
            return empty;
        }
    }
    if (value && typeof value === "object" && "value" in value) {
        value = value.value;
    }
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        }
        catch {
            return empty;
        }
    }
    if (!value || typeof value !== "object")
        return empty;
    return {
        wins: Number((_a = value.wins) !== null && _a !== void 0 ? _a : 0),
        losses: Number((_b = value.losses) !== null && _b !== void 0 ? _b : 0),
        draws: Number((_c = value.draws) !== null && _c !== void 0 ? _c : 0),
    };
}
// ── RPC: Create or find a match ──────────────────────────────────────────────
const rpcFindMatch = (ctx, logger, nk, payload) => {
    let mode = "classic";
    if (payload) {
        try {
            const data = JSON.parse(payload);
            if (data.mode === "timed")
                mode = "timed";
        }
        catch { }
    }
    // Use Nakama's built-in matchmaker for auto-pairing
    // Returns a matchmaker ticket; client listens for the matched event
    const ticket = nk.matchmakerAdd(ctx, 2, // minCount
    2, // maxCount
    `properties.mode:${mode}`, // query — match same mode
    { mode }, // string properties
    {} // numeric properties
    );
    return JSON.stringify({ ticket });
};
// ── RPC: Create a private room ───────────────────────────────────────────────
const rpcCreateRoom = (ctx, logger, nk, payload) => {
    let mode = "classic";
    if (payload) {
        try {
            const data = JSON.parse(payload);
            if (data.mode === "timed")
                mode = "timed";
        }
        catch { }
    }
    const matchId = nk.matchCreate("tictactoe", { mode });
    logger.info("Created private room: %v (mode=%v)", matchId, mode);
    return JSON.stringify({ matchId });
};
// ── RPC: Get player stats ────────────────────────────────────────────────────
const rpcGetStats = (ctx, logger, nk, payload) => {
    if (!ctx.userId)
        throw new Error("Not authenticated");
    const records = nk.storageRead([{
            collection: "player_stats",
            key: "record",
            userId: ctx.userId,
        }]);
    if (records.length === 0) {
        return JSON.stringify({ wins: 0, losses: 0, draws: 0 });
    }
    return JSON.stringify(normalizeStatsRecord(records[0].value));
};
// ── RPC: Get leaderboard ─────────────────────────────────────────────────────
const rpcGetLeaderboard = (ctx, logger, nk, payload) => {
    var _a;
    let result = null;
    const nkAny = nk;
    try {
        result = nkAny.leaderboardRecordsList("global_wins", [], 20, null, 0);
    }
    catch (firstError) {
        try {
            result = nkAny.leaderboardRecordsList("global_wins", [], 20, null);
        }
        catch (secondError) {
            logger.error("get_leaderboard failed: %v / %v", firstError, secondError);
            return JSON.stringify({ entries: [] });
        }
    }
    const records = Array.isArray(result)
        ? result
        : ((_a = result === null || result === void 0 ? void 0 : result.records) !== null && _a !== void 0 ? _a : []);
    const entries = records.map((r) => {
        var _a, _b, _c;
        return ({
            rank: r.rank,
            userId: (_a = r.ownerId) !== null && _a !== void 0 ? _a : r.owner_id,
            username: (_b = r.username) !== null && _b !== void 0 ? _b : "Unknown",
            wins: (_c = r.score) !== null && _c !== void 0 ? _c : 0,
        });
    });
    return JSON.stringify({ entries });
};
// ── Module init ──────────────────────────────────────────────────────────────
function InitModule(ctx, logger, nk, initializer) {
    // Ensure the leaderboard exists
    try {
        nk.leaderboardCreate("global_wins", false, "desc", // sort order
        "increment", // operator
        null // reset schedule
        );
    }
    catch {
        // Already exists
    }
    // Register match handler
    initializer.registerMatch("tictactoe", {
        matchInit: match_handler_1.matchInit,
        matchJoinAttempt: match_handler_1.matchJoinAttempt,
        matchJoin: match_handler_1.matchJoin,
        matchLeave: match_handler_1.matchLeave,
        matchLoop: match_handler_1.matchLoop,
        matchTerminate: match_handler_1.matchTerminate,
        matchSignal: match_handler_1.matchSignal,
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
!InitModule && InitModule(null, null, null, null);
