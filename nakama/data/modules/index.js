// Nakama runtime module (plain JS for Goja runtime).
// Includes matchmaking RPCs + authoritative Tic-Tac-Toe match handler.

var TICK_RATE = 5;
var TURN_TIMEOUT_TICKS = 150;
var DISCONNECT_GRACE_TICKS = 75;
var MAX_PLAYERS = 2;

var OpCode = {
  GAME_STATE: 1,
  MAKE_MOVE: 2,
  PLAYER_READY: 3,
  GAME_OVER: 4,
  TIMER_TICK: 5,
  ERROR: 6,
  OPPONENT_STATUS: 7,
};

var WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function emptyBoard() {
  return [null, null, null, null, null, null, null, null, null];
}

function boardToPublic(board) {
  return board.map(function (c) { return c || ""; });
}

function checkWinner(board) {
  for (var i = 0; i < WIN_LINES.length; i += 1) {
    var line = WIN_LINES[i];
    var a = line[0], b = line[1], c = line[2];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  for (var j = 0; j < board.length; j += 1) {
    if (board[j] === null) return null;
  }
  return "draw";
}

function buildGameStatePayload(state) {
  var players = Object.keys(state.players).map(function (id) {
    var p = state.players[id];
    return { userId: p.userId, username: p.username, mark: p.mark };
  });

  return {
    board: boardToPublic(state.board),
    currentTurnUserId: state.currentTurnUserId,
    status: state.status,
    winner: state.winner,
    timeLeft: state.timedMode ? Math.ceil(state.turnTicksRemaining / TICK_RATE) : null,
    players: players,
  };
}

function sendToAll(dispatcher, presences, opcode, payload) {
  dispatcher.broadcastMessage(opcode, JSON.stringify(payload), presences, null, true);
}

function sendToOne(dispatcher, presence, opcode, payload) {
  dispatcher.broadcastMessage(opcode, JSON.stringify(payload), [presence], null, true);
}

function normalizeStatsRecordDetailed(raw) {
  var empty = { wins: 0, losses: 0, draws: 0 };
  if (raw === null || raw === undefined) return { stats: empty, valid: false };

  var value = raw;
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    value = value.value;
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_) {
      return { stats: empty, valid: false };
    }
  }
  if (!value || typeof value !== "object") return { stats: empty, valid: false };

  return {
    stats: {
      wins: Number(value.wins || 0),
      losses: Number(value.losses || 0),
      draws: Number(value.draws || 0),
    },
    valid: true,
  };
}

function normalizeStatsRecord(raw) {
  return normalizeStatsRecordDetailed(raw).stats;
}

function readPlayerStatsRecord(nk, userId) {
  var reads = [];
  try {
    reads = nk.storageRead([{ collection: "player_stats", key: "record", userId: userId }]);
  } catch (_) {}
  if (!reads || reads.length === 0) return { wins: 0, losses: 0, draws: 0 };
  return normalizeStatsRecord(reads[0].value);
}

function readPlayerStatsRecordMeta(nk, userId) {
  var reads = [];
  try {
    reads = nk.storageRead([{ collection: "player_stats", key: "record", userId: userId }]);
  } catch (_) {
    return { stats: { wins: 0, losses: 0, draws: 0 }, valid: false };
  }

  if (!reads || reads.length === 0) {
    return { stats: { wins: 0, losses: 0, draws: 0 }, valid: false };
  }

  return normalizeStatsRecordDetailed(reads[0].value);
}

function writePlayerStatsRecord(nk, userId, record) {
  var payload = {
    collection: "player_stats",
    key: "record",
    userId: userId,
    value: JSON.stringify(record),
    permissionRead: 2,
    permissionWrite: 0,
  };
  nk.storageWrite([payload]);
}

function updateStats(nk, userId, change) {
  var record = readPlayerStatsRecord(nk, userId);
  record.wins += change.wins || 0;
  record.losses += change.losses || 0;
  record.draws += change.draws || 0;
  writePlayerStatsRecord(nk, userId, record);
}

