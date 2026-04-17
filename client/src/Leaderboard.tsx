// src/pages/Leaderboard.tsx
import { useEffect, useState } from "react";
import { motion } from "./vendor/framer-motion";
import { getLeaderboard, getMyStats } from "./nakama-client";

interface LeaderboardProps {
  onBack: () => void;
  myUserId: string;
}

interface Entry {
  rank: number;
  userId: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
}

interface MyStats {
  wins: number;
  losses: number;
  draws: number;
}

export function Leaderboard({ onBack, myUserId }: LeaderboardProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [myStats, setMyStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async (initial = false) => {
      if (initial) setLoading(true);

      try {
        const [lb, stats] = await Promise.all([getLeaderboard(), getMyStats()]);
        if (!mounted) return;
        const myEntry = lb.find((entry) => entry.userId === myUserId);
        const normalizedStats = (
          stats.wins === 0 &&
          stats.losses === 0 &&
          stats.draws === 0 &&
          myEntry &&
          (myEntry.wins > 0 || myEntry.losses > 0 || myEntry.draws > 0)
        )
          ? {
            ...stats,
            wins: myEntry.wins,
            losses: myEntry.losses,
            draws: myEntry.draws,
          }
          : stats;
        setEntries(lb);
        setMyStats(normalizedStats);
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? "Failed to load leaderboard.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load(true);
    const intervalId = window.setInterval(() => {
      void load(false);
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } },
  };
  const row = {
    hidden: { opacity: 0, x: -16 },
    show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 280, damping: 22 } },
  };

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="leaderboard-page">
      <div className="lb-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h2 className="lb-title">Global Rankings</h2>
      </div>

      {myStats && (
        <div className="my-stats-card">
          <div className="stat-item">
            <span className="stat-val">{myStats.wins}</span>
            <span className="stat-label">Wins</span>
          </div>
          <div className="stat-item">
            <span className="stat-val">{myStats.losses}</span>
            <span className="stat-label">Losses</span>
          </div>
          <div className="stat-item">
            <span className="stat-val">{myStats.draws}</span>
            <span className="stat-label">Draws</span>
          </div>
          <div className="stat-item">
            <span className="stat-val">
              {myStats.wins + myStats.losses + myStats.draws > 0
                ? Math.round((myStats.wins / (myStats.wins + myStats.losses + myStats.draws)) * 100)
                : 0}%
            </span>
            <span className="stat-label">Win rate</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="lb-loading">Loading…</div>
      ) : error ? (
        <div className="lb-empty">{error}</div>
      ) : entries.length === 0 ? (
        <p className="lb-empty">No records yet. Play a game to get ranked!</p>
      ) : (
        <motion.ul
          className="lb-list"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {entries.map(entry => (
            <motion.li
              key={entry.userId}
              variants={row}
              className={`lb-row ${entry.userId === myUserId ? "lb-row--me" : ""}`}
            >
              <span className="lb-rank">
                {entry.rank <= 3 ? medals[entry.rank - 1] : `#${entry.rank}`}
              </span>
              <span className="lb-username">{entry.username}</span>
              <span className="lb-wins">{entry.wins}W · {entry.losses}L · {entry.draws}D</span>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
