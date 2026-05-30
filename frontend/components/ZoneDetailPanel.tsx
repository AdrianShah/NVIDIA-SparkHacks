"use client";
import { X, Droplets, Building2, AlertTriangle, Phone, Flame } from "lucide-react";
import type { WardFeature } from "./MapView";

const RISK_COLOR: Record<string, string> = {
  CRITICAL: "text-red-400",
  HIGH:     "text-orange-400",
  ELEVATED: "text-yellow-400",
  LOW:      "text-green-400",
};

const RISK_BG: Record<string, string> = {
  CRITICAL: "bg-red-500/10 border-red-500/30",
  HIGH:     "bg-orange-500/10 border-orange-500/30",
  ELEVATED: "bg-yellow-500/10 border-yellow-500/30",
  LOW:      "bg-green-500/10 border-green-500/30",
};

interface Props {
  ward:    WardFeature;
  onClose: () => void;
}

export default function ZoneDetailPanel({ ward, onClose }: Props) {
  const riskColor = RISK_COLOR[ward.risk_level] ?? "text-orange-400";
  const riskBg    = RISK_BG[ward.risk_level] ?? RISK_BG.HIGH;

  const riskFactors: Array<{ icon: React.ReactNode; label: string; value: string; flagged: boolean }> = [
    {
      icon:    <Droplets className="w-3.5 h-3.5" />,
      label:   "Flood Study Area",
      value:   ward.in_flood_zone ? "YES — basement flooding risk" : "Not in flood zone",
      flagged: !!ward.in_flood_zone,
    },
    {
      icon:    <Phone className="w-3.5 h-3.5" />,
      label:   "311 Calls (500m radius)",
      value:   `${ward.prior_311 ?? 0} prior service requests`,
      flagged: (ward.prior_311 ?? 0) > 3,
    },
    {
      icon:    <Building2 className="w-3.5 h-3.5" />,
      label:   "Watermain Age",
      value:   ward.watermain_age ? `${ward.watermain_age} years` : "Unknown",
      flagged: (ward.watermain_age ?? 0) > 50,
    },
    {
      icon:    <AlertTriangle className="w-3.5 h-3.5" />,
      label:   "Active Construction",
      value:   "Check building permits",
      flagged: false,
    },
    {
      icon:    <Flame className="w-3.5 h-3.5" />,
      label:   "Risk Level",
      value:   ward.risk_level,
      flagged: ward.risk_level === "CRITICAL" || ward.risk_level === "HIGH",
    },
  ];

  return (
    <div
      className={`absolute top-3 left-3 w-72 rounded-xl border shadow-xl z-10 p-4 ${riskBg}`}
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Zone Detail
          </p>
          <h2 className="font-bold text-sm mt-0.5" style={{ color: "var(--text)" }}>
            {ward.name}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:opacity-70 transition-opacity"
          style={{ color: "var(--text-muted)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Risk score meter */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span style={{ color: "var(--text-muted)" }}>Risk Score</span>
          <span className={`font-bold font-mono ${riskColor}`}>{ward.score.toFixed(0)}/100</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${ward.score}%`,
              background: ward.risk_level === "CRITICAL" ? "#ef4444"
                        : ward.risk_level === "HIGH"     ? "#f97316"
                        : ward.risk_level === "ELEVATED" ? "#eab308"
                        : "#22c55e",
            }}
          />
        </div>
      </div>

      {/* Risk factors */}
      <div className="space-y-2">
        {riskFactors.map((f) => (
          <div key={f.label} className="flex items-start gap-2 text-xs">
            <span className={f.flagged ? riskColor : ""} style={f.flagged ? {} : { color: "var(--text-muted)" }}>
              {f.icon}
            </span>
            <div className="flex-1">
              <span style={{ color: "var(--text-muted)" }}>{f.label}: </span>
              <span className={f.flagged ? `font-semibold ${riskColor}` : ""} style={f.flagged ? {} : { color: "var(--text)" }}>
                {f.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 text-xs font-mono" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
        {ward.lat.toFixed(5)}, {ward.lng.toFixed(5)}
      </div>
    </div>
  );
}
