"use client";
import { motion, AnimatePresence } from "framer-motion";

interface Incident {
  id:         number;
  transcript: string;
  urgency:    string;
  timestamp:  string;
  escalated:  boolean;
  ward_risk:  number;
  gps:        { lat: number; lng: number };
}

const URGENCY_STYLE: Record<string, string> = {
  CRITICAL: "text-red-400 border-red-500/40",
  HIGH:     "text-orange-400 border-orange-500/40",
  LOW:      "text-green-400 border-green-500/40",
};

interface Props {
  incidents: Incident[];
}

export default function IncidentFeed({ incidents }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-3 border-b" style={{ borderColor: "var(--border)", maxHeight: "200px" }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        Live Incident Feed
      </p>
      {incidents.length === 0 && (
        <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>No incidents reported yet.</p>
      )}
      <AnimatePresence initial={false}>
        {[...incidents].reverse().map((inc) => (
          <motion.div
            key={inc.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className={`mb-2 p-2 rounded border text-xs font-mono ${URGENCY_STYLE[inc.urgency] ?? URGENCY_STYLE.HIGH}`}
            style={{ background: "var(--bg-card)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold">{inc.urgency}</span>
              {inc.escalated && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 font-bold">
                  PREDICTION CONFIRMED
                </span>
              )}
              <span style={{ color: "var(--text-muted)" }}>
                {new Date(inc.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="truncate" style={{ color: "var(--text)" }}>
              {inc.transcript.slice(0, 100)}{inc.transcript.length > 100 ? "…" : ""}
            </div>
            <div className="mt-1 flex gap-2" style={{ color: "var(--text-muted)" }}>
              <span>Risk: {inc.ward_risk != null ? Number(inc.ward_risk).toFixed(0) : "—"}/100</span>
              <span>·</span>
              <span>{Number(inc.gps.lat).toFixed(4)}, {Number(inc.gps.lng).toFixed(4)}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
