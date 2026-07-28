import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, TextInput, Modal, Platform,
} from 'react-native';
import PasswordLock from '../src/components/PasswordLock';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import {
  getLocalResidents, getLastSyncTime, setLastSyncTime,
  getLocalMaidsCooks, getLocalVisitors,
  clearSyncData, getSyncToken, setSyncToken,
} from '../src/services/storage';
import { clearAllPhotos } from '../src/services/photos';
import { syncStudentsData, syncMaidsCooksData, syncVisitorsData, syncZohoGuestsData } from '../src/services/dataSync';
export default function SyncScreen() {
  const [syncing, setSyncing] = useState<string | null>(null); // null | 'all' | 'students' | 'maidcooks' | 'visitors'
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [localCountMC, setLocalCountMC] = useState(0);
  const [localCountV, setLocalCountV] = useState(0);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearPassword, setShowClearPassword] = useState(false);

  const [tokenInput, setTokenInput] = useState('');
  const tokenRef = useRef('');
  const [showPassword, setShowPassword] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenModalInput, setTokenModalInput] = useState('');
  const tokenResolveRef = useRef<((val: string | null) => void) | null>(null);

  // Keep ref in sync with state
  useEffect(() => { tokenRef.current = tokenInput; }, [tokenInput]);

  useEffect(() => {
    loadStatus();
    getSyncToken().then(t => { if (t) { setTokenInput(t); tokenRef.current = t; } });
  }, []);

  const loadStatus = async () => {
    const residents = await getLocalResidents();
    setLocalCount(residents.length);
    const maidsCooks = await getLocalMaidsCooks();
    setLocalCountMC(maidsCooks.length);
    const visitors = await getLocalVisitors();
    setLocalCountV(visitors.length);
    const syncTime = await getLastSyncTime();
    setLastSync(syncTime);
  };

  const formatSyncTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Sync bodies live in the headless service (src/services/dataSync.ts) so the
  // hourly background auto-sync and these buttons run the exact same logic.
  // Progress strings flow to the on-screen status; counts refresh via loadStatus().
  const syncStudents = () => syncStudentsData(tokenRef.current, setSyncResult);
  const syncMaidsCooks = () => syncMaidsCooksData(tokenRef.current, setSyncResult);
  const syncVisitors = () => syncVisitorsData(tokenRef.current, setSyncResult);

  const handleSyncCategory = async (category: 'students' | 'maidcooks' | 'visitors') => {
    const token = await ensureToken();
    if (!token) return;
    setSyncing(category);
    setSyncResult(null);
    setSyncError(null);
    try {
      let result = '';
      if (category === 'students') result = await syncStudents();
      else if (category === 'maidcooks') result = await syncMaidsCooks();
      else if (category === 'visitors') result = await syncVisitors();
      const now = new Date().toISOString();
      setLastSync(now);
      await setSyncToken(tokenRef.current);
      await loadStatus();
      setSyncResult('Done! ' + result);
    } catch (error: any) {
      if (error?.isTokenError) {
        setTokenInput(''); tokenRef.current = ''; await setSyncToken('');
        setSyncError('Wrong token. Enter the correct token.');
        setSyncing(null);
        const newToken = await ensureToken();
        if (newToken) handleSyncCategory(category);
        return;
      }
      setSyncError(`SYNC FAILED: ${error?.message || 'Check connection'}`);
    } finally {
      setSyncing(null);
    }
  };

  const handleSync = async () => {
    const token = await ensureToken();
    if (!token) return;
    setSyncing('all');
    setSyncResult(null);
    setSyncError(null);
    try {
      const parts: string[] = [];
      parts.push(await syncStudents());
      // Maid/cook sync disabled for now — not updated.
      try { parts.push(await syncVisitors()); } catch (_) { /* visitors sheet may not exist yet */ }
      // ZOHO guests come from a public sheet (no token needed).
      try { parts.push(await syncZohoGuestsData(setSyncResult)); } catch (_) { /* public sheet may be unreachable */ }

      const now = new Date().toISOString();
      await setLastSyncTime(now);
      setLastSync(now);
      await setSyncToken(tokenRef.current);
      await loadStatus();
      setSyncResult('Done! ' + parts.join(' | '));
    } catch (error: any) {
      if (error?.isTokenError) {
        setTokenInput(''); tokenRef.current = ''; await setSyncToken('');
        setSyncError('Wrong token. Enter the correct token.');
        setSyncing(null);
        const newToken = await ensureToken();
        if (newToken) handleSync();
        return;
      }
      setSyncError(`SYNC FAILED: ${error?.message || 'Check connection'}`);
    } finally {
      setSyncing(null);
    }
  };

  const promptForToken = (): Promise<string | null> => {
    return new Promise((resolve) => {
      Alert.prompt(
        'Sync Token',
        'Enter sync token to connect to Google Sheets',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Save', onPress: (val: string | undefined) => resolve(val?.trim() || null) },
        ],
        'secure-text',
        '',
        'default',
      );
    });
  };

  const ensureToken = async (): Promise<string | null> => {
    if (tokenRef.current) return tokenRef.current;
    // Try stored token
    const stored = await getSyncToken();
    if (stored) { setTokenInput(stored); tokenRef.current = stored; return stored; }
    // Prompt user
    if (Platform.OS === 'ios') {
      const val = await promptForToken();
      if (val) { setTokenInput(val); tokenRef.current = val; await setSyncToken(val); return val; }
      return null;
    }
    // Android: Alert.prompt not available, use a state-based modal
    return new Promise((resolve) => {
      setShowTokenModal(true);
      tokenResolveRef.current = resolve;
    });
  };

  return (
    <SafeAreaView testID="sync-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>SYNC</Text>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ── Category Sync Cards ── */}
        <View style={styles.categoryRow}>
          <TouchableOpacity
            style={[styles.categoryCard, syncing === 'students' && styles.categoryCardActive]}
            onPress={() => handleSyncCategory('students')}
            disabled={!!syncing}
          >
            {syncing === 'students' ? (
              <ActivityIndicator color="#78350F" size="small" />
            ) : (
              <Ionicons name="school" size={32} color="#78350F" />
            )}
            <Text style={styles.categoryCount}>{localCount}</Text>
            <Text style={styles.categoryLabel}>STUDENTS</Text>
            <Ionicons name="sync-circle" size={18} color={syncing ? '#CBD5E1' : '#0055FF'} style={styles.categorySyncIcon} />
          </TouchableOpacity>

          {/* Maid/cook sync disabled for now — data is not updated. */}
          <View style={[styles.categoryCard, { opacity: 0.45 }]}>
            <Ionicons name="restaurant" size={32} color="#94A3B8" />
            <Text style={styles.categoryCount}>{localCountMC}</Text>
            <Text style={styles.categoryLabel}>MAIDS/COOKS</Text>
            <Text style={{ fontSize: fs(8), fontWeight: '800', color: '#94A3B8', letterSpacing: 1, marginTop: 6 }}>DISABLED</Text>
          </View>

          <TouchableOpacity
            style={[styles.categoryCard, syncing === 'visitors' && styles.categoryCardActive]}
            onPress={() => handleSyncCategory('visitors')}
            disabled={!!syncing}
          >
            {syncing === 'visitors' ? (
              <ActivityIndicator color="#78350F" size="small" />
            ) : (
              <Ionicons name="person-add" size={32} color="#78350F" />
            )}
            <Text style={styles.categoryCount}>{localCountV}</Text>
            <Text style={styles.categoryLabel}>VISITORS</Text>
            <Ionicons name="sync-circle" size={18} color={syncing ? '#CBD5E1' : '#0055FF'} style={styles.categorySyncIcon} />
          </TouchableOpacity>
        </View>

        {/* ── Last Synced ── */}
        <View style={styles.lastSyncRow}>
          <Ionicons name="time" size={18} color="#78350F" />
          <Text style={styles.lastSyncLabel}>LAST SYNCED:</Text>
          <Text style={styles.lastSyncValue}>{lastSync ? formatSyncTime(lastSync) : 'NEVER'}</Text>
        </View>

        {/* ── Sync All Button ── */}
        <TouchableOpacity
          testID="import-sheet-btn"
          style={[styles.importBtn, !!syncing && styles.btnDisabled]}
          onPress={handleSync}
          disabled={!!syncing}
        >
          {syncing === 'all' ? <ActivityIndicator color="#FFFFFF" /> : (
            <>
              <Ionicons name="cloud-download" size={24} color="#FFFFFF" />
              <Text style={styles.importBtnText}>SYNC ALL DATA</Text>
            </>
          )}
        </TouchableOpacity>

        {syncResult && (
          <View testID="sync-success" style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={20} color="#00C853" />
            <Text style={styles.successText}>{syncResult}</Text>
          </View>
        )}
        {syncError && (
          <View testID="sync-error" style={styles.errorBox}>
            <Ionicons name="alert-circle" size={20} color="#FF3B30" />
            <Text style={styles.errorText}>{syncError}</Text>
          </View>
        )}

        <View style={styles.offlineNote}>
          <Ionicons name="wifi-outline" size={18} color="#FFB300" />
          <Text style={styles.offlineText}>INTERNET REQUIRED ONLY FOR SYNC</Text>
        </View>

        {/* ── Clear All Data ── */}
        <View style={{ marginTop: 32, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 24 }}>
          <TouchableOpacity
            style={[styles.clearBtn, (clearing || !!syncing) && styles.btnDisabled]}
            onPress={() => setShowClearPassword(true)}
            disabled={clearing || !!syncing}
          >
            {clearing ? <ActivityIndicator color="#FFFFFF" /> : (
              <>
                <Ionicons name="trash" size={22} color="#FFFFFF" />
                <Text style={styles.clearBtnText}>CLEAR ALL DATA</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Password modal for clear data */}
      <Modal visible={showClearPassword} animationType="slide" transparent={false} onRequestClose={() => setShowClearPassword(false)}>
        <PasswordLock
          title="Enter password to clear data"
          onUnlock={() => {
            setShowClearPassword(false);
            Alert.alert(
              'Clear All Data',
              'This will delete ALL residents, maids/cooks, visitors, photos, and logs. You will need to sync again.\n\nAre you sure?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear Everything',
                  style: 'destructive',
                  onPress: async () => {
                    setClearing(true);
                    try {
                      await clearSyncData();
                      await clearAllPhotos();
                      setLocalCount(0);
                      setLocalCountMC(0);
                      setLocalCountV(0);
                      setLastSync(null);
                      setSyncResult(null);
                      Alert.alert('Done', 'All data and photos cleared.');
                    } catch (e: any) {
                      Alert.alert('Error', e.message || 'Failed to clear data');
                    } finally {
                      setClearing(false);
                    }
                  },
                },
              ],
            );
          }}
        />
        <TouchableOpacity
          onPress={() => setShowClearPassword(false)}
          style={{ position: 'absolute', top: 50, left: 16, zIndex: 10, backgroundColor: '#00000080', borderRadius: 20, padding: 8 }}
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </Modal>

      {/* Token input modal for Android (Alert.prompt not available) */}
      <Modal visible={showTokenModal} transparent animationType="fade" onRequestClose={() => {
        setShowTokenModal(false);
        tokenResolveRef.current?.(null);
        tokenResolveRef.current = null;
      }}>
        <View style={styles.tokenModalOverlay}>
          <View style={styles.tokenModalBox}>
            <Text style={styles.tokenModalTitle}>Sync Token</Text>
            <Text style={styles.tokenModalSubtitle}>Enter token to connect to Google Sheets</Text>
            <TextInput
              style={styles.tokenModalInput}
              value={tokenModalInput}
              onChangeText={setTokenModalInput}
              placeholder="Token"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <View style={styles.tokenModalBtns}>
              <TouchableOpacity style={styles.tokenModalCancelBtn} onPress={() => {
                setShowTokenModal(false);
                setTokenModalInput('');
                tokenResolveRef.current?.(null);
                tokenResolveRef.current = null;
              }}>
                <Text style={styles.tokenModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.tokenModalSaveBtn} onPress={async () => {
                const val = tokenModalInput.trim();
                setShowTokenModal(false);
                setTokenModalInput('');
                if (val) {
                  setTokenInput(val);
                  tokenRef.current = val;
                  await setSyncToken(val);
                  tokenResolveRef.current?.(val);
                } else {
                  tokenResolveRef.current?.(null);
                }
                tokenResolveRef.current = null;
              }}>
                <Text style={styles.tokenModalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: { backgroundColor: '#78350F', paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleText: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB', letterSpacing: 2 },
  scrollContent: { padding: 20 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#78350F', backgroundColor: '#FFFBEB', paddingHorizontal: 12, paddingVertical: 4, marginBottom: 20, gap: 8 },
  passwordInput: { flex: 1, fontSize: fs(14), color: '#0F172A', paddingVertical: 10 },
  categoryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  categoryCard: { flex: 1, borderWidth: 2, borderColor: '#000000', backgroundColor: '#F8FAFC', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4, elevation: 4 },
  categoryCardActive: { borderColor: '#0055FF', backgroundColor: '#EFF6FF' },
  categoryCount: { fontSize: fs(22), fontWeight: '900', color: '#000000', marginTop: 6 },
  categoryLabel: { fontSize: fs(9), fontWeight: '800', color: '#64748B', letterSpacing: 1, marginTop: 2 },
  categorySyncIcon: { marginTop: 8 },
  lastSyncRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, paddingHorizontal: 4 },
  lastSyncLabel: { fontSize: fs(10), fontWeight: '700', color: '#64748B', letterSpacing: 1 },
  lastSyncValue: { fontSize: fs(13), fontWeight: '900', color: '#000000' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: fs(12), fontWeight: '900', color: '#D97706', letterSpacing: 1 },
  sheetConfig: { borderWidth: 1, borderColor: '#E2E8F0', padding: 14, backgroundColor: '#F8FAFC', marginBottom: 16 },
  sheetHint: { fontSize: fs(12), color: '#64748B', lineHeight: 18, marginBottom: 10 },
  sheetInput: { borderWidth: 2, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 10, fontSize: fs(13), backgroundColor: '#FFFFFF', minHeight: 56 },
  sheetBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  saveUrlBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#78350F' },
  saveUrlText: { color: '#FFFBEB', fontSize: fs(12), fontWeight: '900' },
  importBtn: { height: 64, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10, borderWidth: 2, borderColor: '#000000', marginBottom: 12 },
  importBtnText: { color: '#FFFFFF', fontSize: fs(16), fontWeight: '900', letterSpacing: 1 },
  btnDisabled: { opacity: 0.6 },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#F0FFF4', borderWidth: 1, borderColor: '#00C853', marginBottom: 12 },
  successText: { fontSize: fs(13), fontWeight: '700', color: '#00C853', flex: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FF3B30', marginBottom: 12 },
  errorText: { fontSize: fs(13), fontWeight: '700', color: '#FF3B30', flex: 1 },
  offlineNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  offlineText: { fontSize: fs(11), fontWeight: '700', color: '#FFB300', letterSpacing: 1 },
  clearBtn: { height: 56, backgroundColor: '#DC2626', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10, borderWidth: 2, borderColor: '#991B1B' },
  clearBtnText: { color: '#FFFFFF', fontSize: fs(15), fontWeight: '900', letterSpacing: 1 },
  tokenModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  tokenModalBox: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 },
  tokenModalTitle: { fontSize: fs(18), fontWeight: '900', color: '#0F172A', marginBottom: 4 },
  tokenModalSubtitle: { fontSize: fs(12), color: '#64748B', marginBottom: 16 },
  tokenModalInput: { borderWidth: 2, borderColor: '#78350F', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: fs(14), color: '#0F172A', marginBottom: 16 },
  tokenModalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  tokenModalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  tokenModalCancelText: { fontSize: fs(14), color: '#64748B', fontWeight: '700' },
  tokenModalSaveBtn: { backgroundColor: '#78350F', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  tokenModalSaveText: { fontSize: fs(14), color: '#FFFFFF', fontWeight: '900' },
});
