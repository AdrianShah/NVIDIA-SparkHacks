"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Sun, Moon, AlertTriangle, CheckCheck, ChevronUp, ChevronDown, MapPin } from "lucide-react";
import WardBriefingPanel from "@/components/WardBriefingPanel";
import IncidentFeed      from "@/components/IncidentFeed";
import ReportModal       from "@/components/ReportModal";
import ZoneDetailPanel   from "@/components/ZoneDetailPanel";
import type { WardFeature, IncidentMarker, BuildingFeature } from "@/components/MapView";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr:     false,
  loading: () => <div style={{ width: "100%", height: "100%", background: "var(--bg-card)" }} />,
});

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const WS  = process.env.NEXT_PUBLIC_WS_URL  ?? "ws://localhost:8080/ws/stream";

type AgentStatus = "idle" | "active" | "complete" | "error";

const AGENT_NODES = [
  { key: "orchestrator", label: "Orchestrator", model: "Mistral Nemotron" },
  { key: "vision",       label: "Vision",       model: "Llama 4 Maverick" },
  { key: "localizer",    label: "Localizer",    model: "GeoPandas+GPU"    },
  { key: "compiler",     label: "Compiler",     model: "Nemotron 30B"     },
];

const DOT: Record<AgentStatus, string> = {
  idle:     "#6b7280",
  active:   "#2dd4bf",
  complete: "#22c55e",
  error:    "#ef4444",
};

const MOCK_WARDS: WardFeature[] = [
  { id: "1", name: "Etobicoke North",       score: 87, lat: 43.7380, lng: -79.5765, risk_level: "CRITICAL", in_flood_zone: true,  prior_311: 6, watermain_age: 72 },
  { id: "2", name: "York South-Weston",     score: 74, lat: 43.7050, lng: -79.4850, risk_level: "HIGH",     in_flood_zone: true,  prior_311: 4, watermain_age: 55 },
  { id: "3", name: "Parkdale-High Park",    score: 62, lat: 43.6550, lng: -79.4650, risk_level: "HIGH",     in_flood_zone: false, prior_311: 3, watermain_age: 48 },
  { id: "4", name: "Scarborough Southwest", score: 55, lat: 43.7350, lng: -79.2350, risk_level: "ELEVATED", in_flood_zone: false, prior_311: 2, watermain_age: 30 },
  { id: "5", name: "North York Centre",     score: 38, lat: 43.7615, lng: -79.4111, risk_level: "LOW",      in_flood_zone: false, prior_311: 1, watermain_age: 15 },
  { id: "6", name: "Downtown Core",         score: 45, lat: 43.6700, lng: -79.3900, risk_level: "ELEVATED", in_flood_zone: false, prior_311: 2, watermain_age: 60 },
  { id: "7", name: "Scarborough North",     score: 68, lat: 43.7900, lng: -79.2600, risk_level: "HIGH",     in_flood_zone: false, prior_311: 3, watermain_age: 40 },
  { id: "8", name: "Humber River",          score: 72, lat: 43.7200, lng: -79.5200, risk_level: "HIGH",     in_flood_zone: true,  prior_311: 5, watermain_age: 58 },
];

