import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, TextInput, Modal,
} from 'react-native';
import PasswordLock from '../src/components/PasswordLock';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import {
  Resident, MaidCook, Visitor,
  getLocalResidents, saveLocalResidents, getLastSyncTime, setLastSyncTime,
  getLocalMaidsCooks, saveLocalMaidsCooks, setMaidCookLastSyncTime,
  getLocalVisitors, saveLocalVisitors, setVisitorLastSyncTime,
  clearSyncData,
} from '../src/services/storage';
import {
  downloadAllPhotos,
  cleanupExpiredPhotos,
  importPhotosFromBase64,
  attachLocalPhotosById,
  clearAllPhotos,
  MAIDCOOK_PHOTOS_DIR_NAME,
} from '../src/services/photos';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';
// Sheet GIDs: student_id=0, cooks_and_maids=1522969277, visitors=2129598920, visitor_log=63905656
const sheetGids = { students: '0', maidsCooks: '1522969277', visitors: '2129598920' };
const zipUrl = (token: string) => APPS_SCRIPT_URL + '?action=get_zip&token=' + encodeURIComponent(token);
const PHOTO_URL_TEMPLATE: string = '';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') { inQuotes = !inQuotes; }
      else if (line[c] === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += line[c]; }
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function getCol(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k] || row[k.toLowerCase()] || row[k.toUpperCase()];
    if (val) return val.trim();
  }
  return '';
}

function resolvePhotoUrl(id: string, row: Record<string, string>): string {
  const fromSheet = getCol(row, 'Photo URL', 'photo_url', 'Photo', 'photo');
  if (fromSheet) return fromSheet;
  if (PHOTO_URL_TEMPLATE && PHOTO_URL_TEMPLATE.includes('{id}')) {
    return PHOTO_URL_TEMPLATE.replace('{id}', encodeURIComponent(id));
  }
  return '';
}

