import { Audio } from "expo-av";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions, Modal, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { WardScore, SpatialData } from "./components/MapView";
import AgentCard, { NodeStatus } from "./components/AgentCard";
import CameraCapture from "./components/CameraCapture";
import DispatchReport from "./components/DispatchReport";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

type UrgencyLevel = "LOW" | "HIGH" | "CRITICAL";
interface AgentNodeDef { name: string; label: string; status: NodeStatus; detail: string; }

const INITIAL_NODES: AgentNodeDef[] = [
  { name: "orchestrator", label: "Orchestrator", status: "idle", detail: "" },
  { name: "vision",       label: "Vision",       status: "idle", detail: "" },
  { name: "localizer",    label: "Localizer",    status: "idle", detail: "" },
  { name: "compiler",     label: "Compiler",     status: "idle", detail: "" },
];

const MODEL_LABELS: Record<string, string> = {
  orchestrator: "Mistral Nemotron",
  vision:       "Llama 4 Maverick",
  localizer:    "GeoPandas · GPU",
  compiler:     "Nemotron 30B",
};

const RISK_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444", HIGH: "#f97316", ELEVATED: "#eab308", LOW: "#22c55e",
};

const MOCK_WARDS: WardScore[] = [
  { id: "1", name: "Etobicoke North",      score: 87, lat: 43.7380, lng: -79.5765, risk_level: "CRITICAL", in_flood_zone: true,  prior_311: 6, watermain_age: 72 },
  { id: "2", name: "York South-Weston",    score: 74, lat: 43.6900, lng: -79.4700, risk_level: "HIGH",     in_flood_zone: true,  prior_311: 4, watermain_age: 55 },
  { id: "3", name: "Parkdale-High Park",   score: 62, lat: 43.6430, lng: -79.4490, risk_level: "HIGH",     in_flood_zone: false, prior_311: 3, watermain_age: 48 },
  { id: "4", name: "Scarborough SW",       score: 55, lat: 43.7000, lng: -79.2300, risk_level: "ELEVATED", in_flood_zone: false, prior_311: 2, watermain_age: 30 },
  { id: "5", name: "Downtown Core",        score: 45, lat: 43.6532, lng: -79.3832, risk_level: "ELEVATED", in_flood_zone: false, prior_311: 2, watermain_age: 60 },
  { id: "6", name: "North York Centre",    score: 30, lat: 43.7615, lng: -79.4111, risk_level: "LOW",      in_flood_zone: false, prior_311: 1, watermain_age: 15 },
  { id: "7", name: "Scarborough North",    score: 68, lat: 43.7800, lng: -79.2500, risk_level: "HIGH",     in_flood_zone: false, prior_311: 3, watermain_age: 40 },
  { id: "8", name: "Humber River-Black Creek", score: 72, lat: 43.7200, lng: -79.5200, risk_level: "HIGH", in_flood_zone: true,  prior_311: 5, watermain_age: 58 },
];