export default function Dashboard() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  const [wardScores,   setWardScores]   = useState<WardFeature[]>(MOCK_WARDS);
  const [buildings,    setBuildings]    = useState<BuildingFeature[]>([]);
  const [incidents,    setIncidents]    = useState<IncidentMarker[]>([]);
  const [allIncidents, setAllIncidents] = useState<any[]>([]);
  const [confirmed,    setConfirmed]    = useState(0);
  const [showReport,   setShowReport]   = useState(false);
  const [selectedWard, setSelectedWard] = useState<WardFeature | null>(null);
  const [agentStates,  setAgentStates]  = useState<Record<string, AgentStatus>>(
    Object.fromEntries(AGENT_NODES.map((n) => [n.key, "idle"]))
  );
  const [dispatchText, setDispatchText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveGps,      setLiveGps]      = useState<{ lat: number; lng: number } | null>(null);

  // Mobile: panel expanded/collapsed
  const [panelOpen, setPanelOpen] = useState(false);
  const [isMobile,  setIsMobile]  = useState(false);

  const wsRef      = useRef<WebSocket | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // ── Detect mobile ───────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Live GPS ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => setLiveGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()    => setLiveGps({ lat: 43.6532, lng: -79.3832 }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => { if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, []);

  // ── Load ward risk map ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/risk-map`)
      .then((r) => r.json())
      .then((d) => { if (d.wards?.length) setWardScores(d.wards); })
      .catch(() => {});
    fetch(`${API}/api/buildings`)
      .then((r) => r.json())
      .then((d) => { if (d.buildings?.length) setBuildings(d.buildings); })
      .catch(() => {});
  }, []);

  // ── WebSocket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(WS);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.node) {
        setAgentStates((p) => ({ ...p, [evt.node]: "complete" }));
        if (evt.data?.final_dispatch_report) setDispatchText(evt.data.final_dispatch_report);
        if (evt.data?.escalated) setConfirmed((c) => c + 1);
      }
    };
    ws.onerror = () => {};
    return () => ws.close();
  }, []);

  // ── Submit incident ──────────────────────────────────────────────────────────
  const handleIncidentSubmit = useCallback(async (
    transcript: string, frame_b64: string, gps: { lat: number; lng: number }
  ) => {
    setIsProcessing(true);
    setDispatchText("");
    setAgentStates(Object.fromEntries(AGENT_NODES.map((n) => [n.key, "idle"])));
    setAgentStates((p) => ({ ...p, orchestrator: "active" }));

    const res  = await fetch(`${API}/api/incident`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, frame_b64, gps }),
    });
    const data = await res.json();

    setAgentStates(Object.fromEntries(AGENT_NODES.map((n) => [n.key, "complete"])));
    setDispatchText(data.report ?? "");
    setIsProcessing(false);

    if (data.legitimate !== false) {
      const newInc: IncidentMarker = { id: Date.now(), gps, urgency: data.urgency ?? "HIGH", transcript, timestamp: new Date().toISOString() };
      setIncidents((p) => [...p, newInc]);
      setAllIncidents((p) => [{ ...newInc, ward_risk: data.ward_risk ?? 0, escalated: data.escalated ?? false }, ...p]);
      if (data.escalated) setConfirmed((c) => c + 1);
      fetch(`${API}/api/risk-map`).then((r) => r.json()).then((d) => { if (d.wards?.length) setWardScores(d.wards); });
    }
    return { legitimate: data.legitimate !== false, urgency: data.urgency ?? "HIGH" };
  }, []);

  // ── Shared panel content ─────────────────────────────────────────────────────
  const PanelContent = (
    <>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--border)", background: "var(--border)", gap: "1px" }}>
        {[
          { label: "Wards",    value: wardScores.length,                                              color: undefined },
          { label: "Critical", value: wardScores.filter((w) => w.risk_level === "CRITICAL").length,   color: "#ef4444" },
          { label: "Reports",  value: allIncidents.length,                                            color: undefined },
        ].map((s) => (
          <div key={s.label} style={{ padding: "8px 0", textAlign: "center", background: "var(--bg-sidebar)" }}>
            <p style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: s.color ?? "var(--text)", margin: 0 }}>{s.value}</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <WardBriefingPanel wardScores={wardScores} onWardClick={(w) => { setSelectedWard(w); if (isMobile) setPanelOpen(false); }} />
      <IncidentFeed incidents={allIncidents} />

      {/* Agent pipeline */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8 }}>Agent Pipeline</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
          {AGENT_NODES.map((n) => (
            <div key={n.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 4px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", textAlign: "center" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOT[agentStates[n.key]], display: "block", ...(agentStates[n.key] === "active" ? { animation: "pulse 1s infinite" } : {}) }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text)" }}>{n.label}</span>
              <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{n.model}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Dispatch report */}
      {dispatchText && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", maxHeight: 160, overflowY: "auto" }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 6 }}>Dispatch Report</p>
          <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", fontFamily: "monospace", color: "var(--text)", margin: 0 }}>{dispatchText}</pre>
        </div>
      )}

      {/* Report button */}
      <div style={{ padding: "12px", marginTop: "auto" }}>
        <button
          onClick={() => setShowReport(true)}
          disabled={isProcessing}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0", borderRadius: 12, background: "var(--red)", color: "#fff", fontWeight: 600, fontSize: 14, border: "none", cursor: isProcessing ? "not-allowed" : "pointer", opacity: isProcessing ? 0.5 : 1 }}
        >
          <AlertTriangle style={{ width: 16, height: 16 }} />
          {isProcessing ? "Processing…" : "Report Incident"}
        </button>
        <p style={{ textAlign: "center", fontSize: 10, marginTop: 6, color: "var(--text-muted)" }}>
          Powered by NVIDIA GB10 · All inference local
        </p>
      </div>
    </>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100dvh", overflow: "hidden", background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: isMobile ? "column" : "row" }}>

      {/* ── Map area ── */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0 }}>
        <MapView wardScores={wardScores} buildings={buildings} incidents={incidents} onWardClick={setSelectedWard} isDark={isDark} />

        {selectedWard && <ZoneDetailPanel ward={selectedWard} onClose={() => setSelectedWard(null)} />}

        {/* Map legend */}
        <div style={{ position: "absolute", bottom: isMobile ? 72 : 16, left: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
          {[["#ef4444", "CRITICAL >80"], ["#f97316", "HIGH >60"], ["#eab308", "ELEVATED >40"], ["#22c55e", "LOW <40"]].map(([color, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
              {label}
            </div>
          ))}
        </div>

        {/* Mobile: floating header + report button over map */}
        {isMobile && (
          <>
            {/* Top bar */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>Delation</span>
                {liveGps && (
                  <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 8, fontFamily: "monospace" }}>
                    <MapPin style={{ width: 10, height: 10, display: "inline" }} /> {liveGps.lat.toFixed(4)}, {liveGps.lng.toFixed(4)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#4ade80", fontFamily: "monospace" }}>
                  <CheckCheck style={{ width: 12, height: 12, display: "inline", marginRight: 3 }} />{confirmed}
                </span>
                <button onClick={() => setTheme(isDark ? "light" : "dark")} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 6, padding: "4px 6px", color: "#fff", cursor: "pointer" }}>
                  {isDark ? <Sun style={{ width: 14, height: 14 }} /> : <Moon style={{ width: 14, height: 14 }} />}
                </button>
              </div>
            </div>

            {/* Mobile: Report button floating over map */}
            <button
              onClick={() => setShowReport(true)}
              disabled={isProcessing}
              style={{ position: "absolute", bottom: 16, right: 16, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 24, background: "var(--red)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer", boxShadow: "0 4px 16px rgba(239,68,68,0.4)" }}
            >
              <AlertTriangle style={{ width: 14, height: 14 }} />
              Report
            </button>
          </>
        )}
      </div>

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", height: "100%", background: "var(--bg-sidebar)", overflowY: "auto" }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.05em", color: "var(--text)", margin: 0 }}>Delation</h1>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Urban Risk Intelligence · Toronto</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {liveGps && (
                <span style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 6px", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)" }}>
                  📍 {liveGps.lat.toFixed(4)}, {liveGps.lng.toFixed(4)}
                </span>
              )}
              <span style={{ fontSize: 11, color: "#4ade80", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 3 }}>
                <CheckCheck style={{ width: 12, height: 12 }} />{confirmed}
              </span>
              <button onClick={() => setTheme(isDark ? "light" : "dark")} style={{ padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
                {isDark ? <Sun style={{ width: 14, height: 14 }} /> : <Moon style={{ width: 14, height: 14 }} />}
              </button>
            </div>
          </div>
          {PanelContent}
        </div>
      )}

      {/* ── Mobile bottom drawer ── */}
      {isMobile && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "var(--bg-sidebar)", borderTop: "1px solid var(--border)", borderRadius: "16px 16px 0 0", transition: "height 0.3s ease", height: panelOpen ? "70vh" : "56px", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 20 }}>
          {/* Drawer handle */}
          <button
            onClick={() => setPanelOpen((p) => !p)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", flexShrink: 0 }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
              {panelOpen ? "Risk Intelligence" : `${wardScores.filter((w) => w.risk_level === "CRITICAL").length} Critical · ${wardScores.length} Wards`}
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              {panelOpen ? <ChevronDown style={{ width: 16, height: 16 }} /> : <ChevronUp style={{ width: 16, height: 16 }} />}
            </span>
          </button>
          {/* Drawer content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {PanelContent}
          </div>
        </div>
      )}

      {showReport && (
        <ReportModal
          initialGps={liveGps ?? undefined}
          onClose={() => setShowReport(false)}
          onSubmit={async (transcript, frame, gps) => {
            setShowReport(false);
            return handleIncidentSubmit(transcript, frame, gps);
          }}
        />
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        * { -webkit-tap-highlight-color: transparent; }
        input, textarea, button { font-size: 16px; } /* prevent iOS zoom */
      `}</style>
    </div>
  );
}
