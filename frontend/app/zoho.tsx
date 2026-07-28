import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Platform, ActivityIndicator, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import { parseZohoDateTime } from '../src/utils/dateUtils';
import {
  getZohoGuestById,
  preloadZohoGuests,
  getZohoLastSyncTime,
  addAccessLog,
  getDeviceLocation,
  type ZohoGuest,
  type AccessLogEntry,
} from '../src/services/storage';
import { pushAllUnpushed } from '../src/services/autoPush';
import { postAccessLog } from '../src/services/api';

const SUCCESS_SOUND = require('../assets/sounds/success.mp3');
const FAILURE_SOUND = require('../assets/sounds/failure.mp3');

/** A ZOHO guest is expired when the current time is past their check-out. */
function isZohoExpired(guest: ZohoGuest): boolean {
  const out = parseZohoDateTime(guest.check_out);
  if (!out) return false; // unparseable/blank check-out — don't block
  return new Date() > out;
}

export default function ZohoScreen() {
  const [manualId, setManualId] = useState('');
  const [loading, setLoading] = useState(false);
  const [guest, setGuest] = useState<ZohoGuest | null>(null);
  const [expired, setExpired] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [count, setCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const inputRef = useRef<TextInput>(null);
  const lookupInFlightRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setCount(await preloadZohoGuests());
    setLastSync(await getZohoLastSyncTime());
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useFocusEffect(useCallback(() => {
    loadStatus();
    // Refocus the field so a hardware scanner or keyboard is ready immediately.
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [loadStatus]));

  const playSound = async (soundFile: any) => {
    try {
      const { sound } = await Audio.Sound.createAsync(soundFile, { shouldPlay: true, volume: 1.0 });
      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) sound.unloadAsync();
      });
    } catch (_) { /* sound is best-effort */ }
  };

  const runLookup = async (rawId: string) => {
    const id = rawId.trim();
    if (!id || lookupInFlightRef.current) return;
    lookupInFlightRef.current = true;
    setLoading(true);
    try {
      const found = await getZohoGuestById(id);
      if (found) {
        const isExp = isZohoExpired(found);
        setGuest(found);
        setExpired(isExp);
        setNotFound(false);
        void playSound(isExp ? FAILURE_SOUND : SUCCESS_SOUND);

        // Log the entry (like student scans): queue locally + push.
        const location = await getDeviceLocation();
        const logEntry: AccessLogEntry = {
          id: Date.now().toString(),
          resident_id: found.zoho_id,
          resident_name: found.name,
          unit: found.flat,
          timestamp: new Date().toISOString(),
          status: isExp ? 'zoho_expired' : 'zoho_verified',
          location,
        };
        await addAccessLog(logEntry);
        void pushAllUnpushed();
        void postAccessLog({
          resident_id: found.zoho_id,
          resident_name: found.name,
          unit: found.flat,
          status: logEntry.status,
          location,
        }).catch(() => {});
      } else {
        setGuest(null);
        setExpired(false);
        setNotFound(true);
        void playSound(FAILURE_SOUND);
      }
    } finally {
      setLoading(false);
      lookupInFlightRef.current = false;
    }
  };

  const handleLookup = async () => {
    const id = manualId.trim();
    if (!id) return;
    await runLookup(id);
    setManualId('');
  };

  const clearResult = () => {
    setGuest(null);
    setExpired(false);
    setNotFound(false);
    setManualId('');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const formatSync = (iso: string | null) => {
    if (!iso) return 'never';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>ZOHO VISITOR</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.prompt}>Enter ZOHO ID No</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={manualId}
              onChangeText={(v) => setManualId(v.replace(/[^0-9]/g, ''))}
              onSubmitEditing={handleLookup}
              placeholder="e.g. 15265"
              placeholderTextColor="#B6A69B"
              keyboardType="number-pad"
              returnKeyType="search"
              autoFocus
              blurOnSubmit={false}
            />
            <TouchableOpacity style={styles.lookupBtn} onPress={handleLookup} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Ionicons name="search" size={22} color="#fff" />}
            </TouchableOpacity>
          </View>

          <Text style={styles.meta}>{count} guests cached · synced {formatSync(lastSync)}</Text>

          {guest && (
            <View style={[styles.card, expired ? styles.cardExpired : styles.cardValid]}>
              <View style={[styles.statusPill, expired ? styles.pillExpired : styles.pillValid]}>
                <Ionicons
                  name={expired ? 'alert-circle' : 'checkmark-circle'}
                  size={20}
                  color="#fff"
                />
                <Text style={styles.statusPillText}>{expired ? 'EXPIRED' : 'VALID'}</Text>
              </View>

              <InfoRow label="Name" value={guest.name} />
              <InfoRow label="Zoho ID" value={guest.zoho_id} />
              <InfoRow label="Flat No" value={guest.flat} />
              <InfoRow label="Checkin" value={guest.check_in} />
              <InfoRow label="Check out" value={guest.check_out} />

              {expired && (
                <View style={styles.expiredBanner}>
                  <Ionicons name="time" size={18} color="#fff" />
                  <Text style={styles.expiredBannerText}>
                    Check-out time has passed — visitor pass EXPIRED
                  </Text>
                </View>
              )}

              <TouchableOpacity style={styles.clearBtn} onPress={clearResult}>
                <Text style={styles.clearBtnText}>NEXT</Text>
              </TouchableOpacity>
            </View>
          )}

          {notFound && (
            <View style={[styles.card, styles.cardNotFound]}>
              <Ionicons name="close-circle" size={48} color="#B91C1C" />
              <Text style={styles.notFoundText}>NOT FOUND</Text>
              <Text style={styles.notFoundSub}>No ZOHO guest with that ID.</Text>
              <TouchableOpacity style={styles.clearBtn} onPress={clearResult}>
                <Text style={styles.clearBtnText}>TRY AGAIN</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFBEB' },
  titleBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#78350F',
  },
  titleText: { color: '#FFFBEB', fontSize: fs(20), fontWeight: '900', letterSpacing: 1 },
  body: { padding: 20, alignItems: 'stretch' },
  prompt: { fontSize: fs(16), fontWeight: '700', color: '#78350F', marginBottom: 8 },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: '#fff', borderWidth: 2, borderColor: '#E5D4C8',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: fs(20),
    color: '#3B2A1A',
  },
  lookupBtn: {
    backgroundColor: '#D97706', borderRadius: 10, paddingHorizontal: 18,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 58,
  },
  meta: { marginTop: 10, fontSize: fs(12), color: '#A89080' },

  card: {
    marginTop: 22, backgroundColor: '#fff', borderRadius: 14, padding: 20,
    borderWidth: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  cardValid: { borderColor: '#16A34A' },
  cardExpired: { borderColor: '#B91C1C' },
  cardNotFound: { borderColor: '#B91C1C', alignItems: 'center' },

  statusPill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 14,
  },
  pillValid: { backgroundColor: '#16A34A' },
  pillExpired: { backgroundColor: '#B91C1C' },
  statusPillText: { color: '#fff', fontWeight: '900', fontSize: fs(14), letterSpacing: 1 },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0E6DC', gap: 12,
  },
  infoLabel: { fontSize: fs(15), color: '#A89080', fontWeight: '700' },
  infoValue: { fontSize: fs(16), color: '#3B2A1A', fontWeight: '700', flexShrink: 1, textAlign: 'right' },

  expiredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#B91C1C',
    borderRadius: 10, padding: 12, marginTop: 14,
  },
  expiredBannerText: { color: '#fff', fontWeight: '800', fontSize: fs(14), flexShrink: 1 },

  notFoundText: { fontSize: fs(22), fontWeight: '900', color: '#B91C1C', marginTop: 8, letterSpacing: 1 },
  notFoundSub: { fontSize: fs(14), color: '#A89080', marginTop: 4 },

  clearBtn: {
    marginTop: 18, backgroundColor: '#78350F', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center',
  },
  clearBtnText: { color: '#fff', fontWeight: '900', fontSize: fs(15), letterSpacing: 1 },
});
