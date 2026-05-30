import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>⚠ CRASH REPORT</Text>
        <Text style={styles.name}>{error.name}: {error.message}</Text>
        <ScrollView style={styles.scroll}>
          <Text style={styles.stack}>{error.stack}</Text>
        </ScrollView>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => this.setState({ error: null })}
        >
          <Text style={styles.btnText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0000", padding: 20, paddingTop: 60 },
  title:     { color: "#ef4444", fontFamily: "monospace", fontSize: 14, fontWeight: "700", marginBottom: 12 },
  name:      { color: "#fca5a5", fontFamily: "monospace", fontSize: 11, marginBottom: 12 },
  scroll:    { flex: 1, borderWidth: 1, borderColor: "#3f0000", borderRadius: 6, padding: 10 },
  stack:     { color: "#9ca3af", fontFamily: "monospace", fontSize: 9, lineHeight: 14 },
  btn:       { marginTop: 16, borderWidth: 1, borderColor: "#ef4444", borderRadius: 8, padding: 12, alignItems: "center" },
  btnText:   { color: "#ef4444", fontFamily: "monospace", fontSize: 12 },
});
