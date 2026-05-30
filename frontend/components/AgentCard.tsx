"use client";
import { motion, AnimatePresence } from "framer-motion";

export type NodeStatus = "idle" | "active" | "complete" | "error";

interface AgentCardProps {
  name: string;
  label: string;
  status: NodeStatus;
  detail?: string;
}

const ICONS: Record<string, string> = {
  orchestrator: "⚡",
  vision: "👁",
  localizer: "📍",
  compiler: "📋",
};

const BORDER: Record<NodeStatus, string> = {
  idle: "border-gray-800",
  active: "border-teal-500",
  complete: "border-green-500",
  error: "border-red-500",
};

const BG: Record<NodeStatus, string> = {
  idle: "bg-gray-950/60",
  active: "bg-teal-950/40",
  complete: "bg-green-950/30",
  error: "bg-red-950/30",
};

const DOT: Record<NodeStatus, string> = {
  idle: "bg-gray-700",
  active: "bg-teal-400 animate-pulse",
  complete: "bg-green-400",
  error: "bg-red-400",
};

export default function AgentCard({ name, label, status, detail }: AgentCardProps) {
  return (
    <div className={`relative rounded-lg border p-3 transition-colors duration-300 ${BORDER[status]} ${BG[status]}`}>
      {/* Pulsing ring — active state */}
      <AnimatePresence>
        {status === "active" && (
          <motion.div
            key="ring"
            className="absolute inset-0 rounded-lg border-2 border-teal-400 pointer-events-none"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.06, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </AnimatePresence>

      <div className="flex items-start gap-2">
        <span className="text-base leading-none mt-0.5">{ICONS[name] ?? "◈"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono font-semibold text-gray-200 tracking-wide">
            {label.toUpperCase()}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[status]}`} />
            <span className="text-xs text-gray-500 capitalize">{status}</span>
          </div>
          {detail && status === "complete" && (
            <p className="text-xs text-gray-400 mt-1 truncate">{detail}</p>
          )}
        </div>

        {/* Complete check */}
        <AnimatePresence>
          {status === "complete" && (
            <motion.span
              key="check"
              className="text-green-400 text-sm flex-shrink-0"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              ✓
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
