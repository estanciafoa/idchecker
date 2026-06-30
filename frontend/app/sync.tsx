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
  Resident, MaidCook, Visitor,
  getLocalResidents, saveLocalResidents, getLastSyncTime, setLastSyncTime,
  getLocalMaidsCooks, saveLocalMaidsCooks, setMaidCookLastSyncTime,
  getLocalVisitors, saveLocalVisitors, setVisitorLastSyncTime,
  clearSyncData, getSyncToken, setSyncToken,
} from '../src/services/storage';
import {
  downloadAllPhotos,
  cleanupExpiredPhotos,
  importPhotosFromBase64,
  attachLocalPhotosById,
  clearAllPhotos,
  downloadPhotosFromDriveFolder,
  getFacesFolderId,
  pruneOrphanPhotos,
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

  const fetchCsv = async (opts: { gid?: string; sheet?: string }): Promise<Record<string, string>[]> => {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_csv', ...opts, token: tokenRef.current }),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const raw = await res.text();
    if (raw.trimStart().startsWith('{')) {
      const err = JSON.parse(raw);
      if (!err.ok) {
        const msg = err.error || 'Access denied';
        if (/denied|invalid.*token|unauthorized/i.test(msg)) {
          const e = new Error(msg); (e as any).isTokenError = true; throw e;
        }
        throw new Error(msg);
      }
    }
    return parseCSV(raw);
  };

  // Content-diff sync. Decides what to do per row by COMPARING the sheet row
  // against the local copy — no reliance on a flag for data/new rows:
  //   - id absent locally          -> new      (add + pull face)
  //   - tracked fields differ      -> changed  (update record)
  //   - identical                  -> skip
  // The flag is consulted only for two things that a content diff cannot see:
  //   - 'u'/'up' -> refresh that student's face from the faces folder
  //   - 'd'      -> delete the record (+ photo pruned later)
  const processRows = <T extends { id: string }>(
    rows: Record<string, string>[],
    existing: T[],
    buildEntry: (id: string, row: Record<string, string>, ex: T | undefined) => T,
    signatureOf: (entry: T) => string,
  ) => {
    const existingMap = new Map<string, T>();
    for (const e of existing) existingMap.set(e.id.toLowerCase(), e);
    const all = new Map<string, T>();
    for (const e of existing) all.set(e.id.toLowerCase(), e);

    let added = 0, changed = 0, deleted = 0, skipped = 0;
    const newIds: string[] = [];
    const changedIds: string[] = [];
    const photoRefreshIds: string[] = []; // flag 'u'/'up' — force re-download a face
    const flaggedFaceIds: string[] = [];  // flag 'n'/'u'/'up' — allowed to pull a face
    const deletedIds: string[] = [];
    // Every ID that appears in ANY sheet row (even name-less / skipped rows) so a
    // half-edited row is never mistaken for a removed one. Used for auto-delete.
    const seenIds = new Set<string>();

    for (const row of rows) {
      const id = getCol(row, 'ID', 'Id', 'id');
      if (!id) continue;
      const key = id.toLowerCase();
      seenIds.add(key);
      const flag = getCol(row, 'update', 'Update', 'UPDATE', 'status', 'Status', 'STATUS').toLowerCase();

      // 'd' still works as an immediate manual delete, but it's optional now —
      // removing the row from the sheet auto-deletes it (see below).
      if (flag === 'd') {
        if (existingMap.has(key)) { all.delete(key); deleted++; deletedIds.push(id); }
        continue;
      }
      const name = getCol(row, 'Name', 'name', 'NAME');
      if (!name) { skipped++; continue; }

      const ex = existingMap.get(key);
      if (!ex) {
        all.set(key, buildEntry(id, row, undefined));
        added++; newIds.push(id);
      } else {
        const incoming = buildEntry(id, row, ex);
        if (signatureOf(incoming) !== signatureOf(ex)) {
          all.set(key, incoming);
          changed++; changedIds.push(id);
        }
      }
      if (flag === 'u' || flag === 'up') {
        photoRefreshIds.push(id);
        // Bump updated_at even if the row data is identical, so the display
        // cache-buster (?v=updated_at) changes and the refreshed face renders.
        const cur = all.get(key);
        if (cur) all.set(key, { ...cur, updated_at: new Date().toISOString() } as T);
      }
      if (flag === 'n' || flag === 'u' || flag === 'up') flaggedFaceIds.push(id);
    }

    // Auto-delete: a local record whose row is gone from the sheet is removed
    // (no flag needed). Guards against wiping the device on a bad/partial fetch:
    //  - never delete when the sheet returned zero rows;
    //  - skip the bulk delete if an implausibly large share went "missing".
    let deletionSkipped = 0;
    if (rows.length > 0) {
      const absent = existing.filter(e => !seenIds.has(e.id.toLowerCase())).map(e => e.id);
      const tooMany = existing.length >= 20 && absent.length > Math.ceil(existing.length * 0.25);
      if (tooMany) {
        deletionSkipped = absent.length; // looks like a partial fetch — refuse to mass-delete
      } else {
        for (const id of absent) { all.delete(id.toLowerCase()); deleted++; deletedIds.push(id); }
      }
    }

    return { items: Array.from(all.values()), added, changed, deleted, skipped, newIds, changedIds, photoRefreshIds, flaggedFaceIds, deletedIds, deletionSkipped };
  };

  // Shared ZIP cache so we only download once per sync-all
  let cachedZipBase64: string | null = null;

  // Resolve the Drive "faces" folder once per sync. undefined = not checked yet,
  // null = checked and absent (fall back to ZIP), string = folder id.
  let facesFolderId: string | null | undefined;
  const resolveFacesFolder = async (): Promise<string | null> => {
    if (facesFolderId === undefined) {
      facesFolderId = await getFacesFolderId();
    }
    return facesFolderId;
  };

  /**
   * Download photos for only the given IDs. Prefers the Drive "faces" folder
   * (one file per ID); falls back to the full photos ZIP when there is none.
   */
  const syncPhotosFor = async (
    newIds: string[],
    photoUpdateIds: string[],
    dirName: string | undefined,
    label: string,
  ): Promise<void> => {
    const faces = await resolveFacesFolder();
    if (faces) {
      const ids = Array.from(new Set([...newIds, ...photoUpdateIds]));
      if (ids.length === 0) return;
      const refresh = new Set(photoUpdateIds.map(i => i.toLowerCase()));
      setSyncResult(`Downloading ${label} photos from faces folder...`);
      await downloadPhotosFromDriveFolder(faces, ids, (_done, _total, status) => {
        setSyncResult(`${label} photos: ${status}`);
      }, dirName, refresh);
    } else {
      await fetchZipOnce();
    }
  };

  const fetchZipOnce = async (): Promise<string> => {
    if (cachedZipBase64) return cachedZipBase64;
    setSyncResult('Downloading photos ZIP...');
    const zipRes = await fetch(zipUrl(tokenRef.current), { redirect: 'follow' });
    if (!zipRes.ok) throw new Error('Failed to download ZIP: ' + zipRes.status);
    const zipBase64 = await zipRes.text();
    if (zipBase64.trimStart().startsWith('{')) {
      const errObj = JSON.parse(zipBase64);
      if (!errObj.ok) {
        const msg = errObj.error || 'ZIP access denied';
        if (/denied|invalid.*token|unauthorized/i.test(msg)) {
          const e = new Error(msg); (e as any).isTokenError = true; throw e;
        }
        throw new Error(msg);
      }
    }
    setSyncResult('Extracting photos...');
    await importPhotosFromBase64(zipBase64, (done, total) => {
      setSyncResult(`Extracting photos: ${done}/${total}`);
    });
    cachedZipBase64 = zipBase64;
    return zipBase64;
  };

  const sortNewFirst = (items: Resident[]) =>
    [...items].sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));

  const studentSignature = (r: Resident) =>
    [r.name, r.unit, r.aadhar_masked, r.phone_last4, r.vehicle_plate, r.validity]
      .map(x => String(x || '').trim()).join('|');

  const syncStudents = async () => {
    setSyncResult('Fetching students...');
    const studentRows = await fetchCsv({ gid: sheetGids.students });
    setSyncResult(`Processing ${studentRows.length} students...`);
    const existingResidents = await getLocalResidents();
    const isBootstrap = existingResidents.length === 0;
    const existingIds = new Set(existingResidents.map(r => r.id.toLowerCase()));
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
      const isNew = !existingIds.has(id.toLowerCase());
      const base = ex || { id, photo_base64: '', status: 'active', created_at: new Date().toISOString() } as any;
      // local_photo cleared here; attachLocalPhotosById re-attaches from disk.
      return { ...base, ...incoming, local_photo: '', photo_base64: base.photo_base64 || '', is_new: isNew, updated_at: new Date().toISOString(), id, status: base.status || 'active', created_at: base.created_at || new Date().toISOString() };
    }, studentSignature);

    if (isBootstrap) {
      // Fresh/cleared device: pull the bulk photos ZIP, then (one time only)
      // top up any faces missing from the ZIP straight from the folder.
      setSyncResult('Bootstrapping photos from ZIP...');
      await fetchZipOnce();
      let attached = await attachLocalPhotosById(sResult.items);
      const missingIds = attached.filter(r => !r.local_photo).map(r => r.id);
      if (missingIds.length > 0) {
        setSyncResult(`Fetching ${missingIds.length} missing faces from folder...`);
        await syncPhotosFor(missingIds, [], undefined, 'student');
      }
    } else if (sResult.newIds.length > 0 || sResult.flaggedFaceIds.length > 0) {
      // Incremental: pull faces ONLY for new records and rows flagged n/u/up.
      // A resident missing a photo with a blank flag is left alone (keeps sync
      // fast); flag it 'n'/'u' in the sheet to (re)pull that face.
      const pullIds = Array.from(new Set([...sResult.newIds, ...sResult.flaggedFaceIds]));
      await syncPhotosFor(pullIds, sResult.photoRefreshIds, undefined, 'student');
    }

    const studentsAttached = await attachLocalPhotosById(sResult.items);

    const needsPhoto = isBootstrap || sResult.newIds.length > 0 || sResult.changedIds.length > 0 || sResult.flaggedFaceIds.length > 0;
    let finalStudents: Resident[];
    if (needsPhoto) {
      setSyncResult('Downloading fallback URL photos...');
      const withPhotos = await downloadAllPhotos(studentsAttached, (done, total) => {
        setSyncResult(`Photos: ${done}/${total}`);
      });
      finalStudents = await cleanupExpiredPhotos(withPhotos);
    } else {
      finalStudents = studentsAttached;
    }
    await saveLocalResidents(finalStudents);
    setLocalCount(finalStudents.length);
    // Remove photos for deleted students ("d") and any not tied to a current resident.
    await pruneOrphanPhotos(finalStudents);
    await setLastSyncTime(new Date().toISOString());
    return `Students: +${sResult.added} ~${sResult.changed} ↺${sResult.photoRefreshIds.length} -${sResult.deleted}` +
      (sResult.deletionSkipped ? ` (⚠ skipped deleting ${sResult.deletionSkipped} — sheet looked incomplete)` : '');
  };

  const maidSignature = (m: MaidCook) =>
    [m.name, m.flats, m.aadhar_masked, m.phone_last4, m.vehicle_plate, m.validity]
      .map(x => String(x || '').trim()).join('|');

  const syncMaidsCooks = async () => {
    setSyncResult('Fetching maids & cooks...');
    const maidRows = await fetchCsv({ gid: sheetGids.maidsCooks });
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
      const base = ex || { id, photo_base64: '', status: 'active', created_at: new Date().toISOString() } as any;
      return { ...base, ...incoming, local_photo: '', photo_base64: base.photo_base64 || '', updated_at: new Date().toISOString(), id, status: base.status || 'active', created_at: base.created_at || new Date().toISOString() };
    }, maidSignature);

    // Pull faces ONLY for new records and rows flagged n/u/up (same rule as
    // students — keeps sync fast; blank-flag missing photos are left alone).
    if (mResult.newIds.length > 0 || mResult.flaggedFaceIds.length > 0) {
      const pullIds = Array.from(new Set([...mResult.newIds, ...mResult.flaggedFaceIds]));
      await syncPhotosFor(pullIds, mResult.photoRefreshIds, MAIDCOOK_PHOTOS_DIR_NAME, 'maid/cook');
    }

    const maidsAttached = await attachLocalPhotosById(mResult.items, MAIDCOOK_PHOTOS_DIR_NAME);

    const mcNeedsPhoto = mResult.newIds.length > 0 || mResult.changedIds.length > 0 || mResult.flaggedFaceIds.length > 0;
    let finalMaids: MaidCook[];
    if (mcNeedsPhoto) {
      setSyncResult('Downloading maid/cook photos...');
      finalMaids = await downloadAllPhotos(maidsAttached, (done, total) => {
        setSyncResult(`Maid/cook photos: ${done}/${total}`);
      }, MAIDCOOK_PHOTOS_DIR_NAME);
    } else {
      finalMaids = maidsAttached;
    }
    await saveLocalMaidsCooks(finalMaids);
    setLocalCountMC(finalMaids.length);
    await pruneOrphanPhotos(finalMaids, MAIDCOOK_PHOTOS_DIR_NAME);
    await setMaidCookLastSyncTime(new Date().toISOString());
    return `Maids/Cooks: +${mResult.added} ~${mResult.changed} ↺${mResult.photoRefreshIds.length} -${mResult.deleted}` +
      (mResult.deletionSkipped ? ` (⚠ skipped deleting ${mResult.deletionSkipped} — sheet looked incomplete)` : '');
  };

  const syncVisitors = async () => {
    setSyncResult('Fetching visitors...');
    const visitorRows = await fetchCsv({ gid: sheetGids.visitors });
    if (visitorRows.length === 0) return 'Visitors: no data';

    setSyncResult(`Processing ${visitorRows.length} visitors...`);
    const existingV = await getLocalVisitors();
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
    await saveLocalVisitors(visitors);
    setLocalCountV(visitors.length);
    await setVisitorLastSyncTime(new Date().toISOString());
    return `Visitors: ${visitors.length}`;
  };

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

      const now = new Date().toISOString();
      await setLastSyncTime(now);
      setLastSync(now);
      await setSyncToken(tokenRef.current);
      setSyncResult('Done! ' + parts.join(' | '));
    } catch (error: any) {
      if (error?.isTokenError) {
        setTokenInput(''); tokenRef.current = ''; await setSyncToken('');
        setSyncError('Wrong token. Enter the correct token.');
        cachedZipBase64 = null;
        setSyncing(null);
        const newToken = await ensureToken();
        if (newToken) handleSync();
        return;
      }
      setSyncError(`SYNC FAILED: ${error?.message || 'Check connection'}`);
    } finally {
      cachedZipBase64 = null;
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
