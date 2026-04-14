// src/App.tsx
import { useEffect, useState, useRef } from "react";
import type { Session } from "./vendor/nakama-js";
import { authenticateDevice, getSession } from "./nakama-client";
import { useGame } from "./useGame";
import { Lobby } from "./Lobby";
import { Game } from "./Game";
import { Leaderboard } from "./Leaderboard";

type AppView = "lobby" | "game" | "leaderboard";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<AppView>("lobby");
  const [authError, setAuthError] = useState<string | null>(null);

  // 🔥 Prevent double auth (React Strict Mode)
  const hasAuthenticated = useRef(false);

  const {
    gameState,
    gameOver,
    matchId,
    myUserId,
    opponentStatus,
    timeLeft,
    enterMatch,
    makeMove,
    leaveMatch,
    setClientError,
    error: gameError,
  } = useGame();

  // ✅ Authentication (safe + clean)
  useEffect(() => {
    if (hasAuthenticated.current) return;
    hasAuthenticated.current = true;

    const run = async () => {
      try {
        const existingSession = getSession();

        if (
          existingSession &&
          !existingSession.isexpired(Math.floor(Date.now() / 1000))
        ) {
          setSession(existingSession);
          return;
        }

        const s = await authenticateDevice();
        setSession(s);
      } catch (e: any) {
        setAuthError(e?.message ?? "Auth failed");
      }
    };

    run();
  }, []);

  // ---------------- MATCH HANDLERS ----------------

  async function handleEnterMatch(matchId: string) {
    const joined = await enterMatch(matchId);
    if (joined) {
      setView("game");
    }
  }

  function handleLeave() {
    leaveMatch();
    setView("lobby");
  }

  // ---------------- UI STATES ----------------

  if (authError) {
    return (
      <div className="auth-error">
        <p>Could not connect to server.</p>
        <p className="error-detail">{authError}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="loading-screen">
        <div className="spinner-large" />
        <p>Connecting…</p>
      </div>
    );
  }

  // ---------------- MAIN UI ----------------

  return (
    <div className="app">
      {view === "lobby" && (
        <Lobby
          onEnterMatch={handleEnterMatch}
          onViewLeaderboard={() => setView("leaderboard")}
          myUsername={session.username ?? "Player"}
        />
      )}

      {view === "game" && gameState && matchId && myUserId && (
        <Game
          gameState={gameState}
          gameOver={gameOver}
          myUserId={myUserId}
          opponentStatus={opponentStatus}
          timeLeft={timeLeft}
          onMove={makeMove}
          onLeave={handleLeave}
          onClientError={setClientError}
          error={gameError}
          matchId={matchId}
        />
      )}

      {view === "leaderboard" && (
        <Leaderboard
          onBack={() => setView("lobby")}
          myUserId={myUserId ?? ""}
        />
      )}
    </div>
  );
}