function finishGame(state, nk, logger, winnerValue) {
  state.status = "finished";

  if (winnerValue === "draw") {
    state.winner = "draw";
    for (var i = 0; i < state.playerOrder.length; i += 1) {
      try {
        updateStats(nk, state.playerOrder[i], { draws: 1 });
      } catch (drawErr) {
        logger.error("Failed to persist draw for user %v: %v", state.playerOrder[i], drawErr);
      }
    }
    return;
  }

  var winnerUserId = null;
  var all = Object.keys(state.players);
  for (var j = 0; j < all.length; j += 1) {
    var p = state.players[all[j]];
    if (p.mark === winnerValue) {
      winnerUserId = p.userId;
      break;
    }
  }

  state.winner = winnerUserId;
  if (!winnerUserId) return;

  var loserUserId = state.playerOrder[0] === winnerUserId ? state.playerOrder[1] : state.playerOrder[0];

  try {
    nk.leaderboardRecordWrite(
      "global_wins",
      winnerUserId,
      state.players[winnerUserId] ? state.players[winnerUserId].username : "Unknown",
      1,
      0,
      {}
    );
  } catch (lbErr) {
    logger.error("Failed to write leaderboard win for user %v: %v", winnerUserId, lbErr);
  }

  try {
    updateStats(nk, winnerUserId, { wins: 1 });
  } catch (winnerStatsErr) {
    logger.error("Failed to write winner stats for user %v: %v", winnerUserId, winnerStatsErr);
  }

  if (loserUserId) {
    try {
      updateStats(nk, loserUserId, { losses: 1 });
    } catch (loserStatsErr) {
      logger.error("Failed to write loser stats for user %v: %v", loserUserId, loserStatsErr);
    }
  }
}

