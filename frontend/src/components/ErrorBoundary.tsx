import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crash caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>APP ERROR</Text>
          <Text style={styles.subtitle}>The app encountered an error but your data is safe.</Text>
          <ScrollView style={styles.errorBox}>
            <Text style={styles.errorText}>{this.state.error?.message}</Text>
            <Text style={styles.stackText}>{this.state.error?.stack?.slice(0, 500)}</Text>
          </ScrollView>
          <TouchableOpacity
            style={styles.button}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.buttonText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A2E', padding: 24 },
  title: { fontSize: 24, fontWeight: '900', color: '#FF3B30', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#FFFFFFCC', textAlign: 'center', marginBottom: 16 },
  errorBox: { maxHeight: 200, backgroundColor: '#00000040', borderRadius: 8, padding: 12, width: '100%', marginBottom: 20 },
  errorText: { fontSize: 13, color: '#FF6B6B', fontWeight: '700', marginBottom: 8 },
  stackText: { fontSize: 11, color: '#FFFFFF80', fontFamily: 'monospace' },
  button: { backgroundColor: '#D97706', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
  buttonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});
