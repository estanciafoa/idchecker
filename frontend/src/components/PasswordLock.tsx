import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ADMIN_PASSWORD = 'Admin2026';

interface Props {
  onUnlock: () => void;
  title?: string;
}

export default function PasswordLock({ onUnlock, title = 'ADMIN ACCESS' }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = () => {
    if (password === ADMIN_PASSWORD) {
      setError(false);
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <Ionicons name="lock-closed" size={56} color="#0F172A" />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>Enter password to continue</Text>

        <View style={styles.inputRow}>
          <TextInput
            testID="password-input"
            style={styles.input}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(false); }}
            placeholder="Password"
            placeholderTextColor="#94A3B8"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#475569" />
          </TouchableOpacity>
        </View>

        {error && (
          <Text testID="password-error" style={styles.errorText}>INCORRECT PASSWORD</Text>
        )}

        <TouchableOpacity
          testID="unlock-btn"
          style={styles.unlockBtn}
          onPress={handleSubmit}
        >
          <Ionicons name="lock-open" size={20} color="#FFFFFF" />
          <Text style={styles.unlockText}>UNLOCK</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  inner: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { fontSize: 24, fontWeight: '900', color: '#0F172A', marginTop: 16 },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6, marginBottom: 32 },
  inputRow: { width: '100%', flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  input: { flex: 1, height: 56, paddingHorizontal: 16, fontSize: 18 },
  eyeBtn: { padding: 16 },
  errorText: { fontSize: 13, fontWeight: '700', color: '#FF3B30', marginTop: 12, letterSpacing: 1 },
  unlockBtn: { width: '100%', height: 60, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, borderWidth: 2, borderColor: '#000000', marginTop: 24 },
  unlockText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
});
