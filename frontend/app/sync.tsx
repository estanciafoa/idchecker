import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import { Resident, MaidCook, getLocalResidents, saveLocalResidents, getLastSyncTime, setLastSyncTime, getLocalMaidsCooks, saveLocalMaidsCooks, getMaidCookLastSyncTime, setMaidCookLastSyncTime, clearSyncData } from '../src/services/storage';
import {
  downloadAllPhotos,
  cleanupExpiredPhotos,
  importPhotosFromBase64,
  attachLocalPhotosById,
  clearAllPhotos,
} from '../src/services/photos';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';
const sheetUrl = (token: string) => APPS_SCRIPT_URL + '?action=get_csv&sheet=student%20id&token=' + encodeURIComponent(token);
const maidsCooksSheetUrl = (token: string) => APPS_SCRIPT_URL + '?action=get_csv&gid=1522969277&token=' + encodeURIComponent(token);
const zipUrl = (token: string) => APPS_SCRIPT_URL + '?action=get_zip&token=' + encodeURIComponent(token);
// Optional fallback when photo_url column is empty.
// Use {id} placeholder, e.g. 'https://example.com/photos/{id}.jpg'
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
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [syncingMC, setSyncingMC] = useState(false);
  const [lastSyncMC, setLastSyncMC] = useState<string | null>(null);
  const [localCountMC, setLocalCountMC] = useState(0);
  const [syncResultMC, setSyncResultMC] = useState<string | null>(null);
  const [syncErrorMC, setSyncErrorMC] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const [syncToken, setSyncToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    const residents = await getLocalResidents();
    setLocalCount(residents.length);
    const syncTime = await getLastSyncTime();
    setLastSync(syncTime);

    const maidsCooks = await getLocalMaidsCooks();
    setLocalCountMC(maidsCooks.length);
    const syncTimeMC = await getMaidCookLastSyncTime();
    setLastSyncMC(syncTimeMC);
  };

  const handleImportFromSheet = async () => {
    if (!syncToken.trim()) { setSyncError('Enter password first'); return; }
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      setSyncResult('Fetching sheet...');
      const response = await fetch(sheetUrl(syncToken));
      if (!response.ok) throw new Error('Failed to fetch sheet: ' + response.status);
      const rawText = await response.text();
      // Apps Script returns JSON error for invalid token
      if (rawText.trimStart().startsWith('{')) {
        const errObj = JSON.parse(rawText);
        if (!errObj.ok) throw new Error(errObj.error || 'Access denied');
      }
      const csvText = rawText;
      const rows = parseCSV(csvText);
      if (rows.length === 0) throw new Error('No data found in sheet');

      setSyncResult(`Parsing ${rows.length} rows...`);
      const existingResidents = await getLocalResidents();
      const existingMap = new Map<string, Resident>();
      for (const r of existingResidents) existingMap.set(r.id.toLowerCase(), r);

      let added = 0, updated = 0, photoOnly = 0, dataOnly = 0, deleted = 0, skipped = 0;
      const allResidents = new Map<string, Resident>();
      for (const r of existingResidents) allResidents.set(r.id.toLowerCase(), r);

      const photoOnlyIds: string[] = [];

      for (const row of rows) {
        const id = getCol(row, 'ID', 'Id', 'id');
        if (!id) continue;

        const updateFlag = getCol(row, 'update', 'Update', 'UPDATE').toLowerCase();
        if (!updateFlag) { skipped++; continue; }

        // Delete only needs ID
        if (updateFlag === 'd') {
          allResidents.delete(id.toLowerCase());
          deleted++;
          continue;
        }

        const name = getCol(row, 'Name', 'name', 'NAME');
        if (!name) { skipped++; continue; }

        const mobile = getCol(row, 'Mobile', 'mobile', 'MOBILE', 'Phone', 'phone');
        const incoming = {
          name,
          unit: getCol(row, 'flat number', 'Flat', 'flat', 'FLAT', 'Unit', 'unit'),
          aadhar_masked: getCol(row, 'Aadhar/SRMID', 'Aadhar', 'aadhar', 'AADHAR'),
          phone_last4: mobile ? mobile.replace(/\D/g, '').slice(-4) : '',
          photo_url: resolvePhotoUrl(id, row),
          validity: getCol(row, 'ValidTill', 'Validity', 'validity', 'VALIDITY'),
          vehicle_plate: getCol(row, 'Vehicle', 'vehicle', 'Vehicle Plate', 'vehicle_plate'),
        };

        const existing = existingMap.get(id.toLowerCase());

        if (updateFlag === 'n') {
          // New entry — add with full data + photo
          allResidents.set(id.toLowerCase(), {
            id,
            ...incoming,
            photo_base64: '',
            local_photo: '',
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          added++;
        } else if (updateFlag === 'u') {
          // Full update — data + photo
          const base = existing || { id, photo_base64: '', status: 'active', created_at: new Date().toISOString() };
          allResidents.set(id.toLowerCase(), {
            ...base,
            ...incoming,
            local_photo: '', // clear to re-download photo
            updated_at: new Date().toISOString(),
          });
          updated++;
        } else if (updateFlag === 'up') {
          // Photo only — keep existing data, just refresh photo
          if (existing) {
            allResidents.set(id.toLowerCase(), {
              ...existing,
              photo_url: incoming.photo_url,
              local_photo: '', // clear to re-download
              updated_at: new Date().toISOString(),
            });
          }
          photoOnlyIds.push(id);
          photoOnly++;
        } else if (updateFlag === 'ud') {
          // Data only — update all fields except photo
          if (existing) {
            allResidents.set(id.toLowerCase(), {
              ...existing,
              ...incoming,
              photo_url: existing.photo_url, // keep existing photo_url
              local_photo: existing.local_photo, // keep existing local photo
              updated_at: new Date().toISOString(),
            });
          } else {
            allResidents.set(id.toLowerCase(), {
              id,
              ...incoming,
              photo_base64: '',
              local_photo: '',
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          dataOnly++;
        } else {
          skipped++;
        }
      }

      const finalList = Array.from(allResidents.values());
      const needsPhoto = added > 0 || updated > 0 || photoOnly > 0;

      if (needsPhoto) {
        setSyncResult(`N:${added} U:${updated} UP:${photoOnly} UD:${dataOnly} D:${deleted}. Downloading ZIP...`);
        const zipRes = await fetch(zipUrl(syncToken), { redirect: 'follow' });
        if (!zipRes.ok) throw new Error('Failed to download ZIP: ' + zipRes.status);
        const zipBase64 = await zipRes.text();
        if (zipBase64.trimStart().startsWith('{')) {
          const errObj = JSON.parse(zipBase64);
          if (!errObj.ok) throw new Error(errObj.error || 'ZIP access denied');
        }
        setSyncResult(`Extracting photos...`);
        await importPhotosFromBase64(zipBase64, (done, total) => {
          setSyncResult(`Extracting photos: ${done}/${total}`);
        });
      }

      const withLocalById = await attachLocalPhotosById(finalList);

      if (needsPhoto) {
        setSyncResult(`Downloading fallback URL photos...`);
        const withPhotos = await downloadAllPhotos(withLocalById, (done, total) => {
          setSyncResult(`Photos: ${done}/${total}`);
        });
        setSyncResult(`Cleaning up expired photos...`);
        const cleaned = await cleanupExpiredPhotos(withPhotos);
        await saveLocalResidents(cleaned);
        setLocalCount(cleaned.length);
      } else {
        await saveLocalResidents(withLocalById);
        setLocalCount(withLocalById.length);
      }

      const now = new Date().toISOString();
      await setLastSyncTime(now);
      setLastSync(now);
      setSyncResult(`Done! N:${added} U:${updated} UP:${photoOnly} UD:${dataOnly} D:${deleted} Skipped:${skipped}`);
    } catch (error: any) {
      setSyncError(`IMPORT FAILED: ${error?.message || 'Check connection & sheet URL'}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatSyncTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const handleImportMaidsCooks = async () => {
    if (!syncToken.trim()) { setSyncErrorMC('Enter password first'); return; }
    setSyncingMC(true);
    setSyncResultMC(null);
    setSyncErrorMC(null);
    try {
      setSyncResultMC('Fetching cooks & maids sheet...');
      const response = await fetch(maidsCooksSheetUrl(syncToken));
      if (!response.ok) throw new Error('Failed to fetch sheet: ' + response.status);
      const rawText = await response.text();
      if (rawText.trimStart().startsWith('{')) {
        const errObj = JSON.parse(rawText);
        if (!errObj.ok) throw new Error(errObj.error || 'Access denied');
      }
      const csvText = rawText;
      const rows = parseCSV(csvText);
      if (rows.length === 0) throw new Error('No data found in sheet');

      setSyncResultMC(`Parsing ${rows.length} rows...`);
      const existing = await getLocalMaidsCooks();
      const existingMap = new Map<string, MaidCook>();
      for (const m of existing) existingMap.set(m.id.toLowerCase(), m);

      let added = 0, updated = 0, photoOnly = 0, dataOnly = 0, deleted = 0, skipped = 0;
      const allMC = new Map<string, MaidCook>();
      for (const m of existing) allMC.set(m.id.toLowerCase(), m);

      for (const row of rows) {
        const id = getCol(row, 'ID', 'Id', 'id');
        if (!id) continue;

        const updateFlag = getCol(row, 'update', 'Update', 'UPDATE').toLowerCase();
        if (!updateFlag) { skipped++; continue; }

        // Delete only needs ID
        if (updateFlag === 'd') {
          allMC.delete(id.toLowerCase());
          deleted++;
          continue;
        }

        const name = getCol(row, 'Name', 'name', 'NAME');
        if (!name) { skipped++; continue; }

        const mobile = getCol(row, 'Mobile', 'mobile', 'MOBILE', 'Phone', 'phone');
        const incoming: Partial<MaidCook> = {
          name,
          flats: getCol(row, 'flat number', 'Flat', 'flat', 'FLAT', 'Flats', 'flats'),
          aadhar_masked: getCol(row, 'Aadhar/SRMID', 'Aadhar', 'aadhar', 'AADHAR'),
          phone_last4: mobile ? mobile.replace(/\D/g, '').slice(-4) : '',
          photo_url: resolvePhotoUrl(id, row),
          validity: getCol(row, 'ValidTill', 'Validity', 'validity', 'VALIDITY'),
          vehicle_plate: getCol(row, 'Vehicle', 'vehicle', 'Vehicle Plate', 'vehicle_plate'),
        };

        const ex = existingMap.get(id.toLowerCase());

        if (updateFlag === 'n') {
          allMC.set(id.toLowerCase(), {
            id,
            ...incoming as any,
            photo_base64: '',
            local_photo: '',
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          added++;
        } else if (updateFlag === 'u') {
          const base = ex || { id, photo_base64: '', status: 'active', created_at: new Date().toISOString() };
          allMC.set(id.toLowerCase(), {
            ...base,
            ...incoming as any,
            local_photo: '',
            updated_at: new Date().toISOString(),
          });
          updated++;
        } else if (updateFlag === 'up') {
          if (ex) {
            allMC.set(id.toLowerCase(), {
              ...ex,
              photo_url: incoming.photo_url || ex.photo_url,
              local_photo: '',
              updated_at: new Date().toISOString(),
            });
          }
          photoOnly++;
        } else if (updateFlag === 'ud') {
          if (ex) {
            allMC.set(id.toLowerCase(), {
              ...ex,
              ...incoming as any,
              photo_url: ex.photo_url,
              local_photo: ex.local_photo,
              updated_at: new Date().toISOString(),
            });
          } else {
            allMC.set(id.toLowerCase(), {
              id,
              ...incoming as any,
              photo_base64: '',
              local_photo: '',
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          dataOnly++;
        } else {
          skipped++;
        }
      }

      const finalList = Array.from(allMC.values());
      await saveLocalMaidsCooks(finalList);
      const now = new Date().toISOString();
      await setMaidCookLastSyncTime(now);
      setLocalCountMC(finalList.length);
      setLastSyncMC(now);
      setSyncResultMC(`Done! N:${added} U:${updated} UP:${photoOnly} UD:${dataOnly} D:${deleted} Skipped:${skipped}`);
    } catch (error: any) {
      setSyncErrorMC(`IMPORT FAILED: ${error?.message || 'Check connection & sheet URL'}`);
    } finally {
      setSyncingMC(false);
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

        {/* ── Students Sync Section ── */}
        <View style={styles.sectionHeader}>
          <Ionicons name="school" size={18} color="#D97706" />
          <Text style={styles.sectionTitle}>STUDENTS</Text>
        </View>

        {/* Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="folder" size={24} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>LOCAL DATABASE</Text>
              <Text style={styles.statusValue}>{localCount} RESIDENTS</Text>
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

        {/* Import from Sheet Button */}
        <TouchableOpacity
          testID="import-sheet-btn"
          style={[styles.importBtn, syncing && styles.btnDisabled]}
          onPress={handleImportFromSheet}
          disabled={syncing}
        >
          {syncing ? <ActivityIndicator color="#FFFFFF" /> : (
            <>
              <Ionicons name="cloud-download" size={24} color="#FFFFFF" />
              <Text style={styles.importBtnText}>UPDATE DATA</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Messages */}
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

        {/* ── Maid / Cook Sync Section ── */}
        <View style={[styles.sectionHeader, { marginTop: 32 }]}>
          <Ionicons name="restaurant" size={18} color="#D97706" />
          <Text style={styles.sectionTitle}>MAIDS & COOKS</Text>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="folder" size={24} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>LOCAL DATABASE</Text>
              <Text style={styles.statusValue}>{localCountMC} MAIDS & COOKS</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.statusRow}>
            <Ionicons name="time" size={24} color="#78350F" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>LAST SYNCED</Text>
              <Text style={styles.statusValue}>{lastSyncMC ? formatSyncTime(lastSyncMC) : 'NEVER'}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          testID="import-maidcook-btn"
          style={[styles.importBtn, { backgroundColor: '#78350F' }, syncingMC && styles.btnDisabled]}
          onPress={handleImportMaidsCooks}
          disabled={syncingMC}
        >
          {syncingMC ? <ActivityIndicator color="#FFFFFF" /> : (
            <>
              <Ionicons name="cloud-download" size={24} color="#FFFFFF" />
              <Text style={styles.importBtnText}>UPDATE MAIDS & COOKS</Text>
            </>
          )}
        </TouchableOpacity>

        {syncResultMC && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={20} color="#00C853" />
            <Text style={styles.successText}>{syncResultMC}</Text>
          </View>
        )}
        {syncErrorMC && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={20} color="#FF3B30" />
            <Text style={styles.errorText}>{syncErrorMC}</Text>
          </View>
        )}

        {/* ── Clear All Data ── */}
        <View style={{ marginTop: 32, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 24 }}>
          <TouchableOpacity
            style={[styles.clearBtn, (clearing || syncing || syncingMC) && styles.btnDisabled]}
            onPress={() => {
              Alert.alert(
                'Clear All Data',
                'This will delete ALL residents, maids/cooks, photos, and logs. You will need to sync again from scratch.\n\nAre you sure?',
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
                        setLastSync(null);
                        setLastSyncMC(null);
                        setSyncResult(null);
                        setSyncResultMC(null);
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
            disabled={clearing || syncing || syncingMC}
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
