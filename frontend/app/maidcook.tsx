import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  AppState,
  Image,
} from 'react-native';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';

const SUCCESS_SOUND = require('../assets/sounds/success.mp3');
const FAILURE_SOUND = require('../assets/sounds/failure.mp3');

import {
  getMaidCookById,
  preloadMaidsCooks,
  addAccessLog,
  type MaidCook,
  type AccessLogEntry,
} from '../src/services/storage';
import { postAccessLog } from '../src/services/api';

export default function MaidCookScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [maidCook, setMaidCook] = useState<MaidCook | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [manualId, setManualId] = useState('');
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const cameraRef = useRef<any>(null);

  const successSoundRef = useRef<Audio.Sound | null>(null);
  const failureSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch(() => {});
    // Preload sounds for instant playback
    Audio.Sound.createAsync(SUCCESS_SOUND).then(({ sound }) => { successSoundRef.current = sound; }).catch(() => {});
    Audio.Sound.createAsync(FAILURE_SOUND).then(({ sound }) => { failureSoundRef.current = sound; }).catch(() => {});
    preloadMaidsCooks().then(setCount);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') preloadMaidsCooks().then(setCount);
    });
    return () => {
      sub.remove();
      successSoundRef.current?.unloadAsync();
      failureSoundRef.current?.unloadAsync();
    };
  }, []);

  useEffect(() => {
    if (!showResult) preloadMaidsCooks().then(setCount);
  }, [showResult]);

  const handleManualLookup = async () => {
    if (!manualId.trim()) return;
    setLoading(true);
    await preloadMaidsCooks().then(setCount);
    await lookupMaidCook(manualId.trim());
    setLoading(false);
    setManualId('');
  };

  const handleManualIdChange = (value: string) => {
    setManualId(value.replace(/[^0-9]/g, ''));
  };

  const handleBarCodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    setLoading(true);
    await lookupMaidCook(data.trim());
    setLoading(false);
  }, [scanned]);

  const parseValidityDate = (validity: string): Date | null => {
    const text = validity.trim();
    let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      return isNaN(parsed.getTime()) ? null : parsed;
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
      const parsed = new Date(Number(year), month, Number(day));
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  const isExpired = (mc: MaidCook): boolean => {
    if (!mc.validity) return false;
    if (mc.validity.toUpperCase().includes('BLACK LISTED')) return false;
    const validityDate = parseValidityDate(mc.validity);
    if (!validityDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return validityDate < today;
  };

  const isBlackListed = (mc: MaidCook): boolean => {
    if (!mc.validity) return false;
    return mc.validity.toUpperCase().includes('BLACK LISTED');
  };

  const playSound = async (soundFile: any) => {
    try {
      const ref = soundFile === SUCCESS_SOUND ? successSoundRef : failureSoundRef;
      if (ref.current) {
        await ref.current.setPositionAsync(0);
        await ref.current.playAsync();
      } else {
        const { sound } = await Audio.Sound.createAsync(soundFile, { shouldPlay: true, volume: 1.0 });
        sound.setOnPlaybackStatusUpdate((status) => {
          if ('didJustFinish' in status && status.didJustFinish) sound.unloadAsync();
        });
      }
    } catch (e) {
      console.warn('Sound playback error:', e);
    }
  };

  const lookupMaidCook = async (id: string) => {
    const found = await getMaidCookById(id);
    if (found) {
      setMaidCook(found);
      setNotFound(false);
      const denied = found.status !== 'active' || isExpired(found) || isBlackListed(found);
      const logEntry: AccessLogEntry = {
        id: Date.now().toString(),
        resident_id: found.id,
        resident_name: found.name,
        unit: found.flats,
        timestamp: new Date().toISOString(),
        status: denied ? 'denied' : 'verified',
      };
      await addAccessLog(logEntry);
      void postAccessLog({
        resident_id: found.id,
        resident_name: found.name,
        unit: found.flats,
        status: logEntry.status,
      }).catch(() => {});
      void playSound(denied ? FAILURE_SOUND : SUCCESS_SOUND);
    } else {
      setMaidCook(null);
      setNotFound(true);
      void playSound(FAILURE_SOUND);
    }
    setShowResult(true);
  };

  const resetScan = () => {
    setScanned(false);
    setShowResult(false);
    setMaidCook(null);
    setNotFound(false);
    preloadMaidsCooks().then(setCount);
  };

  // RESULT SCREEN
  if (showResult) {
    return (
      <SafeAreaView style={styles.container}>
        {notFound ? (
          <View style={styles.resultFull}>
            <View style={[styles.statusBanner, styles.deniedBanner]}>
              <Ionicons name="close-circle" size={48} color="#FFFFFF" />
              <Text style={styles.bannerText}>DENIED</Text>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#7F1D1D' }}>
              <Ionicons name="warning" size={80} color="#FFFFFF" />
              <Text style={styles.invalidIdText}>INVALID{"\n"}or FAKE ID</Text>
              <Text style={styles.invalidIdSubtext}>This ID does not exist in the system.</Text>
            </View>
            <TouchableOpacity style={styles.scanNextBtn} onPress={resetScan}>
              <Text style={styles.scanNextText}>SCAN NEXT</Text>
            </TouchableOpacity>
          </View>
        ) : maidCook ? (
          <View style={styles.resultFull}>
            <View
              style={[
                styles.statusBanner,
                (isBlackListed(maidCook) || isExpired(maidCook) || maidCook.status !== 'active')
                  ? styles.deniedBanner
                  : styles.verifiedBanner,
              ]}
            >
              <Ionicons
                name={(isBlackListed(maidCook) || isExpired(maidCook) || maidCook.status !== 'active') ? 'ban' : 'checkmark-circle'}
                size={28}
                color="#FFFFFF"
              />
              <Text style={styles.bannerText}>
                {isBlackListed(maidCook) ? 'BLACK LISTED' : isExpired(maidCook) ? 'EXPIRED ID' : maidCook.status === 'active' ? 'VERIFIED' : 'INACTIVE'}
              </Text>
            </View>

            <View style={styles.photoFull}>
              {(maidCook.local_photo || maidCook.photo_url || maidCook.photo_base64) ? (
                <>
                  <Image
                    source={{ uri: maidCook.local_photo || maidCook.photo_url || maidCook.photo_base64 }}
                    style={styles.photoImage}
                    resizeMode="cover"
                  />
                  {(isExpired(maidCook) || isBlackListed(maidCook)) && (
                    <View style={styles.photoOverlay}>
                      <Text style={styles.overlayText}>
                        {isBlackListed(maidCook) ? 'BLACK\nLISTED' : 'EXPIRED\nID'}
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.photoFullInitial}>
                    {maidCook.name.charAt(0).toUpperCase()}
                  </Text>
                  <Text style={styles.photoName}>{maidCook.name}</Text>
                  {(isExpired(maidCook) || isBlackListed(maidCook)) && (
                    <View style={styles.photoOverlay}>
                      <Text style={styles.overlayText}>
                        {isBlackListed(maidCook) ? 'BLACK\nLISTED' : 'EXPIRED\nID'}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>

            <View style={styles.nameBar}>
              <Text style={styles.nameText}>{maidCook.name}</Text>
              <Text style={styles.validityText}>
                {maidCook.validity ? (isBlackListed(maidCook) ? 'BLACK LISTED' : `Valid till: ${maidCook.validity}`) : ''}
              </Text>
            </View>

            <View style={styles.infoBar}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>ID</Text>
                <Text style={styles.infoValue}>{maidCook.id}</Text>
              </View>
              <View style={styles.infoSep} />
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>FLATS</Text>
                <Text style={styles.infoValue} numberOfLines={2}>{maidCook.flats}</Text>
              </View>
              <View style={styles.infoSep} />
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>PHONE</Text>
                <Text style={styles.infoValue}>{maidCook.phone_last4 ? `••••${maidCook.phone_last4}` : 'N/A'}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.scanNextBtn} onPress={resetScan}>
              <Ionicons name="scan" size={20} color="#FFFFFF" />
              <Text style={styles.scanNextText}>SCAN NEXT</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0055FF" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
          <View style={styles.titleBar}>
            <HamburgerMenu />
            <Text style={styles.titleText}>MAID / COOK</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={styles.statusBarRow}>
            <View style={[styles.statusDot, count > 0 ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.statusText}>{count} MAIDS/COOKS IN LOCAL DB</Text>
          </View>
          <View style={styles.permissionBox}>
            <Ionicons name="camera-outline" size={56} color="#78350F" />
            <Text style={styles.permissionTitle}>CAMERA ACCESS</Text>
            <Text style={styles.permissionText}>Grant camera to scan barcodes</Text>
            <TouchableOpacity style={styles.actionButton} onPress={requestPermission}>
              <Text style={styles.actionButtonText}>GRANT PERMISSION</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.manualSection}>
            <Text style={styles.manualLabel}>MANUAL ID ENTRY</Text>
            <View style={styles.manualRow}>
              <TextInput
                style={styles.manualInput}
                value={manualId}
                onChangeText={handleManualIdChange}
                placeholder="e.g. 5124"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={handleManualLookup}
              />
              <TouchableOpacity style={styles.lookupBtn} onPress={handleManualLookup} disabled={loading}>
                {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.lookupBtnText}>LOOK UP</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <View style={styles.titleBar}>
          <HamburgerMenu />
          <Text style={styles.titleText}>MAID / COOK</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.statusBarRow}>
          <View style={[styles.statusDot, count > 0 ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.statusText}>{count} MAIDS/COOKS IN LOCAL DB</Text>
        </View>
        {!scanned && (
          <View style={styles.cameraContainer}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            <View style={styles.overlay}>
              <View style={styles.viewfinder}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.scanHint}>ALIGN BARCODE WITHIN FRAME</Text>
            </View>
          </View>
        )}
        {scanned && loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0055FF" />
            <Text style={styles.loadingText}>LOOKING UP...</Text>
          </View>
        )}
        <View style={styles.manualSection}>
          <Text style={styles.manualLabel}>MANUAL ID ENTRY</Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              value={manualId}
              onChangeText={handleManualIdChange}
              placeholder="Enter Maid/Cook ID"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleManualLookup}
            />
            <TouchableOpacity style={styles.lookupBtn} onPress={handleManualLookup} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="search" size={22} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: {
    backgroundColor: '#78350F',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleText: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB', letterSpacing: 2 },
  statusBarRow: { flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 24, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  dotOnline: { backgroundColor: '#00C853' },
  dotOffline: { backgroundColor: '#FFB300' },
  statusText: { fontSize: fs(12), fontWeight: '700', color: '#475569', letterSpacing: 1 },
  cameraContainer: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  viewfinder: { width: 250, height: 250, position: 'relative' },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  scanHint: { marginTop: 24, color: '#FFFFFF', fontSize: fs(14), fontWeight: '700', letterSpacing: 2 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, fontSize: fs(16), fontWeight: '700', color: '#475569' },
  manualSection: { padding: 16, paddingHorizontal: 24, backgroundColor: '#F8FAFC', borderTopWidth: 2, borderTopColor: '#000000' },
  manualLabel: { fontSize: fs(12), fontWeight: '700', color: '#64748B', letterSpacing: 2, marginBottom: 8 },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualInput: { flex: 1, height: 56, borderWidth: 2, borderColor: '#E2E8F0', paddingHorizontal: 16, fontSize: fs(18), fontWeight: '700', backgroundColor: '#FFFFFF' },
  lookupBtn: { width: 80, height: 56, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#000000' },
  lookupBtnText: { color: '#FFFFFF', fontWeight: '900', fontSize: fs(13) },
  permissionBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  permissionTitle: { fontSize: fs(22), fontWeight: '900', color: '#0F172A', marginTop: 16 },
  permissionText: { fontSize: fs(15), color: '#475569', marginTop: 6 },
  actionButton: { marginTop: 20, height: 56, paddingHorizontal: 28, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#000000' },
  actionButtonText: { color: '#FFFFFF', fontSize: fs(15), fontWeight: '900', letterSpacing: 1 },
  resultFull: { flex: 1 },
  statusBanner: { height: 52, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10 },
  verifiedBanner: { backgroundColor: '#00C853' },
  deniedBanner: { backgroundColor: '#FF3B30' },
  bannerText: { fontSize: fs(24), fontWeight: '900', color: '#FFFFFF' },
  notFoundText: { fontSize: fs(16), color: '#475569', textAlign: 'center', lineHeight: 24 },
  invalidIdText: { fontSize: fs(48), fontWeight: '900', color: '#FFFFFF', textAlign: 'center', marginTop: 16, letterSpacing: 2 },
  invalidIdSubtext: { fontSize: fs(16), fontWeight: '700', color: '#FECACA', textAlign: 'center', marginTop: 12 },
  photoFull: { flex: 1, width: '100%', backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center' },
  photoImage: { width: '100%', height: '100%' },
  photoOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', transform: [{ rotate: '-35deg' }] },
  overlayText: { fontSize: fs(72), fontWeight: '900', color: '#FF3B30', textAlign: 'center', lineHeight: fs(80), textShadowColor: '#000000', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 6, letterSpacing: 4 },
  photoFullInitial: { fontSize: fs(200), fontWeight: '900', color: '#FFFFFF', opacity: 0.9 },
  photoName: { fontSize: fs(28), fontWeight: '900', color: '#FFFFFF', marginTop: -10 },
  nameBar: { backgroundColor: '#FFFFFF', paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameText: { fontSize: fs(22), fontWeight: '900', color: '#000000' },
  validityText: { fontSize: fs(13), fontWeight: '700', color: '#475569' },
  infoBar: { flexDirection: 'row', backgroundColor: '#0F172A', paddingVertical: 14, paddingHorizontal: 16 },
  infoItem: { flex: 1, alignItems: 'center' },
  infoLabel: { fontSize: fs(10), fontWeight: '700', color: '#94A3B8', letterSpacing: 1 },
  infoValue: { fontSize: fs(16), fontWeight: '900', color: '#FFFFFF', marginTop: 4, textAlign: 'center' },
  infoSep: { width: 1, backgroundColor: '#334155' },
  scanNextBtn: { height: 100, backgroundColor: '#00C853', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10, borderWidth: 3, borderColor: '#00A844', elevation: 6 },
  scanNextText: { color: '#FFFFFF', fontSize: fs(20), fontWeight: '900', letterSpacing: 2 },
});
