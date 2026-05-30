import React, { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

interface DispatchReportProps {
  report: string;
  isProcessing: boolean;
}

export default function DispatchReport({ report, isProcessing }: DispatchReportProps) {
  const [displayed, setDisplayed] = useState("");
  const [charIndex, setCharIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  // Reset typewriter on new report
  useEffect(() => {
    setDisplayed("");
    setCharIndex(0);
  }, [report]);

  // Typewriter tick
  useEffect(() => {
    if (!report || charIndex >= report.length) return;
    const id = setTimeout(() => {
      setDisplayed((prev) => prev + report[charIndex]);
      setCharIndex((prev) => prev + 1);
      scrollRef.current?.scrollToEnd({ animated: false });
    }, 10);
    return () => clearTimeout(id);
  }, [report, charIndex]);

  // Bouncing dots animation
  useEffect(() => {
    if (!isProcessing) return;
    const bounce = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -6, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(300),
        ])
      ).start();
    bounce(dot1, 0);
    bounce(dot2, 150);
    bounce(dot3, 300);
    return () => {
      dot1.stopAnimation(); dot2.stopAnimation(); dot3.stopAnimation();
      dot1.setValue(0); dot2.setValue(0); dot3.setValue(0);
    };
  }, [isProcessing]);

  if (!report && !isProcessing) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📡</Text>
        <Text style={styles.emptyText}>Awaiting incident...</Text>
      </View>
    );
  }

  if (isProcessing && !displayed) {
    return (
      <View style={styles.center}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[styles.bounceDot, { transform: [{ translateY: dot }] }]}
          />
        ))}
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.reportText}>{displayed}</Text>
      {charIndex < report.length && (
        <View style={styles.cursor} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyIcon:   { fontSize: 28 },
  emptyText:   { color: "#374151", fontFamily: "monospace", fontSize: 12 },
  bounceDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: "#14b8a6", marginHorizontal: 4 },
  scroll:      { flex: 1 },
  reportText:  { color: "#d1d5db", fontFamily: "monospace", fontSize: 11, lineHeight: 18 },
  cursor:      { width: 2, height: 14, backgroundColor: "#2dd4bf", marginTop: 2 },
});