export default function SyncScreen() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [localCountMC, setLocalCountMC] = useState(0);
  const [localCountV, setLocalCountV] = useState(0);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearPassword, setShowClearPassword] = useState(false);

  const [syncToken, setSyncToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => { loadStatus(); }, []);

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

  const fetchCsv = async (opts: { gid?: string; sheet?: string }): Promise<Record<string, string>[]> => {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_csv', ...opts, token: syncToken.trim() }),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const raw = await res.text();
    if (raw.trimStart().startsWith('{')) {
      const err = JSON.parse(raw);
      if (!err.ok) throw new Error(err.error || 'Access denied');
    }
    return parseCSV(raw);
  };

  const processRows = <T extends { id: string }>(
    rows: Record<string, string>[],
    existing: T[],
    buildEntry: (id: string, row: Record<string, string>, ex: T | undefined) => T,
  ) => {
    const existingMap = new Map<string, T>();
    for (const e of existing) existingMap.set(e.id.toLowerCase(), e);
    const all = new Map<string, T>();
    for (const e of existing) all.set(e.id.toLowerCase(), e);

    let added = 0, updated = 0, photoOnly = 0, dataOnly = 0, deleted = 0, skipped = 0;

    for (const row of rows) {
      const id = getCol(row, 'ID', 'Id', 'id');
      if (!id) continue;
      const flag = getCol(row, 'update', 'Update', 'UPDATE').toLowerCase() || 'n';
      if (flag === 'd') { all.delete(id.toLowerCase()); deleted++; continue; }
      const name = getCol(row, 'Name', 'name', 'NAME');
      if (!name) { skipped++; continue; }

      const ex = existingMap.get(id.toLowerCase());
      if (flag === 'n') { all.set(id.toLowerCase(), buildEntry(id, row, undefined)); added++; }
      else if (flag === 'u') { all.set(id.toLowerCase(), buildEntry(id, row, ex)); updated++; }
      else if (flag === 'up') {
        if (ex) {
          const mobile = getCol(row, 'Mobile', 'mobile', 'MOBILE', 'Phone', 'phone');
          all.set(id.toLowerCase(), { ...ex, photo_url: resolvePhotoUrl(id, row), local_photo: '', updated_at: new Date().toISOString() } as any);
        }
        photoOnly++;
      } else if (flag === 'ud') {
        all.set(id.toLowerCase(), buildEntry(id, row, ex));
        dataOnly++;
      } else { skipped++; }
    }

    return { items: Array.from(all.values()), added, updated, photoOnly, dataOnly, deleted, skipped };
  };

  const handleSync = async () => {
    if (!syncToken.trim()) { setSyncError('Enter password first'); return; }
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      // ── 1. Fetch students ──
      setSyncResult('Fetching students...');
      const studentRows = await fetchCsv({ gid: sheetGids.students });

      // ── 2. Fetch maids/cooks ──
      setSyncResult('Fetching maids & cooks...');
      const maidRows = await fetchCsv({ gid: sheetGids.maidsCooks });

      // ── 3. Fetch visitors (optional – sheet may not exist yet) ──
      let visitorRows: Record<string, string>[] = [];
      try {
        setSyncResult('Fetching visitors...');
        visitorRows = await fetchCsv({ gid: sheetGids.visitors });
      } catch (_) { /* visitors sheet may not exist yet */ }

      // ── 4. Process students ──
      setSyncResult(`Processing ${studentRows.length} students...`);
      const existingResidents = await getLocalResidents();
      const sResult = processRows<Resident>(studentRows, existingResidents, (id, row, ex) => {
        const mobile = getCol(row, 'Mobile', 'mobile', 'MOBILE', 'Phone', 'phone');
        const incoming = {
          name: getCol(row, 'Name', 'name', 'NAME'),
          unit: getCol(row, 'flat number', 'Flat', 'flat', 'FLAT', 'Unit', 'unit'),
          aadhar_masked: getCol(row, 'Aadhar/SRMID', 'Aadhar', 'aadhar', 'AADHAR'),
          phone_last4: mobile ? mobile.replace(/\D/g, '').slice(-4) : '',
          photo_url: resolvePhotoUrl(id, row),
          validity: getCol(row, 'ValidTill', 'Validity', 'validity', 'VALIDITY'),
          vehicle_plate: getCol(row, 'Vehicle', 'vehicle', 'Vehicle Plate', 'vehicle_plate'),
        };
        const flag = getCol(row, 'update', 'Update', 'UPDATE').toLowerCase();
        if (flag === 'ud' && ex) {
          return { ...ex, ...incoming, photo_url: ex.photo_url, local_photo: ex.local_photo, updated_at: new Date().toISOString() };
        }
        const base = ex || { id, photo_base64: '', status: 'active', created_at: new Date().toISOString() } as any;
        return { ...base, ...incoming, local_photo: flag === 'n' ? '' : (ex ? '' : ''), photo_base64: base.photo_base64 || '', updated_at: new Date().toISOString(), id, status: base.status || 'active', created_at: base.created_at || new Date().toISOString() };
      });

      // ── 5. Process maids/cooks ──
      setSyncResult(`Processing ${maidRows.length} maids/cooks...`);
      const existingMC = await getLocalMaidsCooks();
      const mResult = processRows<MaidCook>(maidRows, existingMC, (id, row, ex) => {
        const mobile = getCol(row, 'Mobile', 'mobile', 'MOBILE', 'Phone', 'phone');
        const incoming = {
          name: getCol(row, 'Name', 'name', 'NAME'),
          flats: getCol(row, 'flat number', 'Flat', 'flat', 'FLAT', 'Flats', 'flats'),
          aadhar_masked: getCol(row, 'Aadhar/SRMID', 'Aadhar', 'aadhar', 'AADHAR'),
          phone_last4: mobile ? mobile.replace(/\D/g, '').slice(-4) : '',
          photo_url: resolvePhotoUrl(id, row),
          validity: getCol(row, 'ValidTill', 'Validity', 'validity', 'VALIDITY'),
          vehicle_plate: getCol(row, 'Vehicle', 'vehicle', 'Vehicle Plate', 'vehicle_plate'),
        };
        const flag = getCol(row, 'update', 'Update', 'UPDATE').toLowerCase();
        if (flag === 'ud' && ex) {
          return { ...ex, ...incoming, photo_url: ex.photo_url, local_photo: ex.local_photo, updated_at: new Date().toISOString() };
        }
        const base = ex || { id, photo_base64: '', status: 'active', created_at: new Date().toISOString() } as any;
        return { ...base, ...incoming, local_photo: flag === 'n' ? '' : (ex ? '' : ''), photo_base64: base.photo_base64 || '', updated_at: new Date().toISOString(), id, status: base.status || 'active', created_at: base.created_at || new Date().toISOString() };
      });

      // ── 6. Process visitors (no ID/update column – full replace) ──
      let visitorCount = 0;
      if (visitorRows.length > 0) {
        setSyncResult(`Processing ${visitorRows.length} visitors...`);
        const existingV = await getLocalVisitors();
        // Build map of existing photos by id so we preserve them
        const existingPhotoMap = new Map<string, string>();
        const existingIdPhotoMap = new Map<string, string>();
        const existingCardMap = new Map<string, string>();
        for (const v of existingV) {
          if (v.local_photo) existingPhotoMap.set(v.id.toLowerCase(), v.local_photo);
          if (v.local_photo_id) existingIdPhotoMap.set(v.id.toLowerCase(), v.local_photo_id);
          if (v.card_number) existingCardMap.set(v.id.toLowerCase(), v.card_number);
        }

        const visitors: Visitor[] = [];
        for (const row of visitorRows) {
          const name = getCol(row, 'Visitor Name', 'visitor name', 'Name', 'name');
          const flat = getCol(row, 'Flat', 'flat', 'FLAT', 'flat number');
          if (!name || !flat) continue;
          const visitDate = getCol(row, 'Visit Date', 'visit date', 'Visit date');
          // Generate stable ID from flat + name + visit date
          const id = (flat + '_' + name + '_' + visitDate).replace(/[^A-Za-z0-9]/g, '_').toLowerCase();
          const existingPhoto = existingPhotoMap.get(id) || '';
          visitors.push({
            id,
            name,
            flat,
            aadhar_last4: getCol(row, 'Last 4 digits of Adhaar', 'last 4 digits of adhaar', 'Adhaar', 'Aadhar'),
            nature: getCol(row, 'Nature of Visitor', 'nature of visitor', 'Nature', 'nature'),
            visit_date: visitDate,
            requested_by: getCol(row, 'Request raised by', 'request raised by'),
            check_in: getCol(row, 'Check In', 'check in', 'Check in'),
            check_out: getCol(row, 'Check out', 'check out', 'Check Out'),
            night_stay: getCol(row, 'Night Stay', 'night stay', 'Nights'),
            office_status: getCol(row, 'EFOA Office Status', 'efoa office status', 'Status', 'status'),
            local_photo: existingPhoto,
            local_photo_id: existingIdPhotoMap.get(id) || '',
            card_number: existingCardMap.get(id) || '',
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        visitorCount = visitors.length;
        await saveLocalVisitors(visitors);
        setLocalCountV(visitors.length);
        await setVisitorLastSyncTime(new Date().toISOString());
      }

      // ── 7. Download & extract photos ZIP ──
      const needsPhoto = sResult.added > 0 || sResult.updated > 0 || sResult.photoOnly > 0 ||
                          mResult.added > 0 || mResult.updated > 0 || mResult.photoOnly > 0;

      if (needsPhoto) {
        setSyncResult('Downloading photos ZIP...');
        const zipRes = await fetch(zipUrl(syncToken.trim()), { redirect: 'follow' });
        if (!zipRes.ok) throw new Error('Failed to download ZIP: ' + zipRes.status);
        const zipBase64 = await zipRes.text();
        if (zipBase64.trimStart().startsWith('{')) {
          const errObj = JSON.parse(zipBase64);
          if (!errObj.ok) throw new Error(errObj.error || 'ZIP access denied');
        }
        setSyncResult('Extracting photos...');
        await importPhotosFromBase64(zipBase64, (done, total) => {
          setSyncResult(`Extracting photos: ${done}/${total}`);
        });
      }

      // ── 8. Attach local photos ──
      const studentsAttached = await attachLocalPhotosById(sResult.items);
      const maidsAttached = await attachLocalPhotosById(mResult.items, MAIDCOOK_PHOTOS_DIR_NAME);

      // ── 9. Save students ──
      if (needsPhoto) {
        setSyncResult('Downloading fallback URL photos...');
        const withPhotos = await downloadAllPhotos(studentsAttached, (done, total) => {
          setSyncResult(`Photos: ${done}/${total}`);
        });
        const cleaned = await cleanupExpiredPhotos(withPhotos);
        await saveLocalResidents(cleaned);
        setLocalCount(cleaned.length);
      } else {
        await saveLocalResidents(studentsAttached);
        setLocalCount(studentsAttached.length);
      }

      // ── 10. Save maids/cooks (download photos from photo_url to separate dir) ──
      const mcNeedsPhoto = mResult.added > 0 || mResult.updated > 0 || mResult.photoOnly > 0;
      if (mcNeedsPhoto) {
        setSyncResult('Downloading maid/cook photos...');
        const mcWithPhotos = await downloadAllPhotos(maidsAttached, (done, total) => {
          setSyncResult(`Maid/cook photos: ${done}/${total}`);
        }, MAIDCOOK_PHOTOS_DIR_NAME);
        await saveLocalMaidsCooks(mcWithPhotos);
        setLocalCountMC(mcWithPhotos.length);
      } else {
        await saveLocalMaidsCooks(maidsAttached);
        setLocalCountMC(maidsAttached.length);
      }

      const now = new Date().toISOString();
      await setLastSyncTime(now);
      await setMaidCookLastSyncTime(now);
      setLastSync(now);

      const parts: string[] = [];
      if (studentRows.length > 0) parts.push(`Students: N${sResult.added} U${sResult.updated} D${sResult.deleted}`);
      if (maidRows.length > 0) parts.push(`Maids: N${mResult.added} U${mResult.updated} D${mResult.deleted}`);
      if (visitorRows.length > 0) parts.push(`Visitors: ${visitorCount}`);
      setSyncResult('Done! ' + parts.join(' | '));
    } catch (error: any) {
      setSyncError(`SYNC FAILED: ${error?.message || 'Check connection'}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SafeAreaView testID="sync-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>SYNC</Text>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ── Password ── */}
        <View style={styles.passwordRow}>
          <Ionicons name="lock-closed" size={20} color="#78350F" />
          <TextInput
            style={styles.passwordInput}
            value={syncToken}
            onChangeText={setSyncToken}
            placeholder="Enter sync password"
            placeholderTextColor="#94A3B8"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 6 }}>
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color="#475569" />
          </TouchableOpacity>
        </View>

        {/* ── Status Card ── */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="school" size={22} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>STUDENTS</Text>
              <Text style={styles.statusValue}>{localCount}</Text>
            </View>
            <Ionicons name="restaurant" size={22} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>MAIDS/COOKS</Text>
              <Text style={styles.statusValue}>{localCountMC}</Text>
            </View>
            <Ionicons name="person-add" size={22} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>VISITORS</Text>
              <Text style={styles.statusValue}>{localCountV}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.statusRow}>
            <Ionicons name="time" size={24} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>LAST SYNCED</Text>
              <Text style={styles.statusValue}>{lastSync ? formatSyncTime(lastSync) : 'NEVER'}</Text>
            </View>
          </View>
        </View>

        {/* ── Sync Button ── */}
        <TouchableOpacity
          testID="import-sheet-btn"
          style={[styles.importBtn, syncing && styles.btnDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? <ActivityIndicator color="#FFFFFF" /> : (
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
            style={[styles.clearBtn, (clearing || syncing) && styles.btnDisabled]}
            onPress={() => setShowClearPassword(true)}
            disabled={clearing || syncing}
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
  statusCard: { borderWidth: 2, borderColor: '#000000', padding: 16, backgroundColor: '#F8FAFC', marginBottom: 24, elevation: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusInfo: { flex: 1 },
  statusLabel: { fontSize: fs(10), fontWeight: '700', color: '#64748B', letterSpacing: 2 },
  statusValue: { fontSize: fs(18), fontWeight: '900', color: '#000000', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 12 },
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
});
