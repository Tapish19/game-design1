// src/pages/Lobby.tsx
import { useState } from "react";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import { createRoom, findMatch, getSocket, openSocket } from "./nakama-client";

interface LobbyProps {
  onEnterMatch: (matchId: string) => Promise<void>;
  onViewLeaderboard: () => void;
  myUsername: string;
}

type GameMode = "classic" | "timed";

export function Lobby({ onEnterMatch, onViewLeaderboard, myUsername }: LobbyProps) {
  const [mode, setMode] = useState<GameMode>("classic");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 🔥 QUICK MATCH
  async function handleQuickMatch() {
    setError(null);
    setLoading("Searching for opponent…");

    try {
      await openSocket();
      const socket = getSocket()!;

      socket.onmatchmakermatched = async (matched) => {
        const id = matched.match_id ?? matched.token;

        // ✅ FIX: ensure id exists
        if (!id) {
          setError("Failed to get match ID");
          setLoading(null);
          return;
        }

        setLoading(null);
        await onEnterMatch(id);
      };

      await findMatch(mode);
    } catch (e: any) {
      setError(e?.message ?? "Matchmaking failed");
      setLoading(null);
    }
  }

  // 🔥 CREATE ROOM
  async function handleCreateRoom() {
    setError(null);
    setLoading("Creating room…");

    try {
      const matchId = await createRoom(mode);

      // safety (just in case backend messes up)
      if (!matchId) {
        throw new Error("Invalid match ID");
      }

      setLoading(null);
      await onEnterMatch(matchId);
    } catch (e: any) {
      setError(e?.message ?? "Could not create room");
      setLoading(null);
    }
  }

  // 🔥 JOIN ROOM
  async function handleJoinRoom() {
    const trimmed = roomCode.trim();

    if (!trimmed) return;

    setError(null);
    setLoading("Joining room…");

    try {
      await onEnterMatch(trimmed);
      setLoading(null);
    } catch (e: any) {
      setError(e?.message ?? "Could not join room");
      setLoading(null);
    }
  }

  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07 } },
  };

  const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  },
};

  return (
    <div className="lobby">
      <motion.div variants={stagger} initial="hidden" animate="show" className="lobby-inner">

        {/* LOGO */}
        <motion.div variants={item} className="logo-area">
          <div className="logo-grid">
            <span>×</span><span>○</span><span>×</span>
            <span>○</span><span>×</span><span>○</span>
            <span>○</span><span>×</span><span>○</span>
          </div>
          <h1 className="logo-title">Tic-Tac-Toe</h1>
          <p className="logo-sub">Hello, <strong>{myUsername}</strong></p>
        </motion.div>

        {/* MODE SELECTOR */}
        <motion.div variants={item} className="mode-selector">
          <button
            className={`mode-btn ${mode === "classic" ? "active" : ""}`}
            onClick={() => setMode("classic")}
          >
            Classic
          </button>

          <button
            className={`mode-btn ${mode === "timed" ? "active" : ""}`}
            onClick={() => setMode("timed")}
          >
            Timed <span className="mode-tag">30s</span>
          </button>
        </motion.div>

        {/* QUICK MATCH */}
        <motion.div variants={item}>
          <button
            className="primary-btn full"
            onClick={handleQuickMatch}
            disabled={!!loading}
          >
            {loading === "Searching for opponent…" ? (
              <span className="spinner-text">
                <span className="spinner" /> Searching…
              </span>
            ) : "Quick Match"}
          </button>
        </motion.div>

        {/* DIVIDER */}
        <motion.div variants={item} className="divider-row">
          <span className="divider-line" />
          <span className="divider-label">or</span>
          <span className="divider-line" />
        </motion.div>

        {/* PRIVATE ROOM */}
        <motion.div variants={item} className="room-section">

          <button
            className="secondary-btn full"
            onClick={handleCreateRoom}
            disabled={!!loading}
          >
            Create Private Room
          </button>

          <div className="join-row">
            <input
              className="room-input"
              placeholder="Paste room code…"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
            />

            <button
              className="join-btn"
              onClick={handleJoinRoom}
              disabled={!roomCode.trim() || !!loading}
            >
              Join
            </button>
          </div>
        </motion.div>

        {/* LEADERBOARD */}
        <motion.div variants={item}>
          <button className="ghost-btn full" onClick={onViewLeaderboard}>
            View Leaderboard
          </button>
        </motion.div>

        {/* ERROR */}
        {error && (
          <motion.p
            className="error-msg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {error}
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}