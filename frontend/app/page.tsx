"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AgentCard, { NodeStatus } from "@/components/AgentCard";
import DispatchReport from "@/components/DispatchReport";
import CameraCapture from "@/components/CameraCapture";
import type { SpatialData } from "@/components/MapView";

// SSR disabled — mapbox-gl uses browser globals
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-gray-950 animate-pulse" />,
});

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws/stream";

type UrgencyLevel = "LOW" | "HIGH" | "CRITICAL";

interface AgentNodeDef {
  name: string;
  label: string;
  status: NodeStatus;
  detail: string;
}

const INITIAL_NODES: AgentNodeDef[] = [
  { name: "orchestrator", label: "Orchestrator", status: "idle", detail: "" },
  { name: "vision", label: "Vision", status: "idle", detail: "" },
  { name: "localizer", label: "Localizer", status: "idle", detail: "" },
  { name: "compiler", label: "Compiler", status: "idle", detail: "" },
];

export default function HomePage() {
  const [isActive, setIsActive] = useState(false);
  const [gps, setGps] = useState({ lat: 43.6532, lng: -79.3832 });
  const [nodes, setNodes] = useState<AgentNodeDef[]>(INITIAL_NODES);
  const [report, setReport] = useState("");
  const [vision, setVision] = useState<any>(null);
  const [spatial, setSpatial] = useState<SpatialData | null>(null);
  const [urgency, setUrgency] = useState<UrgencyLevel>("LOW");
  const [isProcessing, setIsProcessing] = useState(false);
  const [connectionType, setConnectionType] = useState<"ws" | "http">("http");
  const [tokenCount, setTokenCount] = useState(0);

  const currentFrameRef = useRef<string | null>(null);
  const transcriptRef = useRef<string>("");
  const isProcessingRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Attempt GPS
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    );
  }, []);

  const resetNodes = () =>
    setNodes(INITIAL_NODES.map((n) => ({ ...n, status: "idle", detail: "" })));

  const setNodeStatus = (name: string, status: NodeStatus, detail = "") =>
    setNodes((prev) =>
      prev.map((n) => (n.name === name ? { ...n, status, detail } : n))
    );

  // ── WebSocket mode ──────────────────────────────────────────────────────────
  const setupWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnectionType("ws");
        wsRef.current = ws;
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const { node, status, data: nodeData } = data;

        if (node && status) {
          let detail = "";
          if (node === "vision" && nodeData?.vision_analysis) {
            detail = `${nodeData.vision_analysis.hazard_type ?? ""} · ${nodeData.vision_analysis.severity_scale ?? "?"}/10`;
          } else if (node === "localizer" && nodeData?.spatial_data_results) {
            const h = nodeData.spatial_data_results.closest_hydrants?.[0];
            detail = h ? `Hydrant @ ${h.distance_meters} m` : "";
          }
          setNodeStatus(node, status as NodeStatus, detail);
        }

        if (nodeData?.final_dispatch_report) {
          setReport(nodeData.final_dispatch_report);
          setIsProcessing(false);
        }
        if (nodeData?.urgency_level) setUrgency(nodeData.urgency_level as UrgencyLevel);
        if (nodeData?.vision_analysis) setVision(nodeData.vision_analysis);
        if (nodeData?.spatial_data_results) setSpatial(nodeData.spatial_data_results);
      };

      ws.onerror = () => {
        setConnectionType("http");
        wsRef.current = null;
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch {
      setConnectionType("http");
    }
  }, []);

  // ── HTTP polling mode ───────────────────────────────────────────────────────
  const processIncident = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);

    // Optimistic node progression
    setNodeStatus("orchestrator", "active");

    try {
      const res = await fetch(`${API_URL}/api/incident`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptRef.current || "Emergency incident reported at this location",
          frame_b64: currentFrameRef.current,
          gps,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Mark all nodes complete when response arrives
      setNodes(
        INITIAL_NODES.map((n) => ({
          ...n,
          status: "complete",
          detail:
            n.name === "vision"
              ? `${data.vision?.hazard_type ?? ""} · ${data.vision?.severity_scale ?? "?"}/10`
              : n.name === "localizer"
              ? `${data.spatial?.closest_hydrants?.[0]?.distance_meters ?? "?"} m to hydrant`
              : "",
        }))
      );

      setReport(data.report ?? "");
      setUrgency((data.urgency as UrgencyLevel) ?? "HIGH");
      setVision(data.vision ?? null);
      setSpatial(data.spatial ?? null);
      setTokenCount((c) => c + (data.report?.split(" ").length ?? 0));
    } catch (err) {
      setNodes((prev) =>
        prev.map((n) => (n.status === "active" ? { ...n, status: "error" } : n))
      );
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  }, [gps]);

  // Send via WS if available, otherwise HTTP
  const sendIncident = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setIsProcessing(true);
      resetNodes();
      ws.send(
        JSON.stringify({
          transcript: transcriptRef.current || "Emergency incident reported",
          frame_b64: currentFrameRef.current,
          gps,
        })
      );
    } else {
      resetNodes();
      processIncident();
    }
  }, [gps, processIncident]);

  // ── Start / stop ────────────────────────────────────────────────────────────
  const startIncident = () => {
    setIsActive(true);
    setReport("");
    resetNodes();
    setupWebSocket();

    // Poll every 6 s (WebSocket will take over if it connects)
    const id = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        if (currentFrameRef.current) processIncident();
      }
    }, 6000);
    pollRef.current = id;

    // Immediate first call
    setTimeout(() => {
      if (currentFrameRef.current) sendIncident();
    }, 3000);
  };

  const stopIncident = () => {
    setIsActive(false);
    wsRef.current?.close();
    wsRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    resetNodes();
  };

  // Urgency badge colour
  const urgencyStyle = {
    CRITICAL: "text-red-400 border-red-500/50",
    HIGH: "text-orange-400 border-orange-500/50",
    LOW: "text-green-400 border-green-500/50",
  }[urgency] ?? "text-gray-400 border-gray-700";

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "#050F14" }}>
      {/* ── Left panel — Map (60%) ── */}
      <div className="relative flex-shrink-0" style={{ width: "60%" }}>
        <MapView gps={gps} spatial={spatial} urgency={urgency} isActive={isActive} />

        {/* Camera overlay */}
        <div className="absolute bottom-4 left-4 z-20">
          <CameraCapture
            isActive={isActive}
            onFrame={(f) => { currentFrameRef.current = f; }}
            onTranscript={(t) => { transcriptRef.current = t; }}
          />
        </div>

        {/* Urgency badge */}
        {isActive && (
          <div className={`absolute top-4 left-4 z-20 rounded border px-3 py-1.5 bg-black/70 backdrop-blur flex items-center gap-2 ${urgencyStyle}`}>
            <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
            <span className="text-xs font-mono font-bold tracking-widest">{urgency} INCIDENT LIVE</span>
          </div>
        )}

        {/* Start / Stop button */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 items-end">
          <button
            onClick={isActive ? stopIncident : startIncident}
            className={`px-5 py-2 rounded-lg font-mono font-bold text-sm tracking-wider transition-all shadow-lg ${
              isActive
                ? "bg-red-600 hover:bg-red-700 text-white shadow-red-900/40"
                : "bg-teal-600 hover:bg-teal-700 text-white shadow-teal-900/40"
            }`}
          >
            {isActive ? "◼ STOP" : "▶ START INCIDENT"}
          </button>
          {isActive && (
            <div className="text-[10px] font-mono text-gray-600 bg-black/50 rounded px-2 py-0.5">
              {connectionType.toUpperCase()} · {gps.lat.toFixed(4)},{gps.lng.toFixed(4)}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel (40%) ── */}
      <div className="flex flex-col flex-1 border-l border-teal-950/60 min-w-0">
        {/* Header */}
        <div className="px-5 py-3 border-b border-teal-950/60 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-teal-400 font-mono font-bold text-base tracking-widest">
              CIVICVOX-OMNI
            </h1>
            <p className="text-gray-600 text-[11px] font-mono mt-0.5">
              Edge Emergency Intelligence · City of Toronto
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono text-gray-600">NVIDIA GB10 · LOCAL INFERENCE</p>
            <p className="text-[10px] font-mono text-gray-700 mt-0.5">
              {tokenCount > 0 ? `${tokenCount} tokens generated` : "Offline ready"}
            </p>
          </div>
        </div>

        {/* Agent telemetry — top half */}
        <div className="flex-1 p-4 border-b border-teal-950/60 overflow-hidden">
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-3">
            ── Agent Pipeline
          </p>

          <div className="grid grid-cols-2 gap-2.5 mb-4">
            {nodes.map((n) => (
              <AgentCard key={n.name} name={n.name} label={n.label} status={n.status} detail={n.detail} />
            ))}
          </div>

          {/* Vision quick stats */}
          {vision && (
            <div className="rounded border border-teal-900/40 bg-teal-950/20 p-3 space-y-1.5">
              <p className="text-[10px] font-mono text-teal-600 uppercase tracking-widest">
                Vision Analysis
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  ["Hazard", vision.hazard_type],
                  ["Severity", `${vision.severity_scale ?? "?"}/10`],
                  ["Structural Risk", vision.structural_risk ? "YES" : "NO"],
                  vision.water_depth_m != null
                    ? ["Water Depth", `${vision.water_depth_m} m`]
                    : ["Location Cues", vision.location_cues || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-1">
                    <span className="text-[11px] font-mono text-gray-600 flex-shrink-0">{k}:</span>
                    <span className={`text-[11px] font-mono truncate ${
                      k === "Severity" && (vision.severity_scale ?? 0) >= 7 ? "text-red-400" :
                      k === "Structural Risk" && vision.structural_risk ? "text-red-400" :
                      "text-gray-300"
                    }`}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hydrant list */}
          {spatial?.closest_hydrants && spatial.closest_hydrants.length > 0 && (
            <div className="mt-2 rounded border border-blue-900/30 bg-blue-950/10 p-2.5">
              <p className="text-[10px] font-mono text-blue-500 uppercase tracking-widest mb-1.5">
                Nearest Hydrants
              </p>
              {spatial.closest_hydrants.slice(0, 3).map((h) => (
                <div key={h.id} className="flex justify-between text-[11px] font-mono text-gray-400 py-0.5">
                  <span className="text-blue-400">▲ #{h.id}</span>
                  <span>{h.distance_meters} m</span>
                  <span className="text-gray-600">{h.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dispatch report — bottom half */}
        <div className="flex-1 p-4 min-h-0 flex flex-col">
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-3 flex-shrink-0">
            ── Dispatch Protocol
          </p>
          <div className="flex-1 min-h-0">
            <DispatchReport report={report} isProcessing={isProcessing} />
          </div>

          {report && (
            <button
              onClick={() => {
                fetch(`${API_URL}/api/synthesize`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: report.slice(0, 500) }),
                })
                  .then((r) => r.blob())
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = new Audio(url);
                    a.play();
                  })
                  .catch(() => {});
              }}
              className="mt-2 w-full py-1.5 text-[11px] font-mono text-teal-600 border border-teal-900/40 rounded hover:bg-teal-950/30 transition-colors flex-shrink-0"
            >
              🔊 PLAY AUDIO DISPATCH
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
