import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Simple hash to avoid storing password in plaintext
// Hash of 'Admin2026' using djb2
const ADMIN_PASSWORD_HASH = -1832341192;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60000; // 60 seconds

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

interface Props {
  onUnlock: () => void;
  title?: string;
}

export default function PasswordLock({ onUnlock, title = 'ADMIN ACCESS' }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockMsg, setLockMsg] = useState('');

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setLockMsg('');
        setAttempts(0);
        clearInterval(tick);
      } else {
        setLockMsg(`Too many attempts. Try again in ${remaining}s`);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [lockedUntil]);

  const handleSubmit = () => {
    if (lockedUntil && Date.now() < lockedUntil) return;
    if (djb2Hash(password) === ADMIN_PASSWORD_HASH) {
      setError(false);
      setAttempts(0);
      onUnlock();
    } else {
      const next = attempts + 1;
      setAttempts(next);
      setError(true);
      if (next >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setLockMsg(`Too many attempts. Try again in 60s`);
      }
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

        {error && !lockMsg && (
          <Text testID="password-error" style={styles.errorText}>INCORRECT PASSWORD</Text>
        )}

        {lockMsg ? (
          <Text testID="password-error" style={styles.errorText}>{lockMsg}</Text>
        ) : null}

        <TouchableOpacity
          testID="unlock-btn"
          style={[styles.unlockBtn, !!lockedUntil && { opacity: 0.4 }]}
          onPress={handleSubmit}
          disabled={!!lockedUntil}
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
