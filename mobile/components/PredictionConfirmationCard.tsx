import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PredictResult } from "../lib/incident-flow";

type CardPhase = "confirm" | "correct" | "finalizing" | "error";

interface ThemeTokens {
  bgCard: string;
  bgPanel: string;
  border: string;
  text: string;
  muted: string;
  teal: string;
}

interface PredictionConfirmationCardProps {
  visible: boolean;
  prediction: PredictResult | null;
  theme: ThemeTokens;
  phase: CardPhase;
  errorMessage?: string;
  onConfirm: () => void;
  onStartCorrect: () => void;
  onSubmitCorrection: (text: string) => void;
  onDismissError: () => void;
}

export default function PredictionConfirmationCard({
  visible,
  prediction,
  theme,
  phase,
  errorMessage,
  onConfirm,
  onStartCorrect,
  onSubmitCorrection,
  onDismissError,
}: PredictionConfirmationCardProps) {
  const slideAnim = useRef(new Animated.Value(320)).current;
  const [correction, setCorrection] = useState("");

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible && prediction ? 0 : 320,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, prediction, slideAnim]);

  useEffect(() => {
    if (phase === "confirm") setCorrection("");
  }, [phase, prediction?.prediction_id]);

  if (!prediction) return null;

  const confidencePct = Math.round(prediction.confidence * 100);
  const canSubmitCorrection = correction.trim().length > 0;
  const isFinalizing = phase === "finalizing";

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.card,
        {
          backgroundColor: theme.bgCard,
          borderColor: theme.teal,
          transform: [{ translateY: slideAnim }],
          opacity: visible ? 1 : 0,
        },
      ]}
    >
      <View style={styles.handle} />

      <Text style={[styles.eyebrow, { color: theme.muted }]}>MAVERICK VISION</Text>
      <Text style={[styles.headline, { color: theme.text }]}>
        Maverick detects:{" "}
        <Text style={{ color: theme.teal }}>{prediction.hazard_type}</Text>
        {" "}({confidencePct}% match)
      </Text>

      {phase === "error" && errorMessage ? (
        <View style={[styles.errorBox, { borderColor: "#ef4444" }]}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable onPress={onDismissError} style={styles.errorDismiss}>
            <Text style={[styles.errorDismissText, { color: theme.teal }]}>
              Re-snap hazard
            </Text>
          </Pressable>
        </View>
      ) : isFinalizing ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.teal} size="small" />
          <Text style={[styles.loadingText, { color: theme.muted }]}>
            Compiling dispatch report…
          </Text>
        </View>
      ) : phase === "correct" ? (
        <>
          <Text style={[styles.correctHint, { color: theme.muted }]}>
            Describe the actual hazard
          </Text>
          <TextInput
            style={[
              styles.correctionInput,
              {
                backgroundColor: theme.bgPanel,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            placeholder="e.g. Burst water main, not basement flooding…"
            placeholderTextColor={theme.muted}
            multiline
            value={correction}
            onChangeText={setCorrection}
            editable={!isFinalizing}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmitCorrection }}
            disabled={!canSubmitCorrection}
            onPress={() => {
              const trimmed = correction.trim();
              if (!trimmed) return;
              onSubmitCorrection(trimmed);
            }}
            style={({ pressed }) => [
              styles.chipPrimary,
              !canSubmitCorrection && styles.chipDisabled,
              {
                backgroundColor: canSubmitCorrection ? theme.teal : theme.bgPanel,
                borderColor: canSubmitCorrection ? theme.teal : theme.border,
                opacity: pressed && canSubmitCorrection ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.chipPrimaryText,
                { color: canSubmitCorrection ? "#050F14" : theme.muted },
              ]}
            >
              Submit correction
            </Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.chipPrimary,
              { backgroundColor: theme.teal, borderColor: theme.teal, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.chipPrimaryText, { color: "#050F14" }]}>CONFIRM</Text>
          </Pressable>
          <Pressable
            onPress={onStartCorrect}
            style={({ pressed }) => [
              styles.chipSecondary,
              { borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.chipSecondaryText, { color: theme.text }]}>CORRECT</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    shadowColor: "#2dd4bf",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#374151",
    alignSelf: "center",
    marginBottom: 12,
  },
  eyebrow: {
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 6,
  },
  headline: {
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  chipPrimary: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipPrimaryText: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  chipSecondary: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  chipSecondaryText: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  correctHint: {
    fontFamily: "monospace",
    fontSize: 10,
    marginBottom: 8,
  },
  correctionInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 72,
    fontFamily: "monospace",
    fontSize: 12,
    marginBottom: 10,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  loadingText: {
    fontFamily: "monospace",
    fontSize: 11,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#ef444411",
  },
  errorText: {
    color: "#fca5a5",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  errorDismiss: {
    alignSelf: "flex-start",
  },
  errorDismissText: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
  },
});