function matchInit(ctx, logger, nk, params) {
  var timedMode = params && params.mode === "timed";
  var state = {
    board: emptyBoard(),
    players: {},
    playerOrder: [],
    currentTurnUserId: null,
    turnTicksRemaining: TURN_TIMEOUT_TICKS,
    status: "waiting",
    winner: null,
    disconnected: {},
    timedMode: timedMode,
  };
  return { state: state, tickRate: TICK_RATE, label: JSON.stringify({ mode: timedMode ? "timed" : "classic" }) };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (state.status === "finished") return { state: state, accept: false, rejectMessage: "Match is already over" };
  if (Object.keys(state.players).length >= MAX_PLAYERS && !state.players[presence.userId]) {
    return { state: state, accept: false, rejectMessage: "Match is full" };
  }
  return { state: state, accept: true };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i += 1) {
    var presence = presences[i];
    delete state.disconnected[presence.userId];

    if (!state.players[presence.userId]) {
      var mark = state.playerOrder.length === 0 ? "X" : "O";
      state.players[presence.userId] = {
        userId: presence.userId,
        username: presence.username,
        mark: mark,
        presence: presence,
      };
      state.playerOrder.push(presence.userId);
    } else {
      state.players[presence.userId].presence = presence;
      var others = Object.keys(state.players)
        .map(function (id) { return state.players[id]; })
        .filter(function (p) { return p.userId !== presence.userId; })
        .map(function (p) { return p.presence; });
      if (others.length > 0) {
        sendToAll(dispatcher, others, OpCode.OPPONENT_STATUS, { status: "reconnected", userId: presence.userId });
      }
    }
  }

  if (state.playerOrder.length === MAX_PLAYERS && state.status === "waiting") {
    state.status = "playing";
    state.currentTurnUserId = state.playerOrder[0];
    state.turnTicksRemaining = TURN_TIMEOUT_TICKS;
  }

  var allPresences = Object.keys(state.players).map(function (id) { return state.players[id].presence; });
  sendToAll(dispatcher, allPresences, OpCode.GAME_STATE, buildGameStatePayload(state));
  return { state: state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i += 1) {
    var presence = presences[i];
    if (state.status === "playing") {
      state.disconnected[presence.userId] = 0;
      var remaining = Object.keys(state.players)
        .map(function (id) { return state.players[id]; })
        .filter(function (p) { return p.userId !== presence.userId; })
        .map(function (p) { return p.presence; });
      if (remaining.length > 0) {
        sendToAll(dispatcher, remaining, OpCode.OPPONENT_STATUS, { status: "disconnected", userId: presence.userId });
      }
    } else if (state.status === "waiting") {
      delete state.players[presence.userId];
      state.playerOrder = state.playerOrder.filter(function (id) { return id !== presence.userId; });
    }
  }
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  for (var i = 0; i < messages.length; i += 1) {
    var msg = messages[i];
    var player = state.players[msg.sender.userId];
    if (!player) continue;

    if (msg.opCode === OpCode.MAKE_MOVE) {
      var data = null;
      try {
        data = JSON.parse(nk.binaryToString(msg.data));
      } catch (_) {
        sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Invalid message format" });
        continue;
      }

      if (state.status !== "playing") {
        sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Game is not in progress" });
        continue;
      }
      if (state.currentTurnUserId !== player.userId) {
        sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Not your turn" });
        continue;
      }

      var pos = data.position;
      if (typeof pos !== "number" || pos < 0 || pos > 8 || state.board[pos] !== null) {
        sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Invalid move" });
        continue;
      }

      state.board[pos] = player.mark;
      var result = checkWinner(state.board);
      if (result) {
        finishGame(state, nk, logger, result);
        sendToAll(dispatcher, Object.keys(state.players).map(function (id) { return state.players[id].presence; }), OpCode.GAME_OVER, buildGameStatePayload(state));
      } else {
        state.currentTurnUserId = state.playerOrder[0] === player.userId ? state.playerOrder[1] : state.playerOrder[0];
        state.turnTicksRemaining = TURN_TIMEOUT_TICKS;
        sendToAll(dispatcher, Object.keys(state.players).map(function (id) { return state.players[id].presence; }), OpCode.GAME_STATE, buildGameStatePayload(state));
      }
    }
  }

  if (state.status === "playing") {
    var disconnectedIds = Object.keys(state.disconnected);
    for (var j = 0; j < disconnectedIds.length; j += 1) {
      var userId = disconnectedIds[j];
      state.disconnected[userId] += 1;
      if (state.disconnected[userId] >= DISCONNECT_GRACE_TICKS) {
        var winnerId = state.playerOrder[0] === userId ? state.playerOrder[1] : state.playerOrder[0];
        if (winnerId && state.players[winnerId]) {
          finishGame(state, nk, logger, state.players[winnerId].mark);
          sendToAll(dispatcher, Object.keys(state.players).map(function (id) { return state.players[id].presence; }), OpCode.GAME_OVER, buildGameStatePayload(state));
        }
      }
    }

    if (state.timedMode && state.status === "playing") {
      state.turnTicksRemaining -= 1;
      if (state.turnTicksRemaining <= 0 && state.currentTurnUserId) {
        var timeoutUserId = state.currentTurnUserId;
        var timeoutWinnerId = state.playerOrder[0] === timeoutUserId ? state.playerOrder[1] : state.playerOrder[0];
        if (timeoutWinnerId && state.players[timeoutWinnerId]) {
          finishGame(state, nk, logger, state.players[timeoutWinnerId].mark);
          sendToAll(dispatcher, Object.keys(state.players).map(function (id) { return state.players[id].presence; }), OpCode.GAME_OVER, buildGameStatePayload(state));
        }
      } else if (state.turnTicksRemaining % TICK_RATE === 0) {
        sendToAll(
          dispatcher,
          Object.keys(state.players).map(function (id) { return state.players[id].presence; }),
          OpCode.TIMER_TICK,
          { timeLeft: Math.ceil(state.turnTicksRemaining / TICK_RATE), userId: state.currentTurnUserId }
        );
      }
    }
  }

  return { state: state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return { state: state, data: data };
}

