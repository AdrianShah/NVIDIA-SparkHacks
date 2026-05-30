"use client";
import type { WardFeature } from "./MapView";

const RISK_BG: Record<string, string> = {
  CRITICAL: "bg-red-500/10 border-red-500/30 text-red-400",
  HIGH:     "bg-orange-500/10 border-orange-500/30 text-orange-400",
  ELEVATED: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  LOW:      "bg-green-500/10 border-green-500/30 text-green-400",
};

const RISK_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH:     "bg-orange-500",
  ELEVATED: "bg-yellow-500",
  LOW:      "bg-green-500",
};

interface Props {
  wardScores:  WardFeature[];
  onWardClick: (ward: WardFeature) => void;
}

export default function WardBriefingPanel({ wardScores, onWardClick }: Props) {
  const top = wardScores.slice(0, 6);

  return (
    <div className="p-3 border-b" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        Ward Risk Briefing
      </p>
      {top.length === 0 && (
        <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>Loading ward scores…</p>
      )}
      <div className="space-y-1">
        {top.map((w) => (
          <button
            key={w.id}
            onClick={() => onWardClick(w)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded border text-left text-xs hover:opacity-80 transition-opacity ${RISK_BG[w.risk_level]}`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RISK_DOT[w.risk_level]}`} />
            <span className="flex-1 font-mono truncate">{w.name}</span>
            <span className="font-bold font-mono">{w.score.toFixed(0)}</span>
            <span className="opacity-60 font-mono">/100</span>
          </button>
        ))}
      </div>
    </div>
  );
}
