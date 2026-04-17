// src/hooks/useGame.ts
// Central hook that owns all match state and socket event wiring

import { useCallback, useRef, useState } from "react";
import {
  OpCode,
  closeSocket,
  getSession,
  getSocket,
  joinMatchById,
  openSocket,
  sendMove,
} from "./nakama-client";
import type { GameOverPayload, GameState } from "./nakama-client";

export interface UseGameReturn {
  gameState: GameState | null;
  gameOver: GameOverPayload | null;
  matchId: string | null;
  myUserId: string | null;
  opponentStatus: "connected" | "disconnected";
  timeLeft: number | null;
  enterMatch: (matchId: string) => Promise<boolean>;
  makeMove: (position: number) => Promise<void>;
  leaveMatch: () => void;
  setClientError: (message: string | null) => void;
  error: string | null;
}

const EMPTY_BOARD: GameState = {
  board: Array(9).fill(""),
  currentTurnUserId: null,
  status: "waiting",
  winner: null,
  timeLeft: null,
  players: [],
};

export function useGame(): UseGameReturn {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [opponentStatus, setOpponentStatus] = useState<"connected" | "disconnected">("connected");
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const gameStatusRef = useRef<GameState["status"]>("waiting");

  const myUserId = getSession()?.user_id ?? null;

  const wireSocketEvents = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.onmatchdata = (data) => {
      let payload: any;
      try {
        payload = JSON.parse(new TextDecoder().decode(data.data));
      } catch {
        setError("Received invalid match payload from server.");
        return;
      }

      const opCode = Number(data.op_code);
      switch (opCode) {
        case OpCode.GAME_STATE:
          setGameState(payload as GameState);
          gameStatusRef.current = (payload as GameState).status ?? "waiting";
          setTimeLeft(payload.timeLeft ?? null);
          break;
        case OpCode.GAME_OVER:
          setGameState(payload as GameState);
          setGameOver(payload as GameOverPayload);
          gameStatusRef.current = "finished";
          break;
        case OpCode.TIMER_TICK:
          setTimeLeft(payload.timeLeft);
          break;
        case OpCode.OPPONENT_STATUS:
          setOpponentStatus(payload.status === "disconnected" ? "disconnected" : "connected");
          break;
        case OpCode.ERROR:
          setError(payload.message ?? "Server error");
          break;
        default:
          // Ignore unknown opcodes so one bad frame does not break match flow.
          break;
      }
    };

    socket.ondisconnect = () => {
      closeSocket();
      const shouldWarn = gameStatusRef.current === "playing" || gameStatusRef.current === "waiting";
      if (shouldWarn) {
        setError("Disconnected from server. Please refresh.");
      }
    };
  }, []);

  const enterMatch = useCallback(async (id: string) => {
    setError(null);
    setGameState(null);
    setGameOver(null);
    setTimeLeft(null);
    gameStatusRef.current = "waiting";

    try {
      await openSocket();
      wireSocketEvents();
      const joinedMatch = await joinMatchById(id);
      matchIdRef.current = joinedMatch.match_id;
      setMatchId(joinedMatch.match_id);
      // Do not clobber a real GAME_STATE that may have already arrived.
      // In fast joins, Nakama can broadcast state before this line runs.
      setGameState((prev) => prev ?? EMPTY_BOARD);
      return true;
    } catch (e: any) {
      closeSocket();
      matchIdRef.current = null;
      setMatchId(null);
      setError(e?.message ?? "Failed to join match");
      return false;
    }
  }, [wireSocketEvents]);

  const makeMove = useCallback(async (position: number) => {
    if (!matchIdRef.current) return;
    setError(null);
    try {
      await sendMove(matchIdRef.current, position);
    } catch (e: any) {
      setError(e?.message ?? "Move failed");
    }
  }, []);

  const leaveMatch = useCallback(() => {
    closeSocket();
    matchIdRef.current = null;
    setMatchId(null);
    setGameState(null);
    setGameOver(null);
    setError(null);
    setOpponentStatus("connected");
    setTimeLeft(null);
    gameStatusRef.current = "waiting";
  }, []);

  const setClientError = useCallback((message: string | null) => {
    setError(message);
  }, []);

  return {
  gameState,
  gameOver,
  matchId,
  myUserId,
  opponentStatus,
  timeLeft,
  enterMatch,
  makeMove,
  leaveMatch,
  setClientError, // ✅ ADD THIS
  error,
};
}
