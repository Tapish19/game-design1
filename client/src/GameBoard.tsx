// src/components/GameBoard.tsx
import { motion, AnimatePresence } from "./vendor/framer-motion";
import type { GameState } from "./nakama-client";

interface GameBoardProps {
  gameState: GameState;
  myUserId: string;
  onMove: (position: number) => void;
  onBlockedMove: (message: string) => void;
  disabled: boolean;
  timeLeft: number | null;
  opponentStatus: "connected" | "disconnected";
}

const MARKS: Record<string, string> = { X: "×", O: "○" };

export function GameBoard({
  gameState,
  myUserId,
  onMove,
  onBlockedMove,
  disabled,
  timeLeft,
  opponentStatus,
}: GameBoardProps) {
  const me = gameState.players.find(p => p.userId === myUserId);
  const opponent = gameState.players.find(p => p.userId !== myUserId);
  const isMyTurn = gameState.currentTurnUserId === myUserId;
  const isTimedMode = gameState.timeLeft !== null;

  function cellClickable(idx: number) {
    return (
      !disabled &&
      isMyTurn &&
      gameState.status === "playing" &&
      gameState.board[idx] === ""
    );
  }
  function blockedReason(idx: number): string | null {
    if (disabled) return null;
    if (gameState.board[idx] !== "") return "That cell is already taken.";
    if (gameState.status === "waiting") return "Waiting for opponent to join.";
    if (gameState.status === "finished") return "Game is over. Return to lobby for a new match.";
    if (!isMyTurn) return "Wait for your turn.";
    return null;
  }
  
  return (
    <div className="board-wrapper">
      {/* Players header */}
      <div className="players-row">
        <PlayerBadge
          label={me?.username ?? "You"}
          mark={me?.mark ?? "X"}
          active={isMyTurn}
          side="left"
        />
        <div className="vs-divider">
          {isTimedMode && timeLeft !== null && gameState.status === "playing" ? (
            <TimerBadge timeLeft={timeLeft} isMyTurn={isMyTurn} />
          ) : (
            <span className="vs-text">VS</span>
          )}
        </div>
        <PlayerBadge
          label={opponent?.username ?? "Waiting…"}
          mark={opponent?.mark ?? "O"}
          active={!isMyTurn && gameState.status === "playing"}
          side="right"
          disconnected={opponentStatus === "disconnected"}
        />
      </div>

      {/* Status bar */}
      <AnimatePresence mode="wait">
        <motion.div
          key={gameState.currentTurnUserId ?? gameState.status}
          className="status-bar"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {statusText(gameState, myUserId, opponentStatus)}
        </motion.div>
      </AnimatePresence>

      {/* Grid */}
      <div className="grid">
        {gameState.board.map((cell, idx) => {
          const clickable = cellClickable(idx);
          return (
            <motion.button
              key={idx}
              className={`cell ${cell ? "filled" : ""} ${clickable ? "clickable" : ""} mark-${cell || "empty"}`}
              onClick={() => {
                if (clickable) {
                  onMove(idx);
                  return;
                }
                const reason = blockedReason(idx);
                if (reason) onBlockedMove(reason);
              }}
              disabled={disabled || !!cell}
              whileTap={clickable ? { scale: 0.93 } : {}}
            >
              <AnimatePresence>
                {cell && (
                  <motion.span
                    className={`mark mark-${cell}`}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 480, damping: 22 }}
                  >
                    {MARKS[cell] ?? cell}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerBadge({
  label,
  mark,
  active,
  side,
  disconnected = false,
}: {
  label: string;
  mark: "X" | "O";
  active: boolean;
  side: "left" | "right";
  disconnected?: boolean;
}) {
  return (
    <div className={`player-badge ${active ? "active" : ""} ${disconnected ? "disconnected" : ""} side-${side}`}>
      <span className={`badge-mark mark-${mark}`}>{MARKS[mark]}</span>
      <span className="badge-name">{label}</span>
      {disconnected && <span className="disconnected-pill">away</span>}
    </div>
  );
}

function TimerBadge({ timeLeft, isMyTurn }: { timeLeft: number; isMyTurn: boolean }) {
  const urgent = timeLeft <= 10;
  return (
    <motion.div
      className={`timer-badge ${urgent ? "urgent" : ""} ${isMyTurn ? "my-turn" : ""}`}
      animate={urgent && isMyTurn ? { scale: [1, 1.1, 1] } : {}}
      transition={{ repeat: Infinity, duration: 0.6 }}
    >
      {timeLeft}s
    </motion.div>
  );
}

function statusText(
  state: GameState,
  myUserId: string,
  opponentStatus: "connected" | "disconnected"
): string {
  if (state.status === "waiting") {
    return opponentStatus === "disconnected"
      ? "Opponent disconnected — waiting for reconnect…"
      : "Waiting for opponent…";
  }
  if (state.status === "finished") {
    if (!state.winner) return "Game over";
    if (state.winner === "draw") return "It's a draw!";
    return state.winner === myUserId ? "You win! 🎉" : "You lose.";
  }
  if (state.currentTurnUserId === myUserId) return "Your turn";
  return "Opponent's turn…";
}
