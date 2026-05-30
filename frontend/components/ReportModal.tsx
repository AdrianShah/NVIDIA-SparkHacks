"use client";
import { useEffect, useRef, useState } from "react";
import { X, Camera, Video, Mic, MicOff, Send, CheckCircle, XCircle, Loader2, Square } from "lucide-react";

interface Props {
  onClose:     () => void;
  initialGps?: { lat: number; lng: number };
  onSubmit:    (transcript: string, frame_b64: string, gps: { lat: number; lng: number }) => Promise<{ legitimate: boolean; urgency: string }>;
}

type Step    = "input" | "submitting" | "verified" | "rejected";
type CamMode = "photo" | "video";

export default function ReportModal({ onClose, initialGps, onSubmit }: Props) {
  const [step,       setStep]       = useState<Step>("input");
  const [camMode,    setCamMode]    = useState<CamMode>("photo");
  const [transcript, setTranscript] = useState("");
  const [gps,        setGps]        = useState(initialGps ?? { lat: 43.6532, lng: -79.3832 });
  const [camError,   setCamError]   = useState(false);
  const [captured,   setCaptured]   = useState<string>("");        // base64 JPEG frame
  const [recording,  setRecording]  = useState(false);             // mic OR video
  const [recSeconds, setRecSeconds] = useState(0);
  const [urgency,    setUrgency]    = useState("");
  const [speechText, setSpeechText] = useState("");

  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const vidRecRef   = useRef<MediaRecorder | null>(null);
  const micRecRef   = useRef<MediaRecorder | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameIntRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Start camera on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!initialGps) {
      navigator.geolocation?.getCurrentPosition(
        (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
        ()  => {}
      );
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(true);
    } else {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true })
        .then((s) => {
          streamRef.current = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch(() => setCamError(true));
    }

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current)    clearInterval(timerRef.current);
      if (frameIntRef.current) clearInterval(frameIntRef.current);
    };
  }, []); // eslint-disable-line

  // ── Capture still photo ─────────────────────────────────────────────────────
  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
    c.getContext("2d")?.drawImage(v, 0, 0);
    setCaptured(c.toDataURL("image/jpeg", 0.8).split(",")[1]);
  };

  // ── Video recording ─────────────────────────────────────────────────────────
  const startVideoRec = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = ["video/webm;codecs=vp8", "video/webm", "video/mp4", ""]
      .find((t) => !t || MediaRecorder.isTypeSupported(t)) ?? "";
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    vidRecRef.current = mr;
    setRecSeconds(0);
    setRecording(true);
    timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    // Grab a frame every second while recording — last one becomes the frame_b64
    frameIntRef.current = setInterval(() => capturePhoto(), 1000);
    mr.start();
  };

  const stopVideoRec = () => {
    vidRecRef.current?.stop();
    if (timerRef.current)    clearInterval(timerRef.current);
    if (frameIntRef.current) clearInterval(frameIntRef.current);
    setRecording(false);
  };

  // ── Mic / speech recording ──────────────────────────────────────────────────
  const startMicRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        // Use Web Speech API transcript if available, otherwise keep typed text
      };
      mr.start();
      micRecRef.current = mr;
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);

      // Web Speech API for live transcription
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recog = new SpeechRecognition();
        recog.continuous = true;
        recog.interimResults = true;
        recog.onresult = (e: any) => {
          const t = Array.from(e.results).map((r: any) => r[0].transcript).join(" ");
          setSpeechText(t);
          setTranscript(t);
        };
        recog.start();
        (micRecRef as any).recog = recog;
      }
    } catch { /* mic denied */ }
  };

  const stopMicRec = () => {
    micRecRef.current?.stop();
    (micRecRef as any).recog?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  };

  const handleRecordToggle = () => {
    if (camMode === "video") { recording ? stopVideoRec() : startVideoRec(); }
    else                     { recording ? stopMicRec()   : startMicRec(); }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!transcript.trim() && !captured) return;
    if (recording) { camMode === "video" ? stopVideoRec() : stopMicRec(); }
    setStep("submitting");
    const frame = captured || (() => {
      const v = videoRef.current;
      if (!v) return "";
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
      c.getContext("2d")?.drawImage(v, 0, 0);
      return c.toDataURL("image/jpeg", 0.8).split(",")[1];
    })();
    try {
      const result = await onSubmit(transcript || "Incident reported via camera", frame, gps);
      setUrgency(result.urgency);
      setStep(result.legitimate ? "verified" : "rejected");
    } catch { setStep("rejected"); }
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.7)" }}>
      <div style={{ width: "100%", maxHeight: "95vh", overflow: "auto", borderRadius: "20px 20px 0 0", background: "var(--bg-card)", border: "1px solid var(--border)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Report an Incident</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {step === "input" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Camera preview */}
            <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", aspectRatio: "16/9" }}>
              {camError
                ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, padding: 16 }}>
                    <Camera size={24} style={{ color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", fontFamily: "monospace" }}>
                      Camera unavailable
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "center", maxWidth: 220 }}>
                      {typeof window !== "undefined" && location.protocol !== "https:" && !location.hostname.includes("localhost")
                        ? "⚠ Camera requires HTTPS. Open the app via HTTPS or use text description below."
                        : "Check browser camera permissions and try again."}
                    </span>
                  </div>
                : <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              }

              {/* Mode tabs */}
              <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, background: "rgba(0,0,0,0.6)", padding: "4px", borderRadius: 20 }}>
                {(["photo", "video"] as CamMode[]).map((m) => (
                  <button key={m} onClick={() => { if (!recording) setCamMode(m); }}
                    style={{ padding: "4px 14px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600,
                      background: camMode === m ? "var(--teal)" : "transparent", color: camMode === m ? "#fff" : "#9ca3af" }}>
                    {m === "photo" ? "📷 Photo" : "🎥 Video"}
                  </button>
                ))}
              </div>

              {/* Capture / record button */}
              {!camError && (
                <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", gap: 8 }}>
                  {camMode === "photo" && !recording && (
                    <button onClick={capturePhoto}
                      style={{ padding: "6px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600,
                        background: captured ? "#22c55e" : "rgba(0,0,0,0.7)", color: "#fff" }}>
                      {captured ? "✓ Photo taken" : "📷 Take photo"}
                    </button>
                  )}
                  {camMode === "video" && (
                    <button onClick={handleRecordToggle}
                      style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600,
                        background: recording ? "#ef4444" : "rgba(0,0,0,0.7)", color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                      {recording ? <><Square size={10} fill="#fff" /> {fmt(recSeconds)}</> : <><Video size={12} /> Record</>}
                    </button>
                  )}
                </div>
              )}

              {/* Recording indicator */}
              {recording && camMode === "video" && (
                <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.6)", padding: "4px 10px", borderRadius: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite", display: "inline-block" }} />
                  <span style={{ color: "#fff", fontFamily: "monospace", fontSize: 11 }}>REC {fmt(recSeconds)}</span>
                </div>
              )}
            </div>

            {/* GPS */}
            <p style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", margin: 0 }}>
              📍 {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            </p>

            {/* Description */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>DESCRIPTION</span>
                <button onClick={handleRecordToggle}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, border: `1px solid ${recording && camMode !== "video" ? "#ef4444" : "var(--border)"}`,
                    background: "transparent", cursor: "pointer", fontSize: 11, fontFamily: "monospace",
                    color: recording && camMode !== "video" ? "#ef4444" : "var(--text-muted)" }}>
                  {recording && camMode !== "video" ? <><MicOff size={12} /> {fmt(recSeconds)} Stop</> : <><Mic size={12} /> Speak</>}
                </button>
              </div>
              <textarea
                style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", padding: "10px 12px", fontSize: 13,
                  background: "var(--bg)", color: "var(--text)", resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                placeholder="Describe what you see — flooding, pothole, fire, construction hazard…"
                rows={3}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              {speechText && <p style={{ fontSize: 10, color: "var(--teal)", fontFamily: "monospace", marginTop: 4 }}>🎤 Live transcript: {speechText.slice(-60)}</p>}
            </div>

            {/* Submit */}
            <button onClick={handleSubmit}
              disabled={!transcript.trim() && !captured}
              style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "monospace",
                background: "var(--red)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: (!transcript.trim() && !captured) ? 0.4 : 1 }}>
              <Send size={15} /> Submit Report
            </button>
          </div>
        )}

        {/* Submitting */}
        {step === "submitting" && (
          <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <Loader2 size={40} style={{ color: "var(--teal)", animation: "spin 1s linear infinite" }} />
            <p style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 13 }}>AI verifying report…</p>
            <div style={{ display: "flex", gap: 24 }}>
              {["Orchestrator", "Vision", "Localizer", "Compiler"].map((n) => (
                <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--teal)", animation: "pulse 1s infinite", display: "block" }} />
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)" }}>{n}</span>
                </div>
              ))}
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
          </div>
        )}

        {/* Verified */}
        {step === "verified" && (
          <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <CheckCircle size={48} style={{ color: "#22c55e" }} />
            <p style={{ fontWeight: 700, color: "#22c55e", fontSize: 16 }}>Incident Verified</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 280 }}>
              Classified as <strong style={{ color: "#f97316" }}>{urgency}</strong> priority.
              The City of Toronto has been notified. Nearby residents will be alerted.
            </p>
            <button onClick={onClose}
              style={{ marginTop: 8, padding: "10px 28px", borderRadius: 10, border: "none", cursor: "pointer", background: "var(--teal)", color: "#fff", fontWeight: 700, fontSize: 14 }}>
              Done
            </button>
          </div>
        )}

        {/* Rejected */}
        {step === "rejected" && (
          <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <XCircle size={48} style={{ color: "#ef4444" }} />
            <p style={{ fontWeight: 700, color: "#ef4444", fontSize: 16 }}>Report Not Verified</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 280 }}>
              Our AI could not verify this as a legitimate civic incident. Please add more detail.
            </p>
            <button onClick={() => setStep("input")}
              style={{ marginTop: 8, padding: "10px 28px", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer", background: "transparent", color: "var(--text)", fontSize: 14 }}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
