"use strict";
// match_handler.ts
// Server-authoritative Tic-Tac-Toe match handler for Nakama runtime
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchSignal = exports.matchTerminate = exports.matchLoop = exports.matchLeave = exports.matchJoin = exports.matchJoinAttempt = exports.matchInit = void 0;
const TICK_RATE = 5; // 5 ticks per second
const TURN_TIMEOUT_TICKS = 150; // 30 seconds at 5 tps
const DISCONNECT_GRACE_TICKS = 75; // 15 seconds grace period
const MAX_PLAYERS = 2;
// Winning combinations (indices into the 9-cell board)
const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6], // diagonals
];
// Op-codes for client <-> server messages
const OpCode = {
    GAME_STATE: 1,
    MAKE_MOVE: 2,
    PLAYER_READY: 3,
    GAME_OVER: 4,
    TIMER_TICK: 5,
    ERROR: 6,
    OPPONENT_STATUS: 7,
};
// ── Helpers ─────────────────────────────────────────────────────────────────
function emptyBoard() {
    return Array(9).fill(null);
}
function checkWinner(board) {
    for (const [a, b, c] of WIN_LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return board.every(cell => cell !== null) ? "draw" : null;
}
function boardToPublic(board) {
    return board.map(c => c !== null && c !== void 0 ? c : "");
}
function parseStatsRecord(raw) {
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
function readStatsRecord(nk, userId) {
    const queryBase = {
        collection: "player_stats",
        key: "record",
    };
    let records = [];
    try {
        records = nk.storageRead([{ ...queryBase, userId }]);
    }
    catch { }
    if (!records || records.length === 0) {
        try {
            records = nk.storageRead([{ ...queryBase, user_id: userId }]);
        }
        catch { }
    }
    if (!records || records.length === 0) {
        return { wins: 0, losses: 0, draws: 0 };
    }
    return parseStatsRecord(records[0].value);
}
function writeStatsRecord(nk, userId, record) {
    const writeBaseSnake = {
        collection: "player_stats",
        key: "record",
        value: JSON.stringify(record),
        permission_read: 2,
        permission_write: 0,
    };
    const writeBaseCamel = {
        collection: "player_stats",
        key: "record",
        value: JSON.stringify(record),
        permissionRead: 2,
        permissionWrite: 0,
    };
    const writeBaseSnake = {
        collection: "player_stats",
        key: "record",
        value: JSON.stringify(record),
        permission_read: 2,
        permission_write: 0,
    };
    try {
        nk.storageWrite([{ ...writeBaseSnake, user_id: userId }]);
        return;
    }
    catch { }
    nk.storageWrite([{ ...writeBaseCamel, userId }]);
}
function buildGameStatePayload(state, presenceUserId) {
    const playerList = Object.values(state.players).map(p => ({
        userId: p.userId,
        username: p.username,
        mark: p.mark,
    }));
    return {
        board: boardToPublic(state.board),
        currentTurnUserId: state.currentTurnUserId,
        status: state.status,
        winner: state.winner,
        timeLeft: state.timedMode ? Math.ceil(state.turnTicksRemaining / TICK_RATE) : null,
        players: playerList,
    };
}
function sendToAll(dispatcher, presences, opcode, payload) {
    dispatcher.broadcastMessage(opcode, JSON.stringify(payload), presences, null, true);
}
function sendToOne(dispatcher, presence, opcode, payload) {
    dispatcher.broadcastMessage(opcode, JSON.stringify(payload), [presence], null, true);
}
function resolveWinner(state, winMark, nk, logger) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    state.status = "finished";
    if (winMark === "draw") {
        state.winner = "draw";
    }
    else {
        // Find the userId that owns this mark
        const winnerInfo = Object.values(state.players).find(p => p.mark === winMark);
        state.winner = (_a = winnerInfo === null || winnerInfo === void 0 ? void 0 : winnerInfo.userId) !== null && _a !== void 0 ? _a : null;
    }
    // Persist leaderboard scores
    if (state.winner && state.winner !== "draw") {
        const loserId = state.playerOrder.find(id => id !== state.winner);
        try {
            nk.leaderboardRecordWrite("global_wins", state.winner, (_c = (_b = Object.values(state.players).find(p => p.userId === state.winner)) === null || _b === void 0 ? void 0 : _b.username) !== null && _c !== void 0 ? _c : "Unknown", 1, 0, {});
        }
        catch (e) {
            logger.error("Failed to write leaderboard win record: %v", e);
        }
        try {
            const winnerRecord = readStatsRecord(nk, state.winner);
            winnerRecord.wins = Number((_d = winnerRecord.wins) !== null && _d !== void 0 ? _d : 0);
            winnerRecord.losses = Number((_e = winnerRecord.losses) !== null && _e !== void 0 ? _e : 0);
            winnerRecord.draws = Number((_f = winnerRecord.draws) !== null && _f !== void 0 ? _f : 0);
            winnerRecord.wins += 1;
            writeStatsRecord(nk, state.winner, winnerRecord);
        }
        catch (e) {
            logger.error("Failed to write winner stats: %v", e);
        }
        if (loserId) {
            try {
                const record = readStatsRecord(nk, loserId);
                record.wins = Number((_g = record.wins) !== null && _g !== void 0 ? _g : 0);
                record.losses = Number((_h = record.losses) !== null && _h !== void 0 ? _h : 0);
                record.draws = Number((_j = record.draws) !== null && _j !== void 0 ? _j : 0);
                record.losses += 1;
                writeStatsRecord(nk, loserId, record);
            }
            catch (e) {
                logger.error("Failed to write loser stats: %v", e);
            }
        }
    }
    else if (state.winner === "draw") {
        // Record draws for both
        for (const userId of state.playerOrder) {
            try {
                let record = readStatsRecord(nk, userId);
                record.wins = Number((_k = record.wins) !== null && _k !== void 0 ? _k : 0);
                record.losses = Number((_l = record.losses) !== null && _l !== void 0 ? _l : 0);
                record.draws = Number((_m = record.draws) !== null && _m !== void 0 ? _m : 0);
                record.draws += 1;
                writeStatsRecord(nk, userId, record);
            }
            catch (e) {
                logger.error("Failed to write draw record: %v", e);
            }
        }
    }
}
// ── Match lifecycle ──────────────────────────────────────────────────────────
const matchInit = (ctx, logger, nk, params) => {
    const timedMode = (params === null || params === void 0 ? void 0 : params["mode"]) === "timed";
    logger.info("Match init: timedMode=%v", timedMode);
    const state = {
        board: emptyBoard(),
        players: {},
        playerOrder: [],
        currentTurnUserId: null,
        turnTicksRemaining: TURN_TIMEOUT_TICKS,
        status: "waiting",
        winner: null,
        disconnected: {},
        timedMode,
    };
    return { state, tickRate: TICK_RATE, label: JSON.stringify({ mode: timedMode ? "timed" : "classic" }) };
};
exports.matchInit = matchInit;
const matchJoinAttempt = (ctx, logger, nk, dispatcher, tick, state, presence, metadata) => {
    if (state.status === "finished") {
        return { state, accept: false, rejectMessage: "Match is already over" };
    }
    if (Object.keys(state.players).length >= MAX_PLAYERS && !state.players[presence.userId]) {
        return { state, accept: false, rejectMessage: "Match is full" };
    }
    return { state, accept: true };
};
exports.matchJoinAttempt = matchJoinAttempt;
const matchJoin = (ctx, logger, nk, dispatcher, tick, state, presences) => {
    for (const presence of presences) {
        // Remove from disconnected tracking if rejoining
        delete state.disconnected[presence.userId];
        if (!state.players[presence.userId]) {
            // Assign mark based on join order
            const mark = state.playerOrder.length === 0 ? "X" : "O";
            state.players[presence.userId] = {
                userId: presence.userId,
                username: presence.username,
                mark,
                presence,
            };
            state.playerOrder.push(presence.userId);
            logger.info("Player %v joined as %v", presence.username, mark);
        }
        else {
            // Update presence reference on reconnect
            state.players[presence.userId].presence = presence;
            // Notify others
            const others = Object.values(state.players)
                .filter(p => p.userId !== presence.userId)
                .map(p => p.presence);
            if (others.length > 0) {
                sendToAll(dispatcher, others, OpCode.OPPONENT_STATUS, { status: "reconnected", userId: presence.userId });
            }
        }
        // Start game when both players are in
        if (state.playerOrder.length === MAX_PLAYERS && state.status === "waiting") {
            state.status = "playing";
            state.currentTurnUserId = state.playerOrder[0]; // X goes first
            state.turnTicksRemaining = TURN_TIMEOUT_TICKS;
            logger.info("Game started between %v and %v", state.playerOrder[0], state.playerOrder[1]);
        }
    }
    // Send current game state to all presences
    const allPresences = Object.values(state.players).map(p => p.presence);
    sendToAll(dispatcher, allPresences, OpCode.GAME_STATE, buildGameStatePayload(state));
    return { state };
};
exports.matchJoin = matchJoin;
const matchLeave = (ctx, logger, nk, dispatcher, tick, state, presences) => {
    for (const presence of presences) {
        logger.info("Player %v disconnected", presence.username);
        if (state.status === "playing") {
            state.disconnected[presence.userId] = 0;
            // Notify remaining players
            const remaining = Object.values(state.players)
                .filter(p => p.userId !== presence.userId)
                .map(p => p.presence);
            if (remaining.length > 0) {
                sendToAll(dispatcher, remaining, OpCode.OPPONENT_STATUS, {
                    status: "disconnected",
                    userId: presence.userId,
                });
            }
        }
        else if (state.status === "waiting") {
            // Player left before game started — remove them
            delete state.players[presence.userId];
            state.playerOrder = state.playerOrder.filter(id => id !== presence.userId);
        }
    }
    return { state };
};
exports.matchLeave = matchLeave;
const matchLoop = (ctx, logger, nk, dispatcher, tick, state, messages) => {
    var _a, _b;
    // Handle incoming messages
    for (const msg of messages) {
        const player = state.players[msg.sender.userId];
        if (!player)
            continue;
        if (msg.opCode === OpCode.MAKE_MOVE) {
            let data;
            try {
                data = JSON.parse(nk.binaryToString(msg.data));
            }
            catch {
                sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Invalid message format" });
                continue;
            }
            // Validate it's this player's turn
            if (state.status !== "playing") {
                sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Game is not in progress" });
                continue;
            }
            if (state.currentTurnUserId !== player.userId) {
                sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Not your turn" });
                continue;
            }
            const pos = data.position;
            if (pos < 0 || pos > 8 || state.board[pos] !== null) {
                sendToOne(dispatcher, player.presence, OpCode.ERROR, { message: "Invalid move" });
                continue;
            }
            // Apply the move
            state.board[pos] = player.mark;
            logger.info("Player %v played %v at %d", player.username, player.mark, pos);
            // Check win/draw
            const result = checkWinner(state.board);
            if (result) {
                resolveWinner(state, result, nk, logger);
                const allPresences = Object.values(state.players).map(p => p.presence);
                sendToAll(dispatcher, allPresences, OpCode.GAME_OVER, buildGameStatePayload(state));
                return { state }; // keep match alive briefly so clients can read result
            }
            // Advance turn
            const nextIdx = (state.playerOrder.indexOf(state.currentTurnUserId) + 1) % MAX_PLAYERS;
            state.currentTurnUserId = state.playerOrder[nextIdx];
            state.turnTicksRemaining = TURN_TIMEOUT_TICKS;
            // Broadcast updated state
            const allPresences = Object.values(state.players).map(p => p.presence);
            sendToAll(dispatcher, allPresences, OpCode.GAME_STATE, buildGameStatePayload(state));
        }
    }
    // Handle disconnect grace period
    for (const [userId, ticks] of Object.entries(state.disconnected)) {
        const newTicks = ticks + 1;
        if (newTicks >= DISCONNECT_GRACE_TICKS && state.status === "playing") {
            // Forfeit the disconnected player
            const mark = (_a = state.players[userId]) === null || _a === void 0 ? void 0 : _a.mark;
            const opponentMark = mark === "X" ? "O" : "X";
            resolveWinner(state, opponentMark, nk, logger);
            const remaining = Object.values(state.players)
                .filter(p => p.userId !== userId)
                .map(p => p.presence);
            if (remaining.length > 0) {
                sendToAll(dispatcher, remaining, OpCode.GAME_OVER, {
                    ...buildGameStatePayload(state),
                    forfeit: true,
                    forfeitUserId: userId,
                });
            }
            delete state.disconnected[userId];
            return { state };
        }
        state.disconnected[userId] = newTicks;
    }
    // Timer enforcement (timed mode or always)
    if (state.status === "playing" && state.currentTurnUserId) {
        state.turnTicksRemaining -= 1;
        // Broadcast timer tick every second (every TICK_RATE ticks)
        if (state.timedMode && tick % TICK_RATE === 0) {
            const allPresences = Object.values(state.players).map(p => p.presence);
            sendToAll(dispatcher, allPresences, OpCode.TIMER_TICK, {
                timeLeft: Math.ceil(state.turnTicksRemaining / TICK_RATE),
                userId: state.currentTurnUserId,
            });
        }
        if (state.turnTicksRemaining <= 0) {
            // Timeout — forfeit the current player
            const timedOutMark = (_b = state.players[state.currentTurnUserId]) === null || _b === void 0 ? void 0 : _b.mark;
            const winnerMark = timedOutMark === "X" ? "O" : "X";
            resolveWinner(state, winnerMark, nk, logger);
            const allPresences = Object.values(state.players).map(p => p.presence);
            sendToAll(dispatcher, allPresences, OpCode.GAME_OVER, {
                ...buildGameStatePayload(state),
                timeout: true,
                timedOutUserId: state.currentTurnUserId,
            });
        }
    }
    return { state };
};
exports.matchLoop = matchLoop;
const matchTerminate = (ctx, logger, nk, dispatcher, tick, state, graceSeconds) => {
    logger.info("Match terminating with %d grace seconds", graceSeconds);
    return { state };
};
exports.matchTerminate = matchTerminate;
const matchSignal = (ctx, logger, nk, dispatcher, tick, state) => {
    return { state, data: "" };
};
exports.matchSignal = matchSignal;
