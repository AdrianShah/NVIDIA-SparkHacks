"use client";
import { useEffect, useRef, useState } from "react";
import { X, Send, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Props {
  onClose:     () => void;
  initialGps?: { lat: number; lng: number };
  onSubmit:    (transcript: string, frame_b64: string, gps: { lat: number; lng: number }) => Promise<{ legitimate: boolean; urgency: string }>;
}

type Step      = "input" | "submitting" | "verified" | "rejected";
type PhotoState = "idle" | "preview" | "kept";

export default function ReportModal({ onClose, initialGps, onSubmit }: Props) {
  const [step,       setStep]       = useState<Step>("input");
  const [transcript, setTranscript] = useState("");
  const [gps,        setGps]        = useState(initialGps ?? { lat: 43.6532, lng: -79.3832 });
  const [camError,   setCamError]   = useState(false);
  const [photoState, setPhotoState] = useState<PhotoState>("idle");
  const [photoB64,   setPhotoB64]   = useState("");
  const [micActive,  setMicActive]  = useState(false);
  const [urgency,    setUrgency]    = useState("");

  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const recognRef  = useRef<any>(null);

  // ── Start camera ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialGps) {
      navigator.geolocation?.getCurrentPosition(
        (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {}
      );
    }
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.muted = true; }
      })
      .catch(() => setCamError(true));
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognRef.current?.stop();
    };
  }, []); // eslint-disable-line

  // ── Photo capture ─────────────────────────────────────────────────────────────
  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
    c.getContext("2d")?.drawImage(v, 0, 0);
    setPhotoB64(c.toDataURL("image/jpeg", 0.8).split(",")[1]);
    setPhotoState("preview");
  };

  const retakePhoto = () => { setPhotoB64(""); setPhotoState("idle"); };
  const keepPhoto   = () => setPhotoState("kept");

  // ── Speech → real-time transcript (Web Speech API, no backend needed) ─────────
  const toggleSpeech = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported in this browser."); return; }

    if (micActive) {
      recognRef.current?.stop();
      setMicActive(false);
      return;
    }

    const recog = new SR();
    recog.continuous      = true;
    recog.interimResults  = true;
    recog.lang            = "en-CA";

    recog.onresult = (e: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final   += e.results[i][0].transcript + " ";
        else                       interim += e.results[i][0].transcript;
      }
      setTranscript(final + interim);
    };

    recog.onerror = () => setMicActive(false);
    recog.onend   = () => setMicActive(false);

    recog.start();
    recognRef.current = recog;
    setMicActive(true);
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!transcript.trim() && !photoB64) return;
    recognRef.current?.stop();
    setMicActive(false);

    // Auto-capture frame if not already done
    let frame = photoB64;
    if (!frame) {
      const v = videoRef.current;
      if (v) {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
        c.getContext("2d")?.drawImage(v, 0, 0);
        frame = c.toDataURL("image/jpeg", 0.8).split(",")[1];
      }
    }

    setStep("submitting");
    try {
      const result = await onSubmit(transcript || "Incident reported", frame, gps);
      setUrgency(result.urgency);
      setStep(result.legitimate ? "verified" : "rejected");
    } catch { setStep("rejected"); }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.7)" }}>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "95vh", overflow: "auto", borderRadius: "20px 20px 0 0", background: "var(--bg-card)", border: "1px solid var(--border)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Report an Incident</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* ── Input ── */}
        {step === "input" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Square camera / photo preview */}
            <div style={{ position: "relative", width: "100%", aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "#000", border: "1px solid var(--border)" }}>

              {/* Photo preview */}
              {photoState !== "idle" && photoB64 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:image/jpeg;base64,${photoB64}`} alt="capture"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              )}

              {/* Live camera (shown when not previewing) */}
              {photoState === "idle" && (
                camError
                  ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
                      Camera unavailable
                    </div>
                  : <video ref={videoRef} autoPlay playsInline
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              )}

              {/* Capture button (idle) */}
              {photoState === "idle" && !camError && (
                <button onClick={capturePhoto}
                  style={{ position: "absolute", bottom: 10, right: 10, padding: "6px 14px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600, background: "rgba(0,0,0,0.7)", color: "#fff" }}>
                  📷 Capture
                </button>
              )}

              {/* Preview actions */}
              {photoState === "preview" && (
                <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
                  <button onClick={retakePhoto}
                    style={{ padding: "7px 16px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600, background: "rgba(0,0,0,0.75)", color: "#fff" }}>
                    🔄 Retake
                  </button>
                  <button onClick={keepPhoto}
                    style={{ padding: "7px 16px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600, background: "#22c55e", color: "#fff" }}>
                    ✓ Keep
                  </button>
                </div>
              )}

              {/* Kept badge + change button */}
              {photoState === "kept" && (
                <>
                  <div style={{ position: "absolute", top: 10, left: 10, background: "#16a34a", borderRadius: 10, padding: "3px 10px" }}>
                    <span style={{ color: "#fff", fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>✓ Kept</span>
                  </div>
                  <button onClick={retakePhoto}
                    style={{ position: "absolute", bottom: 10, right: 10, padding: "5px 12px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: 11, fontFamily: "monospace", background: "rgba(0,0,0,0.7)", color: "#fff" }}>
                    🔄 Change
                  </button>
                </>
              )}
            </div>

            {/* GPS */}
            <p style={{ margin: 0, fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
              📍 {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            </p>

            {/* Description + Speak */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Description</span>
                <button onClick={toggleSpeech}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 12, border: `1px solid ${micActive ? "#ef4444" : "var(--border)"}`, background: "transparent", cursor: "pointer", fontSize: 11, fontFamily: "monospace", color: micActive ? "#ef4444" : "var(--text-muted)" }}>
                  {micActive && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />}
                  {micActive ? "Stop" : "🎤 Speak"}
                </button>
              </div>
              <textarea
                style={{ width: "100%", borderRadius: 10, border: `1px solid ${micActive ? "var(--teal)" : "var(--border)"}`, padding: "10px 12px", fontSize: 13, background: "var(--bg)", color: "var(--text)", resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                placeholder={micActive ? "Listening… speak now" : "Describe what you see — flooding, pothole, fire, construction hazard…"}
                rows={3}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              {micActive && (
                <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--teal)", fontFamily: "monospace" }}>
                  🎤 Listening in real-time…
                </p>
              )}
            </div>

            {/* Submit */}
            <button onClick={handleSubmit}
              disabled={!transcript.trim() && !photoB64}
              style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "monospace", background: "var(--red)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: (!transcript.trim() && !photoB64) ? 0.4 : 1 }}>
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
              City of Toronto notified. Nearby residents will be alerted.
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
              Could not verify as a legitimate civic incident. Please add more detail.
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
