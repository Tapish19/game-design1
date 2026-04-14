// src/pages/Game.tsx
import { motion, AnimatePresence } from "./vendor/framer-motion";
import { GameBoard } from "./GameBoard";
import type { GameOverPayload, GameState } from "./nakama-client";

interface GamePageProps {
  gameState: GameState;
  gameOver: GameOverPayload | null;
  myUserId: string;
  opponentStatus: "connected" | "disconnected";
  timeLeft: number | null;
  onMove: (position: number) => void;
  onLeave: () => void;
  onClientError: (message: string | null) => void;
  error: string | null;
  matchId: string;
}

export function Game({
  gameState,
  gameOver,
  myUserId,
  opponentStatus,
  timeLeft,
  onMove,
  onLeave,
  onClientError,
  error,
  matchId,
}: GamePageProps) {
  const isOver = gameState.status === "finished";

  function copyRoomCode() {
    navigator.clipboard.writeText(matchId).catch(() => {});
  }

  return (
    <div className="game-page">
      {/* Room code bar */}
      <div className="room-bar">
        <button className="back-btn" onClick={onLeave}>← Leave</button>
        <button className="room-code-btn" onClick={copyRoomCode} title="Copy room code">
          {matchId.slice(0, 8)}… 📋
        </button>
      </div>

      {error && (
        <motion.div
          className="error-toast"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          {error}
        </motion.div>
      )}

      <GameBoard
        gameState={gameState}
        myUserId={myUserId}
        onMove={onMove}
        onBlockedMove={onClientError}
        disabled={isOver || opponentStatus === "disconnected"}
        timeLeft={timeLeft}
        opponentStatus={opponentStatus}
      />

      {/* Post-game overlay */}
      <AnimatePresence>
        {gameOver && (
          <motion.div
            className="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="result-card"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 350, damping: 26 }}
            >
              <div className="result-emoji">{resultEmoji(gameOver, myUserId)}</div>
              <h2 className="result-title">{resultTitle(gameOver, myUserId)}</h2>
              <p className="result-sub">{resultSub(gameOver, myUserId)}</p>
              <button className="primary-btn" onClick={onLeave}>Back to Lobby</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function resultEmoji(g: GameOverPayload, myId: string): string {
  if (g.winner === "draw") return "🤝";
  if (g.winner === myId) return "🏆";
  if (g.forfeit && g.forfeitUserId !== myId) return "🏆";
  if (g.timeout && g.timedOutUserId !== myId) return "⏱️";
  return "😞";
}

function resultTitle(g: GameOverPayload, myId: string): string {
  if (g.winner === "draw") return "Draw!";
  if (g.winner === myId) return "You Win!";
  if (g.forfeit && g.forfeitUserId !== myId) return "You Win!";
  if (g.timeout && g.timedOutUserId === myId) return "Time's Up!";
  if (g.timeout && g.timedOutUserId !== myId) return "Opponent Timed Out";
  return "You Lose";
}

function resultSub(g: GameOverPayload, myId: string): string {
  if (g.winner === "draw") return "Nobody took the crown this time.";
  if (g.forfeit && g.forfeitUserId !== myId) return "Opponent disconnected — you take the win.";
  if (g.forfeit && g.forfeitUserId === myId) return "You disconnected for too long.";
  if (g.timeout && g.timedOutUserId === myId) return "You ran out of time.";
  if (g.timeout) return "Your opponent ran out of time.";
  if (g.winner === myId) return "Well played!";
  return "Better luck next time.";
}
