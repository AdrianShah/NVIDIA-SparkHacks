"use client";
import { useEffect, useRef, useState } from "react";

interface DispatchReportProps {
  report: string;
  isProcessing: boolean;
}

export default function DispatchReport({ report, isProcessing }: DispatchReportProps) {
  const [displayed, setDisplayed] = useState("");
  const [targetLen, setTargetLen] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevReportRef = useRef(report);

  useEffect(() => {
    if (report.startsWith(prevReportRef.current)) {
      setTargetLen(report.length);
    } else {
      setDisplayed("");
      setTargetLen(report.length);
    }
    prevReportRef.current = report;
  }, [report]);

  useEffect(() => {
    if (!report || displayed.length >= targetLen) return;

    const id = setTimeout(() => {
      setDisplayed(report.slice(0, displayed.length + 1));
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 10);

    return () => clearTimeout(id);
  }, [report, displayed, targetLen]);

  const isTyping = report.length > 0 && displayed.length < targetLen;

  if (!report && !isProcessing) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-700">
        <span className="text-2xl">📡</span>
        <span className="text-xs font-mono">Awaiting incident...</span>
      </div>
    );
  }

  if (isProcessing && !displayed) {
    return (
      <div className="h-full flex items-center justify-center gap-1.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-2 h-2 rounded-full bg-teal-500 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto pr-1">
      <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
        {displayed}
        {isTyping && (
          <span className="inline-block w-[2px] h-[14px] bg-teal-400 ml-px align-middle animate-blink" />
        )}
      </pre>
    </div>
  );
}
