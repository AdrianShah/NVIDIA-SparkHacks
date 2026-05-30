import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface CameraCaptureProps {
  isActive: boolean;
  paused?: boolean;
  onFrame: (base64: string) => void;
}

export default function CameraCapture({ isActive, paused = false, onFrame }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  useEffect(() => {
    if (!isActive || paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    if (!permission?.granted) return;

    intervalRef.current = setInterval(async () => {
      if (!cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
        if (photo?.base64) onFrameRef.current(photo.base64);
      } catch {}
    }, 3000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isActive, paused, permission?.granted]);

  if (!permission) return <View style={styles.box} />;

  if (!permission.granted) {
    return (
      <View style={styles.box}>
        <Text style={styles.offText}>Camera permission needed</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Allow</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isActive) {
    return (
      <View style={styles.box}>
        <Text style={styles.offText}>CAMERA OFF</Text>
      </View>
    );
  }

  // Overlays are siblings of CameraView (not children) — SDK 54 requirement
  return (
    <View style={styles.box}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.recBadge} pointerEvents="none">
        <View style={styles.recDot} />
        <Text style={styles.recText}>REC</Text>
      </View>
      <View style={styles.labelBar} pointerEvents="none">
        <Text style={styles.labelText}>LIVE FEED</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 160, height: 120, borderRadius: 10,
    overflow: "hidden", borderWidth: 1,
    borderColor: "#134e4a", backgroundColor: "#000",
    alignItems: "center", justifyContent: "center",
  },
  offText:     { color: "#374151", fontFamily: "monospace", fontSize: 10 },
  recBadge:    { position: "absolute", top: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4 },
  recDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" },
  recText:     { color: "#fca5a5", fontFamily: "monospace", fontSize: 9 },
  labelBar:    { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", padding: 4 },
  labelText:   { color: "#2dd4bf", fontFamily: "monospace", fontSize: 9 },
  permBtn:     { marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: "#14b8a6" },
  permBtnText: { color: "#14b8a6", fontFamily: "monospace", fontSize: 10 },
});
