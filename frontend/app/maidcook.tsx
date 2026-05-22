import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Platform, ActivityIndicator, KeyboardAvoidingView,
  AppState, Image, FlatList, Modal, Alert, Keyboard,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';

const SUCCESS_SOUND = require('../assets/sounds/success.mp3');
const FAILURE_SOUND = require('../assets/sounds/failure.mp3');

import {
  getMaidCookById,
  preloadMaidsCooks,
  type MaidCook,
  addMaidCookAttendance,
  type MaidCookAttendanceEntry,
  getCurrentlyInMaidsCooks,
  getUnpushedAttendance,
  markAttendancePushed,
  getOverstayMaidsCooks,
  getDeviceLocation,
} from '../src/services/storage';
import { pushMaidCookAttendance } from '../src/services/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function MaidCookScreen() {
  const [count, setCount] = useState(0);
  const [manualId, setManualId] = useState('');
  const [loading, setLoading] = useState(false);

  // Lookup result
  const [maidCook, setMaidCook] = useState<MaidCook | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Flat selection + IN/OUT
  const [selectedFlat, setSelectedFlat] = useState('');
  const [flatOptions, setFlatOptions] = useState<string[]>([]);

  // Currently-in modal
  const [showCurrentModal, setShowCurrentModal] = useState(false);
  const [currentlyIn, setCurrentlyIn] = useState<{ maid_cook_id: string; name: string; flat: string; in_time: string }[]>([]);

  // Input refs
  const idInputRef = useRef<TextInput>(null);
  const flatInputRef = useRef<TextInput>(null);

  // Sounds
  const successSoundRef = useRef<Audio.Sound | null>(null);
  const failureSoundRef = useRef<Audio.Sound | null>(null);

  // Keyboard visible (to show/hide Back button)
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Periodic push timer
  const pushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overstayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false, staysActiveInBackground: false, shouldDuckAndroid: true }).catch(() => {});
    Audio.Sound.createAsync(SUCCESS_SOUND).then(({ sound }) => { successSoundRef.current = sound; }).catch(() => {});
    Audio.Sound.createAsync(FAILURE_SOUND).then(({ sound }) => { failureSoundRef.current = sound; }).catch(() => {});
    preloadMaidsCooks().then(setCount);

    // Request notification permission
    Notifications.requestPermissionsAsync().catch(() => {});

    // Track keyboard visibility
    const kbShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const kbHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));

    // Periodic push every 30 min
    pushIntervalRef.current = setInterval(() => { autoPushAttendance(); }, 30 * 60 * 1000);
    // Check overstay every 30 min
    overstayIntervalRef.current = setInterval(() => { checkOverstay(); }, 30 * 60 * 1000);
    // Initial checks after 5s
    setTimeout(() => { autoPushAttendance(); checkOverstay(); }, 5000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        preloadMaidsCooks().then(setCount);
        checkOverstay();
      }
    });

    return () => {
      sub.remove();
      kbShow.remove();
      kbHide.remove();
      successSoundRef.current?.unloadAsync();
      failureSoundRef.current?.unloadAsync();
      if (pushIntervalRef.current) clearInterval(pushIntervalRef.current);
      if (overstayIntervalRef.current) clearInterval(overstayIntervalRef.current);
    };
  }, []);

  const autoPushAttendance = async () => {
    try {
      const unpushed = await getUnpushedAttendance();
      if (unpushed.length === 0) return;
      const result = await pushMaidCookAttendance(unpushed);
      if (result.rowsAppended >= 0) {
        await markAttendancePushed(unpushed.map(e => e.id));
      }
    } catch (_) { /* will retry next interval */ }
  };

  const checkOverstay = async () => {
    try {
      const overstay = await getOverstayMaidsCooks(8);
      for (const m of overstay) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Maid/Cook Overstay Alert',
            body: `${m.name} (Flat ${m.flat}) has been inside for ${Math.floor(m.hours)}+ hours and hasn't left yet.`,
            sound: true,
          },
          trigger: null,
        });
      }
    } catch (_) {}
  };

  const playSound = async (soundFile: any) => {
    try {
      const ref = soundFile === SUCCESS_SOUND ? successSoundRef : failureSoundRef;
      if (ref.current) {
        await ref.current.setPositionAsync(0);
        await ref.current.playAsync();
      }
    } catch (_) {}
  };

  const parseValidityDate = (validity: string): Date | null => {
    const text = validity.trim();
    let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    const monthMap: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
    if (match) {
      const [, day, monthName, year] = match;
      const month = monthMap[monthName.toLowerCase()];
      if (month === undefined) return null;
      return new Date(Number(year), month, Number(day));
    }
    return null;
  };

  const isExpired = (mc: MaidCook): boolean => {
    if (!mc.validity || mc.validity.toUpperCase().includes('BLACK LISTED')) return false;
    const d = parseValidityDate(mc.validity);
    if (!d) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return d < today;
  };

  const isBlackListed = (mc: MaidCook): boolean => {
    return (mc.validity || '').toUpperCase().includes('BLACK LISTED');
  };

  const handleManualIdChange = (value: string) => setManualId(value.replace(/[^0-9]/g, ''));

  const handleLookup = async () => {
    if (!manualId.trim()) return;
    setLoading(true);
    await preloadMaidsCooks().then(setCount);
    const found = await getMaidCookById(manualId.trim());
    if (found) {
      const denied = found.status !== 'active' || isExpired(found) || isBlackListed(found);
      if (denied) {
        setMaidCook(found);
        setNotFound(false);
        setFlatOptions([]);
        setSelectedFlat('');
        playSound(FAILURE_SOUND);
      } else {
        setMaidCook(found);
        setNotFound(false);
        const flats = found.flats ? found.flats.split(',').map(f => f.trim()).filter(Boolean) : [];
        setFlatOptions(flats);
        setSelectedFlat('');
        playSound(SUCCESS_SOUND);
      }
    } else {
      setMaidCook(null);
      setNotFound(true);
      setFlatOptions([]);
      setSelectedFlat('');
      playSound(FAILURE_SOUND);
    }
    setLoading(false);
  };

  const handleInOut = async (direction: 'IN' | 'OUT') => {
    if (!maidCook) return;
    Keyboard.dismiss();
    const location = await getDeviceLocation();
    const entry: MaidCookAttendanceEntry = {
      id: `${Date.now()}_${maidCook.id}_${direction}`,
      maid_cook_id: maidCook.id,
      name: maidCook.name,
      flat: selectedFlat,
      direction,
      timestamp: new Date().toISOString(),
      location,
    };
    await addMaidCookAttendance(entry);
    Alert.alert(
      direction === 'IN' ? 'Checked IN' : 'Checked OUT',
      `${maidCook.name}${selectedFlat ? ' → Flat ' + selectedFlat : ''} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
    );
    resetScreen();
  };

  const resetScreen = () => {
    setMaidCook(null);
    setNotFound(false);
    setManualId('');
    setSelectedFlat('');
    setFlatOptions([]);
  };

  const handleShowCurrent = async () => {
    const list = await getCurrentlyInMaidsCooks();
    setCurrentlyIn(list);
    setShowCurrentModal(true);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const hoursAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m ago` : `${m}m ago`;
  };

  // ── DENIED/INVALID RESULT ──
  if (notFound || (maidCook && (maidCook.status !== 'active' || isExpired(maidCook) || isBlackListed(maidCook)))) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.resultFull}>
          <View style={[styles.statusBanner, styles.deniedBanner]}>
            <Ionicons name="close-circle" size={48} color="#FFFFFF" />
            <Text style={styles.bannerText}>
              {notFound ? 'INVALID ID' : isBlackListed(maidCook!) ? 'BLACK LISTED' : isExpired(maidCook!) ? 'EXPIRED ID' : 'INACTIVE'}
            </Text>
          </View>
          {maidCook ? (
            <View style={{ flex: 1, backgroundColor: '#7F1D1D', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              {(maidCook.local_photo || maidCook.photo_url) ? (
                <Image source={{ uri: maidCook.local_photo || maidCook.photo_url }} style={{ width: 150, height: 150, borderRadius: 75 }} />
              ) : (
                <Text style={{ fontSize: fs(120), fontWeight: '900', color: '#FFFFFF' }}>{maidCook.name.charAt(0)}</Text>
              )}
              <Text style={{ fontSize: fs(28), fontWeight: '900', color: '#FFFFFF', marginTop: 12 }}>{maidCook.name}</Text>
              <Text style={{ fontSize: fs(16), color: '#FECACA', marginTop: 8 }}>
                {isBlackListed(maidCook) ? 'This person is black listed' : isExpired(maidCook) ? `ID expired: ${maidCook.validity}` : 'Account inactive'}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1, backgroundColor: '#7F1D1D', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <Ionicons name="warning" size={80} color="#FFFFFF" />
              <Text style={{ fontSize: fs(40), fontWeight: '900', color: '#FFFFFF', textAlign: 'center', marginTop: 16 }}>INVALID{'\n'}or FAKE ID</Text>
              <Text style={{ fontSize: fs(16), fontWeight: '700', color: '#FECACA', marginTop: 12 }}>This ID does not exist in the system.</Text>
            </View>
          )}
          <TouchableOpacity style={styles.scanNextBtn} onPress={resetScreen}>
            <Text style={styles.scanNextText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── VERIFIED RESULT: show flat selection + IN/OUT ──
  if (maidCook) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.resultFull}>
          <View style={[styles.statusBanner, styles.verifiedBanner]}>
            <Ionicons name="checkmark-circle" size={28} color="#FFFFFF" />
            <Text style={styles.bannerText}>VERIFIED</Text>
          </View>

          {/* Photo + Name section */}
          <View style={styles.profileSection}>
            {(maidCook.local_photo || maidCook.photo_url || maidCook.photo_base64) ? (
              <Image source={{ uri: maidCook.local_photo || maidCook.photo_url || maidCook.photo_base64 }} style={styles.profilePhoto} resizeMode="cover" />
            ) : (
              <View style={styles.profileInitialCircle}>
                <Text style={styles.profileInitial}>{maidCook.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{maidCook.name}</Text>
              <Text style={styles.profileDetail}>ID: {maidCook.id}</Text>
              <Text style={styles.profileDetail}>Flats: {maidCook.flats}</Text>
              {maidCook.validity && <Text style={styles.profileDetail}>Valid till: {maidCook.validity}</Text>}
            </View>
          </View>

          {/* Flat number input */}
          <View style={styles.flatSection}>
            <Text style={styles.flatLabel}>GOING TO FLAT</Text>
            <TextInput
              ref={flatInputRef}
              style={styles.flatInput}
              value={selectedFlat}
              onChangeText={(v) => setSelectedFlat(v.replace(/[^0-9]/g, ''))}
              placeholder="Optional"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>

          {/* IN / OUT buttons */}
          <View style={styles.inOutRow}>
            <TouchableOpacity
              style={[styles.inOutBtn, styles.inBtn]}
              onPress={() => handleInOut('IN')}
            >
              <Ionicons name="log-in" size={32} color="#FFFFFF" />
              <Text style={styles.inOutText}>IN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.inOutBtn, styles.outBtn]}
              onPress={() => handleInOut('OUT')}
            >
              <Ionicons name="log-out" size={32} color="#FFFFFF" />
              <Text style={styles.inOutText}>OUT</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.cancelBtn} onPress={resetScreen}>
            <Text style={styles.cancelText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── MAIN INPUT SCREEN ──
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.titleBar}>
          <HamburgerMenu />
          <Text style={styles.titleText}>MAID / COOK</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.statusBarRow}>
          <View style={[styles.statusDot, count > 0 ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.statusText}>{count} MAIDS/COOKS IN LOCAL DB</Text>
        </View>

        <View style={styles.mainContent}>
          <Ionicons name="person-circle" size={80} color="#78350F" />
          <Text style={styles.promptText}>Enter Maid/Cook ID</Text>
          <View style={styles.idInputRow}>
            <TextInput
              ref={idInputRef}
              style={styles.idInput}
              value={manualId}
              onChangeText={handleManualIdChange}
              placeholder="e.g. 5124"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleLookup}
              autoFocus
            />
            <TouchableOpacity style={styles.lookupBtn} onPress={handleLookup} disabled={loading || !manualId.trim()}>
              {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="search" size={24} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomButtons}>
          {keyboardVisible && (
            <TouchableOpacity style={styles.backBtn} onPress={() => { Keyboard.dismiss(); }}>
              <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.showCurrentBtn} onPress={handleShowCurrent}>
            <Ionicons name="people" size={22} color="#FFFFFF" />
            <Text style={styles.showCurrentText}>Tower Status</Text>
          </TouchableOpacity>
        </View>

        {/* Currently-In Modal */}
        <Modal visible={showCurrentModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Tower Status</Text>
                <TouchableOpacity onPress={() => setShowCurrentModal(false)}>
                  <Ionicons name="close" size={28} color="#0F172A" />
                </TouchableOpacity>
              </View>
              {currentlyIn.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="checkmark-circle" size={48} color="#00C853" />
                  <Text style={styles.emptyText}>No maids/cooks currently inside</Text>
                </View>
              ) : (
                <FlatList
                  data={currentlyIn}
                  keyExtractor={(item, idx) => `${item.maid_cook_id}_${item.flat}_${idx}`}
                  renderItem={({ item }) => {
                    const h = (Date.now() - new Date(item.in_time).getTime()) / 3600000;
                    return (
                      <View style={[styles.currentItem, h >= 8 && styles.currentItemAlert]}>
                        <View style={styles.currentLeft}>
                          <Text style={styles.currentName}>{item.name}</Text>
                          <Text style={styles.currentFlat}>Flat {item.flat}</Text>
                        </View>
                        <View style={styles.currentRight}>
                          <Text style={styles.currentTime}>IN: {formatTime(item.in_time)}</Text>
                          <Text style={[styles.currentAgo, h >= 8 && styles.currentAgoAlert]}>{hoursAgo(item.in_time)}</Text>
                        </View>
                      </View>
                    );
                  }}
                />
              )}
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: { backgroundColor: '#78350F', paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleText: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB', letterSpacing: 2 },
  statusBarRow: { flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 24, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  dotOnline: { backgroundColor: '#00C853' },
  dotOffline: { backgroundColor: '#FFB300' },
  statusText: { fontSize: fs(12), fontWeight: '700', color: '#475569', letterSpacing: 1 },
  mainContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  promptText: { fontSize: fs(22), fontWeight: '900', color: '#0F172A', marginTop: 16, marginBottom: 24 },
  idInputRow: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: 320 },
  idInput: { flex: 1, height: 64, borderWidth: 2, borderColor: '#78350F', borderRadius: 8, paddingHorizontal: 20, fontSize: fs(24), fontWeight: '900', backgroundColor: '#FFFBEB', textAlign: 'center', letterSpacing: 4 },
  lookupBtn: { width: 64, height: 64, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center', borderRadius: 8, borderWidth: 2, borderColor: '#000000' },
  bottomButtons: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#64748B', paddingVertical: 18, paddingHorizontal: 20, borderRadius: 8 },
  backBtnText: { fontSize: fs(16), fontWeight: '900', color: '#FFFFFF' },
  showCurrentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#334155', paddingVertical: 18, borderRadius: 8 },
  showCurrentText: { fontSize: fs(16), fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  resultFull: { flex: 1 },
  statusBanner: { height: 52, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10 },
  verifiedBanner: { backgroundColor: '#00C853' },
  deniedBanner: { backgroundColor: '#FF3B30' },
  bannerText: { fontSize: fs(24), fontWeight: '900', color: '#FFFFFF' },
  profileSection: { flexDirection: 'row', padding: 20, backgroundColor: '#F1F5F9', gap: 16, alignItems: 'center' },
  profilePhoto: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#78350F' },
  profileInitialCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center' },
  profileInitial: { fontSize: fs(48), fontWeight: '900', color: '#FFFFFF' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: fs(22), fontWeight: '900', color: '#0F172A' },
  profileDetail: { fontSize: fs(14), color: '#475569', marginTop: 4, fontWeight: '600' },
  flatSection: { padding: 20, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  flatLabel: { fontSize: fs(13), fontWeight: '900', color: '#64748B', letterSpacing: 2, marginBottom: 12 },
  flatOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flatChip: { paddingVertical: 12, paddingHorizontal: 24, borderWidth: 2, borderColor: '#78350F', borderRadius: 8, backgroundColor: '#FFFBEB' },
  flatChipSelected: { backgroundColor: '#78350F' },
  flatChipText: { fontSize: fs(18), fontWeight: '900', color: '#78350F' },
  flatChipTextSelected: { color: '#FFFFFF' },
  flatSingle: { fontSize: fs(24), fontWeight: '900', color: '#78350F' },
  flatInput: { height: 56, borderWidth: 2, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 16, fontSize: fs(18), fontWeight: '700', backgroundColor: '#F8FAFC' },
  inOutRow: { flex: 1, flexDirection: 'row', gap: 0 },
  inOutBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  inBtn: { backgroundColor: '#00C853' },
  outBtn: { backgroundColor: '#FF3B30' },
  inOutBtnDisabled: { opacity: 0.4 },
  inOutText: { fontSize: fs(36), fontWeight: '900', color: '#FFFFFF', letterSpacing: 4 },
  cancelBtn: { height: 56, backgroundColor: '#475569', justifyContent: 'center', alignItems: 'center' },
  cancelText: { fontSize: fs(16), fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  scanNextBtn: { height: 100, backgroundColor: '#00C853', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10, borderWidth: 3, borderColor: '#00A844', elevation: 6 },
  scanNextText: { color: '#FFFFFF', fontSize: fs(20), fontWeight: '900', letterSpacing: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  modalTitle: { fontSize: fs(20), fontWeight: '900', color: '#0F172A' },
  emptyState: { padding: 40, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: fs(16), color: '#475569', fontWeight: '600' },
  currentItem: { flexDirection: 'row', padding: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  currentItemAlert: { backgroundColor: '#FEF2F2' },
  currentLeft: { flex: 1 },
  currentName: { fontSize: fs(16), fontWeight: '900', color: '#0F172A' },
  currentFlat: { fontSize: fs(13), color: '#475569', marginTop: 2 },
  currentRight: { alignItems: 'flex-end' },
  currentTime: { fontSize: fs(14), fontWeight: '700', color: '#0F172A' },
  currentAgo: { fontSize: fs(12), color: '#64748B', marginTop: 2 },
  currentAgoAlert: { color: '#FF3B30', fontWeight: '700' },
});
