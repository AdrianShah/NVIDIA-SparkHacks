import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

export type NodeStatus = "idle" | "active" | "complete" | "error";

interface AgentCardProps {
  name: string;
  label: string;
  status: NodeStatus;
  detail?: string;
}

const ICONS: Record<string, string> = {
  orchestrator: "⚡",
  vision:       "👁",
  localizer:    "📍",
  compiler:     "📋",
};

const BORDER: Record<NodeStatus, string> = {
  idle:     "#1f2937",
  active:   "#14b8a6",
  complete: "#22c55e",
  error:    "#ef4444",
};

const BG: Record<NodeStatus, string> = {
  idle:     "#030712",
  active:   "#042f2e",
  complete: "#052e16",
  error:    "#2d0a0a",
};

const DOT: Record<NodeStatus, string> = {
  idle:     "#374151",
  active:   "#2dd4bf",
  complete: "#4ade80",
  error:    "#f87171",
};

export default function AgentCard({ name, label, status, detail }: AgentCardProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === "active") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }

    if (status === "complete") {
      Animated.spring(scaleAnim, { toValue: 1.05, useNativeDriver: true, friction: 5 }).start(() =>
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 5 }).start()
      );
    }
  }, [status]);

  return (
    <Animated.View
      style={[
        styles.card,
        { borderColor: BORDER[status], backgroundColor: BG[status], transform: [{ scale: scaleAnim }] },
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.icon}>{ICONS[name] ?? "◈"}</Text>
        <View style={styles.info}>
          <Text style={styles.label}>{label.toUpperCase()}</Text>
          <View style={styles.statusRow}>
            <Animated.View style={[styles.dot, { backgroundColor: DOT[status], opacity: pulseAnim }]} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
          {detail && status === "complete" && (
            <Text style={styles.detail} numberOfLines={1}>{detail}</Text>
          )}
        </View>
        {status === "complete" && <Text style={styles.check}>✓</Text>}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    margin: 4,
  },
  row:        { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  icon:       { fontSize: 18, marginTop: 2 },
  info:       { flex: 1 },
  label:      { color: "#e2e8f0", fontFamily: "monospace", fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  statusRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  dot:        { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: "#6b7280", fontSize: 11, fontFamily: "monospace", textTransform: "capitalize" },
  detail:     { color: "#9ca3af", fontSize: 10, fontFamily: "monospace", marginTop: 4 },
  check:      { color: "#4ade80", fontSize: 14 },
});