export default function App() {
  // ── Theme ────────────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(true);
  const theme = {
    bg:      isDark ? "#050F14" : "#f8fafc",
    bgCard:  isDark ? "#0d1f2d" : "#ffffff",
    bgPanel: isDark ? "#071a24" : "#f1f5f9",
    border:  isDark ? "#134e4a" : "#e2e8f0",
    text:    isDark ? "#e5e7eb" : "#0f172a",
    muted:   isDark ? "#6b7280" : "#64748b",
    teal:    isDark ? "#2dd4bf" : "#0d9488",
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  const [gps, setGps]             = useState({ lat: 43.6532, lng: -79.3832 });
  const [wardScores, setWardScores] = useState<WardScore[]>(MOCK_WARDS);
  const [selectedWard, setSelectedWard] = useState<WardScore | null>(null);
  const [incidents, setIncidents]  = useState<any[]>([]);
  const [nodes, setNodes]          = useState<AgentNodeDef[]>(INITIAL_NODES);
  const [report, setReport]        = useState("");
  const [spatial, setSpatial]      = useState<SpatialData | null>(null);
  const [urgency, setUrgency]      = useState<UrgencyLevel>("LOW");
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioStatus, setAudioStatus]   = useState("MIC IDLE");
  const [wardRisk, setWardRisk]    = useState<{ score: number; escalated: boolean } | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [confirmedCount, setConfirmedCount]   = useState(0);

  const currentFrameRef  = useRef<string | null>(null);
  const isProcessingRef  = useRef(false);
  const recordingRef     = useRef<Audio.Recording | null>(null);
  const watchIdRef       = useRef<Location.LocationSubscription | null>(null);

  // ── Live GPS ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      // One-time fix to get initial position fast
      const loc = await Location.getCurrentPositionAsync({});
      setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      // Then watch for updates
      watchIdRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (l) => setGps({ lat: l.coords.latitude, lng: l.coords.longitude })
      );
    })();
    return () => { watchIdRef.current?.remove(); };
  }, []);

  // ── Fetch ward scores ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000); // 4s timeout
    fetch(`${API_URL}/api/risk-map`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => { if (d.wards?.length) setWardScores(d.wards); })
      .catch(() => {}) // stay on MOCK_WARDS
      .finally(() => clearTimeout(timer));
  }, []);

  // ── Audio helpers ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (recordingRef.current) return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { setAudioStatus("MIC DENIED"); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setAudioStatus("MIC RECORDING");
    } catch { setAudioStatus("MIC UNAVAILABLE"); }
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
    setAudioStatus("MIC IDLE");
  }, []);

  // ── Submit incident ───────────────────────────────────────────────────────────
  const submitIncident = useCallback(async (transcript: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    setNodes(INITIAL_NODES.map((n) => ({ ...n, status: "idle", detail: "" })));
    setNodes((p) => p.map((n) => n.name === "orchestrator" ? { ...n, status: "active" } : n));

    try {
      const res = await fetch(`${API_URL}/api/incident`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, frame_b64: currentFrameRef.current ?? "", gps }),
      });
      const data = await res.json();

      if (data.legitimate === false) {
        setNodes(INITIAL_NODES.map((n) => ({
          ...n, status: "error",
          detail: n.name === "orchestrator" ? "Not verified" : "",
        })));
        setReport("⚠ Report not verified. Please provide more detail.");
        return;
      }

      setNodes(INITIAL_NODES.map((n) => ({
        ...n, status: "complete",
        detail: n.name === "vision"    ? `${data.vision?.hazard_type ?? ""} · ${data.vision?.severity_scale ?? "?"}/10`
              : n.name === "localizer" ? `Hydrant: ${data.spatial?.closest_hydrants?.[0]?.distance_meters ?? "?"}m`
              : n.name === "compiler"  ? `Risk: ${data.ward_risk?.toFixed(0) ?? "?"}${data.escalated ? " ⚠" : ""}`
              : "",
      })));
      setReport(data.report ?? "");
      setUrgency((data.urgency as UrgencyLevel) ?? "HIGH");
      setSpatial(data.spatial ?? null);
      setWardRisk({ score: data.ward_risk ?? 0, escalated: data.escalated ?? false });
      if (data.escalated) setConfirmedCount((c) => c + 1);
      setIncidents((p) => [...p, { lat: gps.lat, lng: gps.lng, urgency: data.urgency ?? "HIGH", transcript }]);

      // Refresh ward scores
      fetch(`${API_URL}/api/risk-map`).then((r) => r.json()).then((d) => { if (d.wards?.length) setWardScores(d.wards); });
    } catch {
      setNodes((p) => p.map((n) => n.status === "active" ? { ...n, status: "error" } : n));
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  }, [gps]);

  const handleReportPress = async () => {
    setShowReportModal(true);
    await startRecording();
  };

  const handleReportSubmit = async (transcript: string) => {
    setShowReportModal(false);
    await stopRecording();
    await submitIncident(transcript || "Emergency incident reported at this location");
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* ── Map (top 48%) ── */}
      <View style={styles.mapContainer}>
        <MapView
          gps={gps}
          wardScores={wardScores}
          spatial={spatial}
          incidents={incidents}
          isDark={isDark}
          isActive={isProcessing}
          urgency={urgency}
          onWardPress={setSelectedWard}
        />

        {/* Camera preview — only shown when actively processing */}
        {isProcessing && (
          <View style={styles.cameraOverlay}>
            <CameraCapture isActive={isProcessing} onFrame={(f) => { currentFrameRef.current = f; }} />
          </View>
        )}

        {/* Top bar overlay */}
        <View style={styles.topBar}>
          <View>
            <Text style={[styles.appTitle, { color: theme.teal }]}>DELATION</Text>
            <Text style={[styles.appSubtitle, { color: theme.muted }]}>
              📍 {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
            </Text>
          </View>
          <View style={styles.topBarRight}>
            {confirmedCount > 0 && (
              <View style={styles.confirmedBadge}>
                <Text style={styles.confirmedText}>✓ {confirmedCount}</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => setIsDark((d) => !d)}
              style={[styles.themeBtn, { backgroundColor: "rgba(0,0,0,0.4)", borderColor: theme.teal }]}
            >
              <Text style={{ fontSize: 14 }}>{isDark ? "☀️" : "🌙"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Report button */}
        <TouchableOpacity
          style={[styles.reportBtn, { backgroundColor: isProcessing ? "#6b7280" : "#dc2626" }]}
          onPress={handleReportPress}
          disabled={isProcessing}
          activeOpacity={0.8}
        >
          <Text style={styles.reportBtnText}>{isProcessing ? "PROCESSING…" : "▶ REPORT INCIDENT"}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Bottom panel ── */}
      <View style={[styles.panel, { backgroundColor: theme.bgPanel, borderTopColor: theme.border }]}>

        {/* Ward risk banner */}
        {wardRisk && (
          <View style={[styles.wardBanner, { backgroundColor: theme.bgCard, borderColor: wardRisk.escalated ? "#ef4444" : theme.border }]}>
            <View style={styles.wardBannerRow}>
              <Text style={[styles.wardBannerLabel, { color: theme.muted }]}>WARD RISK SCORE</Text>
              {wardRisk.escalated && (
                <View style={styles.escalatedBadge}>
                  <Text style={styles.escalatedText}>⚠ PREDICTION CONFIRMED</Text>
                </View>
              )}
            </View>
            <View style={styles.wardBannerScore}>
              <Text style={[styles.wardBannerNum, { color: wardRisk.escalated ? "#ef4444" : theme.teal }]}>
                {wardRisk.score.toFixed(0)}
              </Text>
              <Text style={[styles.wardBannerDenom, { color: theme.muted }]}>/100</Text>
              {wardRisk.escalated && (
                <Text style={[styles.wardBannerNotice, { color: "#ef4444" }]}>  City of Toronto notified</Text>
              )}
            </View>
          </View>
        )}

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

          {/* Top wards list */}
          {wardScores.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.muted }]}>── WARD RISK BRIEFING</Text>
              {wardScores.slice(0, 4).map((w) => (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => setSelectedWard(w)}
                  style={[styles.wardRow, { backgroundColor: theme.bgCard, borderColor: theme.border }]}
                >
                  <View style={[styles.wardDotSmall, { backgroundColor: RISK_COLOR[w.risk_level] }]} />
                  <Text style={[styles.wardName, { color: theme.text }]} numberOfLines={1}>{w.name}</Text>
                  <Text style={[styles.wardScoreText, { color: RISK_COLOR[w.risk_level] }]}>{w.score.toFixed(0)}/100</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Agent pipeline */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>── AGENT PIPELINE</Text>
            <View style={styles.agentRow}>
              <AgentCard {...nodes[0]} detail={nodes[0].detail || MODEL_LABELS.orchestrator} />
              <AgentCard {...nodes[1]} detail={nodes[1].detail || MODEL_LABELS.vision} />
            </View>
            <View style={styles.agentRow}>
              <AgentCard {...nodes[2]} detail={nodes[2].detail || MODEL_LABELS.localizer} />
              <AgentCard {...nodes[3]} detail={nodes[3].detail || MODEL_LABELS.compiler} />
            </View>
          </View>

          {/* Dispatch report */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>── DISPATCH PROTOCOL</Text>
            <View style={[styles.reportBox, { borderColor: theme.border }]}>
              <DispatchReport report={report} isProcessing={isProcessing} />
            </View>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>

      {/* ── Zone detail modal ── */}
      <Modal visible={!!selectedWard} transparent animationType="slide" onRequestClose={() => setSelectedWard(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setSelectedWard(null)} />
        {selectedWard && (
          <View style={[styles.zoneModal, { backgroundColor: theme.bgCard, borderColor: theme.border }]}>
            <View style={styles.zoneModalHandle} />
            <View style={styles.zoneModalHeader}>
              <View style={[styles.riskPill, { backgroundColor: `${RISK_COLOR[selectedWard.risk_level]}22`, borderColor: RISK_COLOR[selectedWard.risk_level] }]}>
                <Text style={[styles.riskPillText, { color: RISK_COLOR[selectedWard.risk_level] }]}>{selectedWard.risk_level}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedWard(null)}>
                <Text style={[styles.closeBtn, { color: theme.muted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.zoneName, { color: theme.text }]}>{selectedWard.name}</Text>

            {/* Score bar */}
            <View style={styles.scoreBarRow}>
              <Text style={[styles.scoreLabel, { color: theme.muted }]}>Risk Score</Text>
              <Text style={[styles.scoreValue, { color: RISK_COLOR[selectedWard.risk_level] }]}>{selectedWard.score.toFixed(0)}/100</Text>
            </View>
            <View style={[styles.scoreBarBg, { backgroundColor: theme.border }]}>
              <View style={[styles.scoreBarFill, { width: `${selectedWard.score}%` as any, backgroundColor: RISK_COLOR[selectedWard.risk_level] }]} />
            </View>

            {/* Risk factors */}
            <View style={styles.factorsGrid}>
              {[
                { label: "Flood Zone",     value: selectedWard.in_flood_zone ? "YES" : "No",       flag: !!selectedWard.in_flood_zone },
                { label: "311 Calls",      value: `${selectedWard.prior_311 ?? 0} nearby`,          flag: (selectedWard.prior_311 ?? 0) > 3 },
                { label: "Watermain Age",  value: selectedWard.watermain_age ? `${selectedWard.watermain_age}yr` : "Unknown", flag: (selectedWard.watermain_age ?? 0) > 50 },
                { label: "Coordinates",    value: `${selectedWard.lat.toFixed(3)}, ${selectedWard.lng.toFixed(3)}`, flag: false },
              ].map((f) => (
                <View key={f.label} style={[styles.factorItem, { backgroundColor: theme.bgPanel, borderColor: theme.border }]}>
                  <Text style={[styles.factorLabel, { color: theme.muted }]}>{f.label}</Text>
                  <Text style={[styles.factorValue, { color: f.flag ? RISK_COLOR[selectedWard.risk_level] : theme.text }]}>{f.value}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.reportFromZoneBtn, { backgroundColor: "#dc2626" }]}
              onPress={() => { setSelectedWard(null); handleReportPress(); }}
            >
              <Text style={styles.reportFromZoneBtnText}>Report Incident in This Zone</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>

      {/* ── Report incident modal ── */}
      <Modal visible={showReportModal} transparent animationType="slide" onRequestClose={() => { setShowReportModal(false); stopRecording(); }}>
        <ReportIncidentSheet
          theme={theme}
          audioStatus={audioStatus}
          onSubmit={handleReportSubmit}
          onCancel={() => { setShowReportModal(false); stopRecording(); }}
        />
      </Modal>
    </SafeAreaView>
  );
}

// ── Report sheet component ────────────────────────────────────────────────────
function ReportIncidentSheet({ theme, audioStatus, onSubmit, onCancel }: {
  theme: any; audioStatus: string;
  onSubmit: (t: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [camMode, setCamMode] = useState<"photo" | "video">("photo");
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRec = () => {
    if (camMode === "video") {
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    }
  };

  const stopRec = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onCancel} />
      <View style={[styles.reportSheet, { backgroundColor: theme.bgCard, borderColor: theme.border }]}>
        <View style={styles.zoneModalHandle} />
        <Text style={[styles.reportSheetTitle, { color: theme.text }]}>Report an Incident</Text>

        {/* Camera preview */}
        <View style={[styles.cameraMiniPreview, { backgroundColor: "#000", borderColor: theme.border }]}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: theme.muted, fontSize: 11, fontFamily: "monospace" }}>📷 Camera feed</Text>
          </View>

          {/* Mode toggle */}
          <View style={{ position: "absolute", top: 6, left: "50%", marginLeft: -40, flexDirection: "row", gap: 4, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 4, paddingVertical: 4, borderRadius: 16 }}>
            {(["photo", "video"] as const).map((m) => (
              <TouchableOpacity key={m} onPress={() => { if (!recording) setCamMode(m); }} disabled={recording}
                style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: camMode === m ? theme.teal : "transparent" }}>
                <Text style={{ fontSize: 11, fontFamily: "monospace", fontWeight: "600", color: camMode === m ? "#fff" : "#9ca3af" }}>
                  {m === "photo" ? "📷" : "🎥"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Capture/record button */}
          {camMode === "photo" && (
            <TouchableOpacity style={{ position: "absolute", bottom: 8, right: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.7)" }}>
              <Text style={{ fontSize: 11, fontFamily: "monospace", fontWeight: "600", color: "#fff" }}>📷 Photo</Text>
            </TouchableOpacity>
          )}

          {camMode === "video" && (
            <TouchableOpacity onPress={recording ? stopRec : startRec}
              style={{ position: "absolute", bottom: 8, right: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: recording ? "#ef4444" : "rgba(0,0,0,0.7)" }}>
              <Text style={{ fontSize: 11, fontFamily: "monospace", fontWeight: "600", color: "#fff" }}>
                {recording ? `⏹ ${fmt(recSeconds)}` : "🎥 Record"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* GPS */}
        <Text style={{ fontSize: 10, fontFamily: "monospace", color: theme.muted, marginVertical: 8 }}>
          📍 43.6532, -79.3832
        </Text>

        {/* Description input */}
        <View style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ fontSize: 10, fontFamily: "monospace", color: theme.muted }}>DESCRIPTION</Text>
            <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontSize: 10, fontFamily: "monospace", color: theme.muted }}>🎤 Speak</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.textInputBox, { backgroundColor: theme.bgPanel, borderColor: theme.border, color: theme.text }]}
            placeholder="Describe what you see — flooding, pothole, fire…"
            placeholderTextColor={theme.muted}
            multiline
            numberOfLines={4}
            value={text}
            onChangeText={setText}
          />
        </View>

        {/* Buttons */}
        <View style={styles.reportSheetBtns}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={onCancel}>
            <Text style={[styles.cancelBtnText, { color: theme.muted }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={() => onSubmit(text)}>
            <Text style={styles.submitBtnText}>Submit Report</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:            { flex: 1 },
  mapContainer:    { height: SCREEN_HEIGHT * 0.48 },
  cameraOverlay:   { position: "absolute", bottom: 56, left: 12 },
  topBar:          { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "rgba(0,0,0,0.55)" },
  appTitle:        { fontFamily: "monospace", fontWeight: "700", fontSize: 16, letterSpacing: 3 },
  appSubtitle:     { fontFamily: "monospace", fontSize: 9, marginTop: 1 },
  topBarRight:     { flexDirection: "row", alignItems: "center", gap: 8 },
  confirmedBadge:  { backgroundColor: "#16a34a33", borderWidth: 1, borderColor: "#22c55e", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  confirmedText:   { color: "#22c55e", fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  themeBtn:        { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  reportBtn:       { position: "absolute", bottom: 12, right: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, shadowColor: "#dc2626", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  reportBtnText:   { color: "#fff", fontFamily: "monospace", fontWeight: "700", fontSize: 12, letterSpacing: 1 },

  panel:           { flex: 1, borderTopWidth: 1 },
  wardBanner:      { margin: 10, borderWidth: 1, borderRadius: 10, padding: 12 },
  wardBannerRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wardBannerLabel: { fontFamily: "monospace", fontSize: 9, letterSpacing: 2 },
  escalatedBadge:  { backgroundColor: "#ef444422", borderWidth: 1, borderColor: "#ef4444", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  escalatedText:   { color: "#ef4444", fontFamily: "monospace", fontSize: 8, fontWeight: "700" },
  wardBannerScore: { flexDirection: "row", alignItems: "baseline", marginTop: 4 },
  wardBannerNum:   { fontSize: 32, fontFamily: "monospace", fontWeight: "700" },
  wardBannerDenom: { fontFamily: "monospace", fontSize: 14, marginLeft: 2 },
  wardBannerNotice:{ fontFamily: "monospace", fontSize: 9, marginLeft: 8 },

  section:         { paddingHorizontal: 10, paddingTop: 8 },
  sectionLabel:    { fontFamily: "monospace", fontSize: 9, letterSpacing: 2, marginBottom: 6 },
  wardRow:         { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 4 },
  wardDotSmall:    { width: 8, height: 8, borderRadius: 4 },
  wardName:        { flex: 1, fontFamily: "monospace", fontSize: 11 },
  wardScoreText:   { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  agentRow:        { flexDirection: "row", marginBottom: 4 },
  reportBox:       { minHeight: 100, borderWidth: 1, borderRadius: 8, padding: 10 },

  // Zone modal
  modalBackdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  zoneModal:       { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 36, maxHeight: SCREEN_HEIGHT * 0.7 },
  zoneModalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#374151", alignSelf: "center", marginBottom: 16 },
  zoneModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  riskPill:        { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  riskPillText:    { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  closeBtn:        { fontSize: 18, padding: 4 },
  zoneName:        { fontFamily: "monospace", fontWeight: "700", fontSize: 16, marginBottom: 14 },
  scoreBarRow:     { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  scoreLabel:      { fontFamily: "monospace", fontSize: 11 },
  scoreValue:      { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  scoreBarBg:      { height: 6, borderRadius: 3, marginBottom: 14 },
  scoreBarFill:    { height: 6, borderRadius: 3 },
  factorsGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  factorItem:      { width: "47%", padding: 10, borderRadius: 8, borderWidth: 1 },
  factorLabel:     { fontFamily: "monospace", fontSize: 9, letterSpacing: 1, marginBottom: 4 },
  factorValue:     { fontFamily: "monospace", fontSize: 12, fontWeight: "600" },
  reportFromZoneBtn:  { borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  reportFromZoneBtnText: { color: "#fff", fontFamily: "monospace", fontWeight: "700", fontSize: 13 },

  // Report sheet
  reportSheet:        { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 40 },
  reportSheetTitle:   { fontFamily: "monospace", fontWeight: "700", fontSize: 15, marginBottom: 8 },
  cameraMiniPreview:  { height: 140, borderRadius: 10, marginBottom: 10, overflow: "hidden" },
  textInputBox:       { borderWidth: 1, borderRadius: 10, padding: 14, minHeight: 80, marginBottom: 12 },
  textInputPlaceholder: { fontFamily: "monospace", fontSize: 13, lineHeight: 20 },
  reportSheetBtns:    { flexDirection: "row", gap: 10 },
  cancelBtn:          { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelBtnText:      { fontFamily: "monospace", fontSize: 13 },
  submitBtn:          { flex: 2, backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  submitBtnText:      { color: "#fff", fontFamily: "monospace", fontWeight: "700", fontSize: 13 },

  wardBanner2:        { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 8 },
  confirmedBadge2:    { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
});
