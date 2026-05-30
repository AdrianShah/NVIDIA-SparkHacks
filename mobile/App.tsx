import { Audio, Video, ResizeMode } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions, Image, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { WardScore, BuildingPoint, SpatialData } from "./components/MapView";
import AgentCard, { NodeStatus } from "./components/AgentCard";
import CameraCapture from "./components/CameraCapture";
import DispatchReport from "./components/DispatchReport";
import { mapSharedIncidents, type SharedIncident } from "./lib/incidents";
import {
  finalizeIncident,
  IncidentFlowError,
  predictIncident,
  wardRiskScore,
  type FinalizeResult,
  type PredictResult,
} from "./lib/incident-flow";
import { normalizeWards } from "./lib/wards";
import PredictionConfirmationCard from "./components/PredictionConfirmationCard";
import { API_URL as CONFIGURED_API_URL } from "./config/api";

const API_URL = CONFIGURED_API_URL || "http://localhost:8080";
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
  localizer:    "GeoPandas ? GPU",
  compiler:     "Nemotron 30B",
};

const RISK_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444", HIGH: "#f97316", ELEVATED: "#eab308", LOW: "#22c55e",
};

export default function App() {
  // ?? Theme ????????????????????????????????????????????????????????????????????
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

  // ?? State ?????????????????????????????????????????????????????????????????????
  const [gps, setGps]             = useState({ lat: 43.6532, lng: -79.3832 });
  const [wardScores, setWardScores] = useState<WardScore[]>([]);
  const [buildings, setBuildings] = useState<BuildingPoint[]>([]);
  const [selectedWard, setSelectedWard] = useState<WardScore | null>(null);
  const [incidents, setIncidents]  = useState<any[]>([]);
  const [nodes, setNodes]          = useState<AgentNodeDef[]>(INITIAL_NODES);
  const [report, setReport]        = useState("");
  const [spatial, setSpatial]      = useState<SpatialData | null>(null);
  const [urgency, setUrgency]      = useState<UrgencyLevel>("LOW");
  const [isProcessing, setIsProcessing] = useState(false);
  const [wardRisk, setWardRisk]    = useState<{ score: number; escalated: boolean } | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [confirmedCount, setConfirmedCount]   = useState(0);
  const [capturePaused, setCapturePaused]     = useState(false);

  const currentFrameRef  = useRef<string | null>(null);
  const isProcessingRef  = useRef(false);
  const recordingRef     = useRef<Audio.Recording | null>(null);
  const watchIdRef       = useRef<Location.LocationSubscription | null>(null);

  // ?? Live GPS ??????????????????????????????????????????????????????????????????
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

  // ?? Fetch ward scores (live backend only) ?????????????????????????????????????
  const refreshRiskMap = useCallback(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch(`${API_URL}/api/risk-map`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setWardScores(normalizeWards(d.wards ?? [])))
      .catch(() => setWardScores([]))
      .finally(() => clearTimeout(timer));
    fetch(`${API_URL}/api/buildings`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => { if (d.buildings?.length) setBuildings(d.buildings); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRiskMap();
    const interval = setInterval(refreshRiskMap, 30000);
    return () => clearInterval(interval);
  }, [refreshRiskMap]);

  // ?? Sync incidents with web dashboard (shared backend feed) ???????????????????
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      fetch(`${API_URL}/api/incidents`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setIncidents(mapSharedIncidents((d.incidents ?? []) as SharedIncident[]));
        })
        .catch(() => {});
    };
    sync();
    const interval = setInterval(sync, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return;
    try { await rec.stopAndUnloadAsync(); } catch {}
  }, []);

  // ?? Apply finalized dispatch report to dashboard state ???????????????????????
  const applyFinalizeResult = useCallback(async (data: FinalizeResult) => {
    if (data.legitimate === false) {
      setNodes(INITIAL_NODES.map((n) => ({
        ...n, status: "error",
        detail: n.name === "orchestrator" ? "Not verified" : "",
      })));
      setReport("? Report not verified. Please provide more detail.");
      return;
    }

    setNodes(INITIAL_NODES.map((n) => ({
      ...n, status: "complete",
      detail: n.name === "vision"    ? `${(data.vision as { hazard_type?: string })?.hazard_type ?? ""} ? ${(data.vision as { severity_scale?: number })?.severity_scale ?? "?"}/10`
            : n.name === "localizer" ? `Hydrant: ${(data.spatial as { closest_hydrants?: { distance_meters?: number }[] })?.closest_hydrants?.[0]?.distance_meters ?? "?"}m`
            : n.name === "compiler"  ? `Risk: ${wardRiskScore(data.ward_risk).toFixed(0)}${data.escalated ? " ?" : ""}`
            : "",
    })));
    setReport(data.report ?? "");
    setUrgency((data.urgency as UrgencyLevel) ?? "HIGH");
    setSpatial((data.spatial ?? null) as SpatialData | null);
    const score = wardRiskScore(data.ward_risk);
    setWardRisk({ score, escalated: data.escalated ?? false });
    if (data.escalated) setConfirmedCount((c) => c + 1);

    fetch(`${API_URL}/api/incidents`)
      .then((r) => r.json())
      .then((d) => {
        if (d.incidents) setIncidents(mapSharedIncidents(d.incidents as SharedIncident[]));
      })
      .catch(() => {});

    refreshRiskMap();
  }, [refreshRiskMap]);

  const resetProcessingState = useCallback(() => {
    setIsProcessing(false);
    setCapturePaused(false);
    isProcessingRef.current = false;
  }, []);

  const beginFinalizePipeline = useCallback(() => {
    isProcessingRef.current = true;
    setIsProcessing(true);
    setCapturePaused(true);
    setNodes(INITIAL_NODES.map((n) => ({ ...n, status: "idle", detail: "" })));
    setNodes((p) => p.map((n) => n.name === "orchestrator" ? { ...n, status: "active" } : n));
  }, []);

  const handleHitlComplete = useCallback(async (data: FinalizeResult) => {
    try {
      await applyFinalizeResult(data);
    } finally {
      resetProcessingState();
      setShowReportModal(false);
    }
  }, [applyFinalizeResult, resetProcessingState]);

  const handleHitlError = useCallback(() => {
    setNodes((p) => p.map((n) => n.status === "active" ? { ...n, status: "error" } : n));
    resetProcessingState();
  }, [resetProcessingState]);

  const handleReportPress = () => setShowReportModal(true);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* ?? Map (top 48%) ?? */}
      <View style={styles.mapContainer}>
        <MapView
          gps={gps}
          wardScores={wardScores}
          buildings={buildings}
          spatial={spatial}
          incidents={incidents}
          isDark={isDark}
          isActive={isProcessing}
          urgency={urgency}
          onWardPress={setSelectedWard}
        />

        {/* Camera preview ? only shown when actively processing */}
        {isProcessing && (
          <View style={styles.cameraOverlay}>
            <CameraCapture
              isActive={isProcessing}
              paused={capturePaused}
              onFrame={(f) => { currentFrameRef.current = f; }}
            />
          </View>
        )}

        {/* Top bar overlay */}
        <View style={styles.topBar}>
          <View>
            <Text style={[styles.appTitle, { color: theme.teal }]}>DELATION</Text>
            <Text style={[styles.appSubtitle, { color: theme.muted }]}>
              ?? {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}
            </Text>
          </View>
          <View style={styles.topBarRight}>
            {confirmedCount > 0 && (
              <View style={styles.confirmedBadge}>
                <Text style={styles.confirmedText}>? {confirmedCount}</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => setIsDark((d) => !d)}
              style={[styles.themeBtn, { backgroundColor: "rgba(0,0,0,0.4)", borderColor: theme.teal }]}
            >
              <Text style={{ fontSize: 14 }}>{isDark ? "??" : "??"}</Text>
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
          <Text style={styles.reportBtnText}>{isProcessing ? "PROCESSING?" : "? REPORT INCIDENT"}</Text>
        </TouchableOpacity>
      </View>

      {/* ?? Bottom panel ?? */}
      <View style={[styles.panel, { backgroundColor: theme.bgPanel, borderTopColor: theme.border }]}>

        {/* Ward risk banner */}
        {wardRisk && (
          <View style={[styles.wardBanner, { backgroundColor: theme.bgCard, borderColor: wardRisk.escalated ? "#ef4444" : theme.border }]}>
            <View style={styles.wardBannerRow}>
              <Text style={[styles.wardBannerLabel, { color: theme.muted }]}>WARD RISK SCORE</Text>
              {wardRisk.escalated && (
                <View style={styles.escalatedBadge}>
                  <Text style={styles.escalatedText}>? PREDICTION CONFIRMED</Text>
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
              <Text style={[styles.sectionLabel, { color: theme.muted }]}>?? WARD RISK BRIEFING</Text>
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
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>?? AGENT PIPELINE</Text>
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
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>?? DISPATCH PROTOCOL</Text>
            <View style={[styles.reportBox, { borderColor: theme.border }]}>
              <DispatchReport report={report} isProcessing={isProcessing} />
            </View>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>

      {/* ?? Zone detail modal ?? */}
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
                <Text style={[styles.closeBtn, { color: theme.muted }]}>?</Text>
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

      {/* ?? Report incident modal ?? */}
      <Modal visible={showReportModal} transparent animationType="slide" onRequestClose={() => setShowReportModal(false)}>
        <ReportIncidentSheet
          theme={theme}
          gps={gps}
          onCancel={() => setShowReportModal(false)}
          onPredictionReady={() => {
            setIsProcessing(true);
            setCapturePaused(true);
          }}
          onBeginFinalize={beginFinalizePipeline}
          onComplete={handleHitlComplete}
          onError={handleHitlError}
          onScannerReset={resetProcessingState}
          stopRecording={stopRecording}
        />
      </Modal>
    </SafeAreaView>
  );
}

// ?? Report sheet ?????????????????????????????????????????????????????????????
type VideoState = "idle" | "recording" | "paused" | "preview" | "kept";
type PhotoState = "idle" | "preview" | "kept";
type CardPhase = "confirm" | "correct" | "finalizing" | "error";

function ReportIncidentSheet({ theme, gps, onCancel, onPredictionReady, onBeginFinalize, onComplete, onError, onScannerReset, stopRecording }: {
  theme: any;
  gps: { lat: number; lng: number };
  onCancel: () => void;
  onPredictionReady: () => void;
  onBeginFinalize: () => void;
  onComplete: (data: FinalizeResult) => void;
  onError: () => void;
  onScannerReset: () => void;
  stopRecording: () => Promise<void>;
}) {
  const [text, setText]           = useState("");
  const [camMode, setCamMode]     = useState<"photo" | "video">("photo");
  const [photoState, setPhotoState] = useState<PhotoState>("idle");
  const [photoUri, setPhotoUri]   = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState>("idle");
  const [videoUri, setVideoUri]   = useState<string | null>(null);
  const [videoSecs, setVideoSecs] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micSecs, setMicSecs]     = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [prediction, setPrediction]     = useState<PredictResult | null>(null);
  const [cardPhase, setCardPhase]       = useState<CardPhase>("confirm");
  const [flowError, setFlowError]       = useState("");
  const [predicting, setPredicting]     = useState(false);

  const [permission] = useCameraPermissions();
  const cameraRef     = useRef<CameraView>(null);
  const frameB64Ref   = useRef<string>("");
  const chunkAudioRef = useRef<Audio.Recording | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const clearPrediction = () => {
    setPrediction(null);
    setCardPhase("confirm");
    setFlowError("");
    setPredicting(false);
  };

  const resetToScannerView = () => {
    clearPrediction();
    setPhotoUri(null);
    setPhotoState("idle");
    setVideoUri(null);
    setVideoState("idle");
    frameB64Ref.current = "";
    onScannerReset();
  };

  const friendlyFlowError = (err: unknown, phase: "predict" | "finalize"): string => {
    if (err instanceof IncidentFlowError) {
      if (phase === "finalize" && err.status === 404) {
        return "Session expired ? snap a new frame to continue.";
      }
      if (phase === "finalize" && err.status === 422) {
        return "Describe the hazard before submitting your correction.";
      }
      return err.message;
    }
    if (phase === "finalize") {
      return "Report compilation failed ? snap a new frame to continue.";
    }
    return err instanceof Error ? err.message : "Prediction failed";
  };

  const runPredict = async (frameB64: string) => {
    if (!frameB64 || predicting) return;
    setPredicting(true);
    setFlowError("");
    try {
      const result = await predictIncident(frameB64, gps);
      setPrediction(result);
      setCardPhase("confirm");
      onPredictionReady();
    } catch (err) {
      setFlowError(friendlyFlowError(err, "predict"));
      setCardPhase("error");
    } finally {
      setPredicting(false);
    }
  };

  const runFinalize = async (confirmed: boolean, userCorrection?: string) => {
    if (!prediction || cardPhase === "finalizing") return;
    if (!confirmed && !(userCorrection ?? "").trim()) return;
    setCardPhase("finalizing");
    setFlowError("");
    onBeginFinalize();
    await stopRecording();
    try {
      const data = await finalizeIncident({
        prediction_id: prediction.prediction_id,
        confirmed,
        gps,
        user_correction: userCorrection,
      });
      clearPrediction();
      await onComplete(data);
    } catch (err) {
      setFlowError(friendlyFlowError(err, "finalize"));
      setCardPhase("error");
      onError();
    }
  };

  const clearVideoTimer = () => {
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
  };

  // ?? 1. PHOTO ?????????????????????????????????????????????????????????????????
  const takePhoto = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.8 });
      if (photo?.uri && photo.base64) {
        setPhotoUri(photo.uri);
        frameB64Ref.current = photo.base64;
        setPhotoState("preview");
        await runPredict(photo.base64);
      }
    } catch {}
  };

  const keepPhoto = () => setPhotoState("kept");
  const retakePhoto = () => {
    resetToScannerView();
  };

  // ?? 2. VIDEO ??????????????????????????????????????????????????????????????????
  const startVideoRec = async () => {
    setVideoUri(null);
    setVideoSecs(0);
    setVideoState("recording");
    videoTimerRef.current = setInterval(() => setVideoSecs(s => s + 1), 1000);
    try {
      const result = await cameraRef.current?.recordAsync({ maxDuration: 120 });
      clearVideoTimer();
      if (result?.uri) {
        setVideoUri(result.uri);
        setVideoState("preview");
        // Grab a still frame for the AI submission
        try {
          const p = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.6 });
          if (p?.base64) {
            frameB64Ref.current = p.base64;
            await runPredict(p.base64);
          }
        } catch {}
      } else {
        setVideoState("idle");
      }
    } catch { clearVideoTimer(); setVideoState("idle"); }
  };

  const pauseVideoRec = () => {
    // Stop recording ? goes to paused (timer frozen, no preview yet)
    cameraRef.current?.stopRecording();
    clearVideoTimer();
    setVideoState("paused");
  };

  const resumeVideoRec = () => startVideoRec();   // new segment, same UX

  const stopVideoRec = () => {
    cameraRef.current?.stopRecording();
    clearVideoTimer();
    // recordAsync promise resolves ? sets preview
  };

  const keepVideo = () => setVideoState("kept");
  const redoVideo = () => {
    resetToScannerView();
  };

  // ?? 3. SPEECH ? real-time transcript ?????????????????????????????????????????
  const transcribeChunk = async (uri: string) => {
    setTranscribing(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const res = await fetch(`${API_URL}/api/transcribe`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_b64: b64, format: "m4a" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text?.trim())
          setText(prev => prev ? `${prev} ${data.text.trim()}` : data.text.trim());
      }
    } catch {}
    setTranscribing(false);
  };

  const startMic = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      chunkAudioRef.current = recording;
      setMicActive(true); setMicSecs(0);
      micTimerRef.current = setInterval(() => setMicSecs(s => s + 1), 1000);
      // flush chunk every 5 s
      chunkTimerRef.current = setInterval(async () => {
        const cur = chunkAudioRef.current;
        if (!cur) return;
        try {
          await cur.stopAndUnloadAsync();
          const uri = cur.getURI();
          if (uri) transcribeChunk(uri);
          const { recording: next } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
          chunkAudioRef.current = next;
        } catch {}
      }, 5000);
    } catch {}
  };

  const stopMic = async () => {
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    if (micTimerRef.current)   { clearInterval(micTimerRef.current);   micTimerRef.current   = null; }
    const cur = chunkAudioRef.current;
    chunkAudioRef.current = null;
    if (cur) {
      try {
        await cur.stopAndUnloadAsync();
        const uri = cur.getURI();
        if (uri) await transcribeChunk(uri);
      } catch {}
    }
    setMicActive(false);
  };

  const handleCancel = async () => {
    if (micActive) await stopMic();
    if (videoState === "recording") stopVideoRec();
    resetToScannerView();
    onCancel();
  };

  // Derived booleans
  const hitlActive = !!prediction || predicting;
  const showLiveCamera = !hitlActive && (
    (camMode === "photo" && photoState === "idle") ||
    (camMode === "video" && (videoState === "idle" || videoState === "recording" || videoState === "paused"))
  );

  const T = theme; // shorthand

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, justifyContent: "flex-end" }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleCancel} />
      <View style={[styles.reportSheet, { backgroundColor: T.bgCard, borderColor: T.border }]}>
        <View style={styles.zoneModalHandle} />
        <Text style={[styles.reportSheetTitle, { color: T.text }]}>Report an Incident</Text>

        {/* ?? Square media area ?? */}
        <View style={[styles.squareMedia, { borderColor: T.border }]}>
          {predicting && (
            <View style={styles.predictOverlay}>
              <ActivityIndicator color={T.teal} />
              <Text style={[styles.predictOverlayText, { color: T.teal }]}>MAVERICK ANALYZING?</Text>
            </View>
          )}

          {/* PHOTO: idle / preview / kept */}
          {camMode === "photo" && photoState !== "idle" && (
            <>
              <Image source={{ uri: photoUri! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              {photoState === "kept" && (
                <View style={styles.keptBadge}><Text style={styles.keptText}>? Kept</Text></View>
              )}
              {photoState !== "kept" && (
                <View style={styles.previewActions}>
                  <TouchableOpacity onPress={retakePhoto} style={[styles.previewBtn, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
                    <Text style={styles.previewBtnText}>?? Retake</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={keepPhoto} style={[styles.previewBtn, { backgroundColor: "#22c55e" }]}>
                    <Text style={styles.previewBtnText}>? Keep</Text>
                  </TouchableOpacity>
                </View>
              )}
              {photoState === "kept" && (
                <TouchableOpacity onPress={retakePhoto} style={[styles.camActionBtn, { right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.6)" }]}>
                  <Text style={styles.camActionText}>?? Change</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* VIDEO: preview / kept */}
          {camMode === "video" && (videoState === "preview" || videoState === "kept") && (
            <>
              <Video source={{ uri: videoUri! }} style={StyleSheet.absoluteFill}
                useNativeControls resizeMode={ResizeMode.COVER} shouldPlay={false} />
              {videoState === "kept" && (
                <View style={styles.keptBadge}><Text style={styles.keptText}>? Kept</Text></View>
              )}
              {videoState !== "kept" && (
                <View style={styles.previewActions}>
                  <TouchableOpacity onPress={redoVideo} style={[styles.previewBtn, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
                    <Text style={styles.previewBtnText}>?? Redo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={keepVideo} style={[styles.previewBtn, { backgroundColor: "#22c55e" }]}>
                    <Text style={styles.previewBtnText}>? Keep</Text>
                  </TouchableOpacity>
                </View>
              )}
              {videoState === "kept" && (
                <TouchableOpacity onPress={redoVideo} style={[styles.camActionBtn, { right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.6)" }]}>
                  <Text style={styles.camActionText}>?? Change</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* LIVE CAMERA */}
          {showLiveCamera && (
            permission?.granted
              ? <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
              : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: T.muted, fontFamily: "monospace", fontSize: 11 }}>Camera permission needed</Text>
                </View>
          )}

          {/* Mode toggle (only when no media kept) */}
          {showLiveCamera && videoState !== "recording" && (
            <View style={styles.modeToggle}>
              {(["photo", "video"] as const).map(m => (
                <TouchableOpacity key={m} onPress={() => setCamMode(m)}
                  style={{ paddingHorizontal: 14, paddingVertical: 4, borderRadius: 14,
                    backgroundColor: camMode === m ? T.teal : "transparent" }}>
                  <Text style={{ fontSize: 13, color: camMode === m ? "#fff" : "#9ca3af" }}>
                    {m === "photo" ? "??" : "??"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Photo: capture button */}
          {showLiveCamera && camMode === "photo" && (
            <TouchableOpacity onPress={takePhoto}
              style={[styles.camActionBtn, { bottom: 10, right: 10, backgroundColor: "rgba(0,0,0,0.7)" }]}>
              <Text style={styles.camActionText}>?? Capture</Text>
            </TouchableOpacity>
          )}

          {/* Video: idle ? Record */}
          {camMode === "video" && videoState === "idle" && (
            <TouchableOpacity onPress={startVideoRec}
              style={[styles.camActionBtn, { bottom: 10, right: 10, backgroundColor: "rgba(0,0,0,0.7)" }]}>
              <Text style={styles.camActionText}>?? Record</Text>
            </TouchableOpacity>
          )}

          {/* Video: recording ? timer + Pause + Stop */}
          {camMode === "video" && videoState === "recording" && (
            <>
              <View style={styles.recIndicator}>
                <View style={styles.recDot} />
                <Text style={styles.recTimer}>REC  {fmt(videoSecs)}</Text>
              </View>
              <View style={[styles.previewActions, { bottom: 10 }]}>
                <TouchableOpacity onPress={pauseVideoRec}
                  style={[styles.previewBtn, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
                  <Text style={styles.previewBtnText}>? Pause</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={stopVideoRec}
                  style={[styles.previewBtn, { backgroundColor: "#ef4444" }]}>
                  <Text style={styles.previewBtnText}>? Stop</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Video: paused ? timer frozen + Resume + Stop */}
          {camMode === "video" && videoState === "paused" && (
            <>
              <View style={styles.recIndicator}>
                <Text style={[styles.recTimer, { color: "#f97316" }]}>? PAUSED  {fmt(videoSecs)}</Text>
              </View>
              <View style={[styles.previewActions, { bottom: 10 }]}>
                <TouchableOpacity onPress={resumeVideoRec}
                  style={[styles.previewBtn, { backgroundColor: T.teal }]}>
                  <Text style={styles.previewBtnText}>? Resume</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={redoVideo}
                  style={[styles.previewBtn, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
                  <Text style={styles.previewBtnText}>? Discard</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* GPS */}
        <Text style={{ fontSize: 10, fontFamily: "monospace", color: T.muted, marginTop: 8, marginBottom: 6 }}>
          ?? {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
        </Text>

        {flowError && !prediction && (
          <View style={[styles.hitlErrorBanner, { borderColor: "#ef4444" }]}>
            <Text style={styles.hitlErrorText}>{flowError}</Text>
            <TouchableOpacity onPress={resetToScannerView} style={{ marginTop: 8 }}>
              <Text style={{ color: T.teal, fontFamily: "monospace", fontSize: 11, fontWeight: "700" }}>
                Re-snap hazard
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Description + Speak */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <Text style={{ fontSize: 10, fontFamily: "monospace", color: T.muted }}>
            {transcribing ? "TRANSCRIBING?" : "DESCRIPTION"}
          </Text>
          <TouchableOpacity onPress={micActive ? stopMic : startMic}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
              paddingVertical: 4, borderRadius: 12, borderWidth: 1,
              borderColor: micActive ? "#ef4444" : T.border }}>
            {micActive && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#ef4444" }} />}
            <Text style={{ fontSize: 11, fontFamily: "monospace", color: micActive ? "#ef4444" : T.muted }}>
              {micActive ? `${fmt(micSecs)}  Stop` : "?? Speak"}
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={[styles.textInputBox, {
            backgroundColor: T.bgPanel,
            borderColor: micActive ? T.teal : T.border,
            color: T.text,
          }]}
          placeholder={micActive ? "Listening? speak now" : "Describe what you see ? flooding, pothole, fire?"}
          placeholderTextColor={T.muted}
          multiline numberOfLines={3}
          value={text} onChangeText={setText}
        />

        {/* Submit / Cancel */}
        <View style={styles.reportSheetBtns}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: T.border }]} onPress={handleCancel}>
            <Text style={[styles.cancelBtnText, { color: T.muted }]}>Cancel</Text>
          </TouchableOpacity>
          {!prediction && !predicting && (
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: T.bgPanel, borderWidth: 1, borderColor: T.border }]}
              onPress={async () => {
                if (micActive) await stopMic();
                if (!frameB64Ref.current) {
                  try {
                    const p = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.6 });
                    if (p?.base64) {
                      frameB64Ref.current = p.base64;
                      await runPredict(p.base64);
                    }
                  } catch {}
                }
              }}
            >
              <Text style={[styles.submitBtnText, { color: T.muted }]}>Capture for analysis</Text>
            </TouchableOpacity>
          )}
        </View>

        <PredictionConfirmationCard
          visible={!!prediction}
          prediction={prediction}
          theme={T}
          phase={cardPhase}
          errorMessage={flowError}
          onConfirm={() => runFinalize(true)}
          onStartCorrect={() => setCardPhase("correct")}
          onSubmitCorrection={(correction) => runFinalize(false, correction)}
          onDismissError={resetToScannerView}
        />
      </View>
    </KeyboardAvoidingView>
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
  reportSheet:        { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 40, position: "relative" },
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

  // Report sheet ? media controls
  squareMedia:     { width: "100%", aspectRatio: 1, borderRadius: 12, borderWidth: 1, overflow: "hidden", backgroundColor: "#000", marginBottom: 2 },
  previewActions:  { position: "absolute", bottom: 10, flexDirection: "row", gap: 8, alignSelf: "center", left: "50%", marginLeft: -74 },
  previewBtn:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18 },
  previewBtnText:  { color: "#fff", fontSize: 12, fontFamily: "monospace", fontWeight: "600" },
  camActionBtn:    { position: "absolute", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  camActionText:   { color: "#fff", fontSize: 12, fontFamily: "monospace", fontWeight: "600" },
  modeToggle:      { position: "absolute", top: 10, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.65)", padding: 3, borderRadius: 18, alignSelf: "center", left: "50%", marginLeft: -42 },
  keptBadge:       { position: "absolute", top: 10, left: 10, backgroundColor: "#16a34a", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  keptText:        { color: "#fff", fontSize: 11, fontFamily: "monospace", fontWeight: "700" },
  recIndicator:    { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  recDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  recTimer:        { color: "#fff", fontSize: 11, fontFamily: "monospace", fontWeight: "600" },
  predictOverlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,15,20,0.82)", alignItems: "center", justifyContent: "center", gap: 10, zIndex: 5 },
  predictOverlayText: { fontFamily: "monospace", fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  hitlErrorBanner: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: "#ef444411" },
  hitlErrorText:   { color: "#fca5a5", fontFamily: "monospace", fontSize: 11 },
});
