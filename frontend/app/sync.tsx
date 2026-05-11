import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  SafeAreaView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Resident, getLocalResidents, saveLocalResidents, getLastSyncTime, setLastSyncTime } from '../src/services/storage';
import {
  downloadAllPhotos,
  cleanupExpiredPhotos,
  importPhotosFromZip,
  attachLocalPhotosById,
} from '../src/services/photos';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRWtCUWe5gmOUyvtZsSnApB5H0vMRRGXDnETCaUwcSRCCRdeX7J299QKq0p7cntCqeqRR4fxbRR1hgL/pub?output=csv';
const PHOTOS_ZIP_URL = 'https://drive.google.com/uc?export=download&id=1qeYPI_zPqyKofP9_xx9iVOhHnd_DSW0S';
// Optional fallback when photo_url column is empty.
// Use {id} placeholder, e.g. 'https://example.com/photos/{id}.jpg'
const PHOTO_URL_TEMPLATE = '';

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

function hasChanges(existing: Resident, incoming: Partial<Resident>): boolean {
  const fields: (keyof Resident)[] = ['name', 'unit', 'aadhar_masked', 'vehicle_plate', 'photo_url', 'validity'];
  for (const f of fields) {
    const oldVal = (existing[f] || '').toString().trim();
    const newVal = ((incoming as any)[f] || '').toString().trim();
    if (oldVal !== newVal) return true;
  }
  return false;
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

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    const residents = await getLocalResidents();
    setLocalCount(residents.length);
    const syncTime = await getLastSyncTime();
    setLastSync(syncTime);
  };

  const handleImportFromSheet = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      setSyncResult('Fetching sheet...');
      const response = await fetch(SHEET_URL);
      if (!response.ok) throw new Error('Failed to fetch sheet: ' + response.status);
      const csvText = await response.text();
      const rows = parseCSV(csvText);
      if (rows.length === 0) throw new Error('No data found in sheet');

      setSyncResult(`Parsing ${rows.length} rows...`);
      const existingResidents = await getLocalResidents();
      const existingMap = new Map<string, Resident>();
      for (const r of existingResidents) existingMap.set(r.id.toLowerCase(), r);

      let added = 0, updated = 0, unchanged = 0;
      const allResidents = new Map<string, Resident>();
      // Keep existing residents first
      for (const r of existingResidents) allResidents.set(r.id.toLowerCase(), r);

      for (const row of rows) {
        const id = getCol(row, 'ID', 'Id', 'id');
        const name = getCol(row, 'Name', 'name', 'NAME');
        if (!id || !name) continue;

        const incoming = {
          name,
          unit: getCol(row, 'flat number', 'Flat', 'flat', 'FLAT', 'Unit', 'unit'),
          aadhar_masked: getCol(row, 'Aadhar/SRMID', 'Aadhar', 'aadhar', 'AADHAR'),
          photo_url: resolvePhotoUrl(id, row),
          validity: getCol(row, 'ValidTill', 'Validity', 'validity', 'VALIDITY'),
          vehicle_plate: getCol(row, 'Vehicle', 'vehicle', 'Vehicle Plate', 'vehicle_plate'),
        };

        const existing = existingMap.get(id.toLowerCase());
        if (existing) {
          if (hasChanges(existing, incoming)) {
            // Photo URL changed — clear local_photo so it re-downloads
            const photoChanged = (existing.photo_url || '').trim() !== (incoming.photo_url || '').trim();
            allResidents.set(id.toLowerCase(), {
              ...existing,
              ...incoming,
              local_photo: photoChanged ? '' : existing.local_photo,
              updated_at: new Date().toISOString(),
            });
            updated++;
          } else {
            unchanged++;
          }
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
          added++;
        }
      }

      const finalList = Array.from(allResidents.values());
      setSyncResult(`Added ${added}, Updated ${updated}, Unchanged ${unchanged}. Importing zip photos...`);

      await importPhotosFromZip(PHOTOS_ZIP_URL, (done, total) => {
        setSyncResult(`ZIP Photos: ${done}/${total} | Added ${added}, Updated ${updated}`);
      });

      const withLocalById = await attachLocalPhotosById(finalList);

      setSyncResult(`Downloading fallback URL photos...`);

      const withPhotos = await downloadAllPhotos(withLocalById, (done, total) => {
        setSyncResult(`Photos: ${done}/${total} | Added ${added}, Updated ${updated}`);
      });

      setSyncResult(`Cleaning up expired photos...`);
      const cleaned = await cleanupExpiredPhotos(withPhotos);

      await saveLocalResidents(cleaned);
      const now = new Date().toISOString();
      await setLastSyncTime(now);
      setLocalCount(cleaned.length);
      setLastSync(now);
      setSyncResult(`Done! Added ${added}, Updated ${updated}, Unchanged ${unchanged}. Total: ${cleaned.length}`);
    } catch (error: any) {
      setSyncError(`IMPORT FAILED: ${error?.message || 'Check connection & sheet URL'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncLocal = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      await loadStatus();
      setSyncResult(`Local database has ${localCount} residents`);
    } catch (error: any) {
      setSyncError(`SYNC FAILED: ${error?.message || 'Check connection'}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatSyncTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView testID="sync-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <Text style={styles.titleText}>ESTANCIA ID CHECK</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="folder" size={24} color="#0F172A" />
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>LOCAL DATABASE</Text>
              <Text style={styles.statusValue}>{localCount} RESIDENTS</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.statusRow}>
            <Ionicons name="time" size={24} color="#0F172A" />
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
              <Text style={styles.importBtnText}>PULL FROM SHEET</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Sync from server (if data already imported) */}
        <TouchableOpacity
          testID="sync-button"
          style={[styles.syncLocalBtn, syncing && styles.btnDisabled]}
          onPress={handleSyncLocal}
          disabled={syncing}
        >
          <Ionicons name="refresh" size={20} color="#0055FF" />
          <Text style={styles.syncLocalText}>SYNC FROM SERVER</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: { backgroundColor: '#0F172A', paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center' },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  scrollContent: { padding: 20 },
  statusCard: { borderWidth: 2, borderColor: '#000000', padding: 16, backgroundColor: '#F8FAFC', marginBottom: 24, elevation: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusInfo: { flex: 1 },
  statusLabel: { fontSize: 10, fontWeight: '700', color: '#64748B', letterSpacing: 2 },
  statusValue: { fontSize: 18, fontWeight: '900', color: '#000000', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '900', color: '#0055FF', letterSpacing: 1 },
  sheetConfig: { borderWidth: 1, borderColor: '#E2E8F0', padding: 14, backgroundColor: '#F8FAFC', marginBottom: 16 },
  sheetHint: { fontSize: 12, color: '#64748B', lineHeight: 18, marginBottom: 10 },
  sheetInput: { borderWidth: 2, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, backgroundColor: '#FFFFFF', minHeight: 56 },
  sheetBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  saveUrlBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#0F172A' },
  saveUrlText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  importBtn: { height: 64, backgroundColor: '#0055FF', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10, borderWidth: 2, borderColor: '#000000', marginBottom: 12 },
  importBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  syncLocalBtn: { height: 48, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, borderWidth: 2, borderColor: '#0055FF', marginBottom: 16 },
  syncLocalText: { color: '#0055FF', fontSize: 13, fontWeight: '900' },
  btnDisabled: { opacity: 0.6 },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#F0FFF4', borderWidth: 1, borderColor: '#00C853', marginBottom: 12 },
  successText: { fontSize: 13, fontWeight: '700', color: '#00C853', flex: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FF3B30', marginBottom: 12 },
  errorText: { fontSize: 13, fontWeight: '700', color: '#FF3B30', flex: 1 },
  offlineNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  offlineText: { fontSize: 11, fontWeight: '700', color: '#FFB300', letterSpacing: 1 },
});
