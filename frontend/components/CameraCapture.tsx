"use client";
import { useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  isActive: boolean;
  onFrame: (base64: string) => void;
  onTranscript: (text: string) => void;
}

export default function CameraCapture({ isActive, onFrame, onTranscript }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Stable refs so the effect doesn't re-run when parent re-renders
  const onFrameRef = useRef(onFrame);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  const [hasCamera, setHasCamera] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isActive) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      setHasCamera(false);
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: 640, height: 480 }, audio: true })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setHasCamera(true);
        setError("");

        // Web Speech API for live transcript
        const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
        if (SR) {
          const rec = new SR();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = "en-US";
          rec.onresult = (e: any) => {
            const text = Array.from(e.results as SpeechRecognitionResultList)
              .map((r) => r[0].transcript)
              .join(" ");
            onTranscriptRef.current(text);
          };
          rec.onerror = () => {};
          rec.start();
          recognitionRef.current = rec;
        }

        // Capture frame every 2 s
        intervalRef.current = setInterval(() => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(video, 0, 0);
          const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
          onFrameRef.current(b64);
        }, 2000);
      })
      .catch(() => {
        setError("Camera denied");
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive]); // callbacks accessed via stable refs, not re-run on parent renders

  return (
    <div className="relative w-[200px] h-[150px] rounded-lg overflow-hidden border border-teal-800/60 bg-black shadow-xl">
      <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Overlay states */}
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <span className="text-xs font-mono text-gray-600">CAMERA OFF</span>
        </div>
      )}
      {isActive && !hasCamera && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <span className="text-xs font-mono text-teal-400 animate-pulse">CONNECTING…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <span className="text-xs font-mono text-red-400">{error}</span>
        </div>
      )}

      {/* REC indicator */}
      {isActive && hasCamera && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-mono text-red-400">REC</span>
        </div>
      )}

      {/* Label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
        <span className="text-[10px] font-mono text-teal-500">LIVE FEED</span>
      </div>
    </div>
  );
}