function rpcFindMatch(ctx, logger, nk, payload) {
  var mode = "classic";

  if (payload) {
    try {
      var data = JSON.parse(payload);
      if (data.mode === "timed") mode = "timed";
    } catch (_) {}
  }

  if (!ctx.userId) {
    throw new Error("Not authenticated");
  }

  // ✅ CORRECT FUNCTION
  var ticket = nk.matchmakerAdd(
    ctx,                        // user context
    2,                          // min players
    2,                          // max players
    "properties.mode:" + mode,  // query
    { mode: mode },             // string properties
    {}                          // numeric properties
  );

  logger.info("Ticket created: " + ticket);

  return JSON.stringify({ ticket: ticket });
}

function rpcCreateRoom(ctx, logger, nk, payload) {
  var mode = "classic";
  if (payload) {
    try {
      var data = JSON.parse(payload);
      if (data.mode === "timed") mode = "timed";
    } catch (_) {}
  }
  var matchId = nk.matchCreate("tictactoe", { mode: mode });
  return JSON.stringify({ matchId: matchId });
}

function rpcGetStats(ctx, logger, nk, payload) {
  var userId = ctx && (ctx.userId || ctx.user_id);
  if (!userId) throw new Error("Not authenticated");
  return JSON.stringify(readPlayerStatsRecord(nk, userId));
}

function rpcGetLeaderboard(ctx, logger, nk, payload) {
  var result = null;
  try {
    result = nk.leaderboardRecordsList("global_wins", [], 20, null, 0);
  } catch (firstError) {
    try {
      result = nk.leaderboardRecordsList("global_wins", [], 20, null);
    } catch (secondError) {
      logger.error("get_leaderboard failed: %v / %v", firstError, secondError);
      return JSON.stringify({ entries: [] });
    }
  }

  var records = [];
  if (result && result.records) {
    records = result.records;
  } else if (Array.isArray(result)) {
    records = result;
  }

  var userIds = records
    .map(function (r) { return r.ownerId || r.owner_id; })
    .filter(function (id) { return typeof id === "string" && id.length > 0; });

  var statsByUserId = {};
  var statsValidByUserId = {};
  for (var i = 0; i < userIds.length; i += 1) {
    var ownerId = userIds[i];
    var statsMeta = readPlayerStatsRecordMeta(nk, ownerId);
    statsByUserId[ownerId] = statsMeta.stats;
    statsValidByUserId[ownerId] = statsMeta.valid;
  }

  var entries = records.map(function (r) {
    var userId = r.ownerId || r.owner_id;
    var stats = statsByUserId[userId] || { wins: 0, losses: 0, draws: 0 };
    var leaderboardWins = Number(r.score || 0);
    var statsWins = Number(stats.wins || 0);
    if (leaderboardWins !== statsWins) {
      logger.warn(
        "Leaderboard/stat mismatch for user %v (leaderboard=%v, stats=%v)",
        userId,
        leaderboardWins,
        statsWins
      );
    }
    return {
      rank: r.rank,
      userId: userId,
      username: r.username || "Unknown",
      wins: statsValidByUserId[userId] ? statsWins : leaderboardWins,
      losses: stats.losses,
      draws: stats.draws,
    };
  });
  return JSON.stringify({ entries: entries });
}
function matchmakerMatched(ctx, logger, nk, entries) {
  var mode = "classic";

  if (entries && entries.length > 0) {
    var first = entries[0] || {};
    var props = first.properties || first.stringProperties || first.string_properties || {};
    if (props.mode === "timed") {
      mode = "timed";
    }
  }

  return nk.matchCreate("tictactoe", { mode: mode });
}
function InitModule(ctx, logger, nk, initializer) {
  try {
    nk.leaderboardCreate("global_wins", false, "desc", "increment", null);
  } catch (_) {}

  initializer.registerMatch("tictactoe", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
  });

  initializer.registerRpc("find_match", rpcFindMatch);
  initializer.registerRpc("create_room", rpcCreateRoom);
  initializer.registerRpc("get_stats", rpcGetStats);
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
  initializer.registerMatchmakerMatched(matchmakerMatched);
  logger.info("Tic-Tac-Toe JS module loaded");
}

// Keep InitModule visible to Nakama's JS runtime loader.
globalThis.InitModule = InitModule;
!InitModule && InitModule.bind(null);
