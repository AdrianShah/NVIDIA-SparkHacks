"use client";
import { useEffect, useRef, useState } from "react";
import { X, Camera, Mic, MicOff, Send, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Props {
  onClose:    () => void;
  initialGps?: { lat: number; lng: number };
  onSubmit:  (transcript: string, frame_b64: string, gps: { lat: number; lng: number }) => Promise<{ legitimate: boolean; urgency: string }>;
}

type Step = "input" | "submitting" | "verified" | "rejected";

export default function ReportModal({ onClose, initialGps, onSubmit }: Props) {
  const [transcript, setTranscript] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(initialGps ?? null);
  const [recording,  setRecording]  = useState(false);
  const [frame,      setFrame]      = useState<string>("");
  const [step,       setStep]       = useState<Step>("input");
  const [urgency,    setUrgency]    = useState("");
  const [camError,   setCamError]   = useState(false);

  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const recRef     = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);

  useEffect(() => {
    // Only fetch GPS if not already provided by parent's watchPosition
    if (!initialGps) {
      navigator.geolocation?.getCurrentPosition(
        (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setGps({ lat: 43.6532, lng: -79.3832 })
      );
    }
    // Try camera
    navigator.mediaDevices?.getUserMedia({ video: true })
      .then((s) => {
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCamError(true));

    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const captureFrame = (): string => {
    if (!videoRef.current || camError) return "";
    const canvas = document.createElement("canvas");
    canvas.width  = videoRef.current.videoWidth  || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
  };

  const toggleRecording = async () => {
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e) => chunksRef.current.push(e.data);
        rec.onstop = () => {
          // Convert audio to transcript placeholder
          setTranscript((t) => t || "Voice report submitted");
        };
        rec.start();
        recRef.current = rec;
        setRecording(true);
      } catch { /* mic denied */ }
    }
  };

  const handleSubmit = async () => {
    if (!transcript.trim()) return;
    setStep("submitting");
    const f   = frame || captureFrame();
    const gps_ = gps ?? { lat: 43.6532, lng: -79.3832 };
    try {
      const result = await onSubmit(transcript, f, gps_);
      setUrgency(result.urgency);
      setStep(result.legitimate ? "verified" : "rejected");
    } catch {
      setStep("rejected");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
           style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Report an Incident</span>
          <button onClick={onClose} style={{ color: "var(--text-muted)" }}><X className="w-4 h-4" /></button>
        </div>

        {/* ── Input step ── */}
        {step === "input" && (
          <div className="p-4 space-y-3">
            {/* Camera preview */}
            <div className="rounded-lg overflow-hidden aspect-video relative" style={{ background: "#000" }}>
              {!camError
                ? <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
                    <Camera className="w-6 h-6 mr-2" />Camera unavailable
                  </div>
              }
              {!camError && (
                <button
                  onClick={() => setFrame(captureFrame())}
                  className="absolute bottom-2 right-2 px-2 py-1 rounded text-xs font-mono"
                  style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}
                >
                  {frame ? "✓ Captured" : "📷 Capture"}
                </button>
              )}
            </div>

            {/* GPS */}
            {gps && (
              <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                📍 {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              </p>
            )}

            {/* Transcript */}
            <textarea
              className="w-full rounded-lg border p-3 text-sm resize-none outline-none"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
              placeholder="Describe what you see — flooding, pothole, fire, construction hazard…"
              rows={3}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={toggleRecording}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  recording ? "border-red-500 text-red-400" : ""
                }`}
                style={!recording ? { borderColor: "var(--border)", color: "var(--text-muted)" } : {}}
              >
                {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {recording ? "Stop" : "Record"}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!transcript.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ background: "var(--teal)", color: "#fff" }}
              >
                <Send className="w-4 h-4" /> Submit Report
              </button>
            </div>
          </div>
        )}

        {/* ── Submitting ── */}
        {step === "submitting" && (
          <div className="p-8 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: "var(--teal)" }} />
            <p className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
              Verifying with AI…
            </p>
            <div className="flex gap-6 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
              {["Orchestrator", "Vision", "Localizer", "Compiler"].map((n) => (
                <span key={n} className="flex flex-col items-center gap-1">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--teal)" }} />
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Verified ── */}
        {step === "verified" && (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="w-12 h-12 text-green-400" />
            <p className="font-bold text-green-400">Incident Verified</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Classified as <strong className="text-orange-400">{urgency}</strong> priority.
              The City of Toronto has been notified. Nearby residents will be alerted.
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded-lg text-sm font-semibold"
              style={{ background: "var(--teal)", color: "#fff" }}
            >
              Done
            </button>
          </div>
        )}

        {/* ── Rejected ── */}
        {step === "rejected" && (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <XCircle className="w-12 h-12 text-red-400" />
            <p className="font-bold text-red-400">Report Not Verified</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Our AI could not verify this as a legitimate civic incident. Please provide more detail and try again.
            </p>
            <button
              onClick={() => setStep("input")}
              className="mt-2 px-6 py-2 rounded-lg border text-sm"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
