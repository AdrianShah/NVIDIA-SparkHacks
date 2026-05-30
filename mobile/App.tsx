import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AgentCard, { NodeStatus } from "./components/AgentCard";
import CameraCapture from "./components/CameraCapture";
import DispatchReport from "./components/DispatchReport";
import MapView from "./components/MapView";
import type { SpatialData } from "./components/MapView";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const WS_URL  = process.env.EXPO_PUBLIC_WS_URL ?? `${API_URL.replace(/^http/, "ws")}/ws/stream`;

type UrgencyLevel = "LOW" | "HIGH" | "CRITICAL";

interface AgentNodeDef {
  name: string;
  label: string;
  status: NodeStatus;
  detail: string;
}

const INITIAL_NODES: AgentNodeDef[] = [
  { name: "orchestrator", label: "Orchestrator", status: "idle", detail: "" },
  { name: "vision",       label: "Vision",       status: "idle", detail: "" },
  { name: "localizer",    label: "Localizer",    status: "idle", detail: "" },
  { name: "compiler",     label: "Compiler",     status: "idle", detail: "" },
];

const SCREEN_HEIGHT = Dimensions.get("window").height;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return globalThis.btoa(binary);
}

export default function App() {
  const [isActive, setIsActive]         = useState(false);
  const [gps, setGps]                   = useState({ lat: 43.6532, lng: -79.3832 });
  const [nodes, setNodes]               = useState<AgentNodeDef[]>(INITIAL_NODES);
  const [report, setReport]             = useState("");
  const [vision, setVision]             = useState<any>(null);
  const [spatial, setSpatial]           = useState<SpatialData | null>(null);
  const [urgency, setUrgency]           = useState<UrgencyLevel>("LOW");
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioStatus, setAudioStatus]   = useState("MIC IDLE");

  const currentFrameRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const wsRef           = useRef<WebSocket | null>(null);
  const pollRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef    = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  const resetNodes = () =>
    setNodes(INITIAL_NODES.map((n) => ({ ...n, status: "idle", detail: "" })));

  const setNodeStatus = (name: string, status: NodeStatus, detail = "") =>
    setNodes((prev) =>
      prev.map((n) => (n.name === name ? { ...n, status, detail } : n))
    );

  const startAudioRecording = useCallback(async () => {
    if (recordingRef.current) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setAudioStatus("MIC DENIED");
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setAudioStatus("MIC RECORDING");
    } catch {
      setAudioStatus("MIC UNAVAILABLE");
    }
  }, []);

  const stopAudioRecordingAndUpload = useCallback(async (ws: WebSocket) => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return;

    try {
      setAudioStatus("MIC UPLOADING");
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) return;

      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      ws.send(JSON.stringify({ type: "audio_start", format: "m4a" }));
      ws.send(JSON.stringify({ type: "audio_chunk", data: b64 }));
      ws.send(JSON.stringify({ type: "audio_commit" }));
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      setAudioStatus("MIC UPLOAD FAILED");
    }
  }, []);

  const stopAudioRecording = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {}
    setAudioStatus("MIC IDLE");
  }, []);

  const setupWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      ws.onopen    = () => { wsRef.current = ws; };
      ws.onmessage = (event) => {
        const { node, status, data: nodeData } = JSON.parse(event.data);
        if (node === "stt") {
          if (status === "active") setAudioStatus("MIC TRANSCRIBING");
          else if (status === "error") setAudioStatus("MIC FALLBACK");
          else setAudioStatus(nodeData?.used_fallback ? "MIC FALLBACK" : "MIC READY");
        }
        if (node && status) {
          let detail = "";
          if (node === "vision" && nodeData?.vision_analysis)
            detail = `${nodeData.vision_analysis.hazard_type ?? ""} · ${nodeData.vision_analysis.severity_scale ?? "?"}/10`;
          else if (node === "localizer" && nodeData?.spatial_data_results) {
            const h = nodeData.spatial_data_results.closest_hydrants?.[0];
            detail = h ? `Hydrant @ ${h.distance_meters} m` : "";
          }
          setNodeStatus(node, status as NodeStatus, detail);
        }
        if (nodeData?.final_dispatch_report) { setReport(nodeData.final_dispatch_report); setIsProcessing(false); }
        if (nodeData?.urgency_level)          setUrgency(nodeData.urgency_level as UrgencyLevel);
        if (nodeData?.vision_analysis)        setVision(nodeData.vision_analysis);
        if (nodeData?.spatial_data_results)   setSpatial(nodeData.spatial_data_results);
      };
      ws.onerror = () => { wsRef.current = null; };
      ws.onclose = () => { wsRef.current = null; };
    } catch {}
  }, []);

  const processIncident = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setNodeStatus("orchestrator", "active");
    try {
      const res = await fetch(`${API_URL}/api/incident`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: "Emergency incident reported at this location",
          frame_b64: currentFrameRef.current,
          gps,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes(
        INITIAL_NODES.map((n) => ({
          ...n, status: "complete",
          detail:
            n.name === "vision"    ? `${data.vision?.hazard_type ?? ""} · ${data.vision?.severity_scale ?? "?"}/10`
            : n.name === "localizer" ? `${data.spatial?.closest_hydrants?.[0]?.distance_meters ?? "?"} m to hydrant`
            : "",
        }))
      );
      setReport(data.report ?? "");
      setUrgency((data.urgency as UrgencyLevel) ?? "HIGH");
      setVision(data.vision ?? null);
      setSpatial(data.spatial ?? null);
    } catch {
      setNodes((prev) =>
        prev.map((n) => (n.status === "active" ? { ...n, status: "error" } : n))
      );
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  }, [gps]);

  const sendIncident = useCallback(async () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setIsProcessing(true);
      resetNodes();
      await stopAudioRecordingAndUpload(ws);
      ws.send(JSON.stringify({ transcript: "Emergency incident reported", frame_b64: currentFrameRef.current, gps }));
      await startAudioRecording();
    } else {
      resetNodes();
      processIncident();
    }
  }, [gps, processIncident, startAudioRecording, stopAudioRecordingAndUpload]);

  const startIncident = async () => {
    setIsActive(true);
    setReport("");
    resetNodes();
    await startAudioRecording();
    setupWebSocket();
    const id = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        if (currentFrameRef.current) processIncident();
      }
    }, 6000);
    pollRef.current = id;
    setTimeout(() => { if (currentFrameRef.current) sendIncident(); }, 3000);
  };

  const stopIncident = async () => {
    setIsActive(false);
    wsRef.current?.close();
    wsRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    await stopAudioRecording();
    resetNodes();
  };

  const playAudio = async () => {
    if (!report) return;
    try {
      const res = await fetch(`${API_URL}/api/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: report.slice(0, 500) }),
      });
      const b64 = arrayBufferToBase64(await res.arrayBuffer());
      const uri = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "") + "dispatch.wav";
      await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
      const { sound } = await Audio.Sound.createAsync({ uri });
      await sound.playAsync();
    } catch {}
  };

  const urgencyColor =
    ({ CRITICAL: "#ef4444", HIGH: "#f97316", LOW: "#22c55e" } as Record<string, string>)[urgency] ?? "#6b7280";

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050F14" />

      {/* Map — top 42% */}
      <View style={styles.mapContainer}>
        <MapView gps={gps} spatial={spatial} urgency={urgency} isActive={isActive} />

        <View style={styles.cameraOverlay}>
          <CameraCapture isActive={isActive} onFrame={(f) => { currentFrameRef.current = f; }} />
        </View>

        {isActive && (
          <View style={[styles.urgencyBadge, { borderColor: urgencyColor }]}>
            <View style={[styles.urgencyDot, { backgroundColor: urgencyColor }]} />
            <Text style={[styles.urgencyText, { color: urgencyColor }]}>{urgency} INCIDENT LIVE</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: isActive ? "#dc2626" : "#0d9488" }]}
          onPress={isActive ? stopIncident : startIncident}
          activeOpacity={0.8}
        >
          <Text style={styles.startBtnText}>{isActive ? "◼ STOP" : "▶ START INCIDENT"}</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom panel */}
      <View style={styles.panel}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>CIVICVOX-OMNI</Text>
            <Text style={styles.subtitle}>Edge Emergency Intelligence · Toronto</Text>
          </View>
          <View>
            <Text style={styles.hwLabel}>NVIDIA GB10</Text>
            <Text style={styles.micLabel}>{audioStatus}</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>── AGENT PIPELINE</Text>
          <View style={styles.agentRow}><AgentCard {...nodes[0]} /><AgentCard {...nodes[1]} /></View>
          <View style={styles.agentRow}><AgentCard {...nodes[2]} /><AgentCard {...nodes[3]} /></View>

          {vision && (
            <View style={styles.visionBox}>
              <Text style={styles.visionTitle}>VISION ANALYSIS</Text>
              <View style={styles.visionGrid}>
                {[
                  ["Hazard",      vision.hazard_type],
                  ["Severity",    `${vision.severity_scale ?? "?"}/10`],
                  ["Struct Risk", vision.structural_risk ? "YES" : "NO"],
                  ["Location",    vision.location_cues || "—"],
                ].map(([k, v]) => (
                  <View key={k} style={styles.visionItem}>
                    <Text style={styles.visionKey}>{k}:</Text>
                    <Text
                      style={[
                        styles.visionVal,
                        k === "Severity"    && (vision.severity_scale ?? 0) >= 7 && { color: "#f87171" },
                        k === "Struct Risk" && vision.structural_risk            && { color: "#f87171" },
                      ]}
                      numberOfLines={1}
                    >
                      {String(v)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {(spatial?.closest_hydrants?.length ?? 0) > 0 && (
            <View style={styles.hydrantBox}>
              <Text style={styles.hydrantTitle}>NEAREST HYDRANTS</Text>
              {spatial!.closest_hydrants!.slice(0, 3).map((h) => (
                <View key={h.id} style={styles.hydrantRow}>
                  <Text style={styles.hydrantId}>▲ #{h.id}</Text>
                  <Text style={styles.hydrantDist}>{h.distance_meters} m</Text>
                  <Text style={styles.hydrantStatus}>{h.status}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 12 }]}>── DISPATCH PROTOCOL</Text>
          <View style={styles.reportBox}>
            <DispatchReport report={report} isProcessing={isProcessing} />
          </View>

          {report ? (
            <TouchableOpacity style={styles.audioBtn} onPress={playAudio} activeOpacity={0.7}>
              <Text style={styles.audioBtnText}>🔊 PLAY AUDIO DISPATCH</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: 32 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#050F14" },
  mapContainer:  { height: SCREEN_HEIGHT * 0.42 },
  cameraOverlay: { position: "absolute", bottom: 12, left: 12 },
  urgencyBadge:  {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  urgencyDot:    { width: 8, height: 8, borderRadius: 4 },
  urgencyText:   { fontFamily: "monospace", fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  startBtn:      {
    position: "absolute", top: 12, right: 12,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
  },
  startBtnText:  { color: "#fff", fontFamily: "monospace", fontWeight: "700", fontSize: 12, letterSpacing: 1 },

  panel:         { flex: 1, borderTopWidth: 1, borderTopColor: "#042f2e" },
  header:        {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#042f2e",
  },
  title:         { color: "#2dd4bf", fontFamily: "monospace", fontWeight: "700", fontSize: 14, letterSpacing: 3 },
  subtitle:      { color: "#374151", fontFamily: "monospace", fontSize: 9, marginTop: 2 },
  hwLabel:       { color: "#374151", fontFamily: "monospace", fontSize: 9 },
  micLabel:      { color: "#14b8a6", fontFamily: "monospace", fontSize: 8, marginTop: 2, textAlign: "right" },

  scroll:        { flex: 1, paddingHorizontal: 12 },
  sectionLabel:  { color: "#374151", fontFamily: "monospace", fontSize: 9, letterSpacing: 2, marginTop: 12, marginBottom: 6 },
  agentRow:      { flexDirection: "row", marginBottom: 2 },

  visionBox:     { borderWidth: 1, borderColor: "#134e4a", borderRadius: 8, padding: 10, marginTop: 8, backgroundColor: "#042f2e33" },
  visionTitle:   { color: "#14b8a6", fontFamily: "monospace", fontSize: 9, letterSpacing: 2, marginBottom: 8 },
  visionGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  visionItem:    { flexDirection: "row", gap: 4, width: "48%" },
  visionKey:     { color: "#6b7280", fontFamily: "monospace", fontSize: 10 },
  visionVal:     { color: "#d1d5db", fontFamily: "monospace", fontSize: 10, flex: 1 },

  hydrantBox:    { borderWidth: 1, borderColor: "#1e3a5f", borderRadius: 8, padding: 10, marginTop: 8, backgroundColor: "#0c1a2e33" },
  hydrantTitle:  { color: "#60a5fa", fontFamily: "monospace", fontSize: 9, letterSpacing: 2, marginBottom: 6 },
  hydrantRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  hydrantId:     { color: "#60a5fa", fontFamily: "monospace", fontSize: 11 },
  hydrantDist:   { color: "#9ca3af", fontFamily: "monospace", fontSize: 11 },
  hydrantStatus: { color: "#4b5563", fontFamily: "monospace", fontSize: 11 },

  reportBox:     { minHeight: 120, borderWidth: 1, borderColor: "#042f2e", borderRadius: 8, padding: 10 },
  audioBtn:      { marginTop: 8, borderWidth: 1, borderColor: "#134e4a", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  audioBtnText:  { color: "#14b8a6", fontFamily: "monospace", fontSize: 11 },
});
