import NetInfo from '@react-native-community/netinfo';
import {
  Resident, MaidCook, Visitor, ZohoGuest,
  getLocalResidents, saveLocalResidents, setLastSyncTime,
  getLocalMaidsCooks, saveLocalMaidsCooks, setMaidCookLastSyncTime,
  getLocalVisitors, saveLocalVisitors, setVisitorLastSyncTime,
  saveLocalZohoGuests, setZohoLastSyncTime,
  getSyncToken,
} from './storage';
import {
  downloadAllPhotos,
  cleanupExpiredPhotos,
  importPhotosFromBase64,
  attachLocalPhotosById,
  downloadPhotosFromDriveFolder,
  getFacesFolderId,
  pruneOrphanPhotos,
  MAIDCOOK_PHOTOS_DIR_NAME,
} from './photos';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';
// Sheet GIDs: student_id=0, cooks_and_maids=1522969277, visitors=2129598920, visitor_log=63905656
const sheetGids = { students: '0', maidsCooks: '1522969277', visitors: '2129598920' };
const zipUrl = (token: string) => APPS_SCRIPT_URL + '?action=get_zip&token=' + encodeURIComponent(token);
const PHOTO_URL_TEMPLATE: string = '';

/** Optional progress reporter — the UI passes its status setter; background runs omit it. */
type OnProgress = (msg: string) => void;

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

async function fetchCsv(token: string, opts: { gid?: string; sheet?: string }): Promise<Record<string, string>[]> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_csv', ...opts, token }),
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
}

// Content-diff sync. Decides what to do per row by COMPARING the sheet row
// against the local copy — no reliance on a flag for data/new rows:
//   - id absent locally          -> new      (add + pull face)
//   - tracked fields differ      -> changed  (update record)
//   - identical                  -> skip
// The flag is consulted only for two things that a content diff cannot see:
//   - 'u'/'up' -> refresh that student's face from the faces folder
//   - 'd'      -> delete the record (+ photo pruned later)
function processRows<T extends { id: string }>(
  rows: Record<string, string>[],
  existing: T[],
  buildEntry: (id: string, row: Record<string, string>, ex: T | undefined) => T,
  signatureOf: (entry: T) => string,
) {
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
}

const studentSignature = (r: Resident) =>
  [r.name, r.unit, r.aadhar_masked, r.phone_last4, r.vehicle_plate, r.validity]
    .map(x => String(x || '').trim()).join('|');

const maidSignature = (m: MaidCook) =>
  [m.name, m.flats, m.aadhar_masked, m.phone_last4, m.vehicle_plate, m.validity]
    .map(x => String(x || '').trim()).join('|');

/**
 * Per-run photo fetcher. Prefers the Drive "faces" folder (one file per ID),
 * falling back to the full photos ZIP when no faces folder exists. The ZIP is
 * downloaded at most once per run (cached in the closure).
 */
function makePhotoFetcher(token: string, onProgress?: OnProgress) {
  let cachedZipBase64: string | null = null;
  let facesFolderId: string | null | undefined; // undefined = not yet checked

  const resolveFacesFolder = async (): Promise<string | null> => {
    if (facesFolderId === undefined) facesFolderId = await getFacesFolderId();
    return facesFolderId;
  };

  const fetchZipOnce = async (): Promise<string> => {
    if (cachedZipBase64) return cachedZipBase64;
    onProgress?.('Downloading photos ZIP...');
    const zipRes = await fetch(zipUrl(token), { redirect: 'follow' });
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
    onProgress?.('Extracting photos...');
    await importPhotosFromBase64(zipBase64, (done, total) => {
      onProgress?.(`Extracting photos: ${done}/${total}`);
    });
    cachedZipBase64 = zipBase64;
    return zipBase64;
  };

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
      onProgress?.(`Downloading ${label} photos from faces folder...`);
      await downloadPhotosFromDriveFolder(faces, ids, (_done, _total, status) => {
        onProgress?.(`${label} photos: ${status}`);
      }, dirName, refresh);
    } else {
      await fetchZipOnce();
    }
  };

  return { fetchZipOnce, syncPhotosFor };
}

/** Download & reconcile the student list from the sheet. Returns a summary line. */
export async function syncStudentsData(token: string, onProgress?: OnProgress): Promise<string> {
  const { fetchZipOnce, syncPhotosFor } = makePhotoFetcher(token, onProgress);

  onProgress?.('Fetching students...');
  const studentRows = await fetchCsv(token, { gid: sheetGids.students });
  onProgress?.(`Processing ${studentRows.length} students...`);
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
    onProgress?.('Bootstrapping photos from ZIP...');
    await fetchZipOnce();
    let attached = await attachLocalPhotosById(sResult.items);
    const missingIds = attached.filter(r => !r.local_photo).map(r => r.id);
    if (missingIds.length > 0) {
      onProgress?.(`Fetching ${missingIds.length} missing faces from folder...`);
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
    onProgress?.('Downloading fallback URL photos...');
    const withPhotos = await downloadAllPhotos(studentsAttached, (done, total) => {
      onProgress?.(`Photos: ${done}/${total}`);
    });
    finalStudents = await cleanupExpiredPhotos(withPhotos);
  } else {
    finalStudents = studentsAttached;
  }
  await saveLocalResidents(finalStudents);
  // Remove photos for deleted students ("d") and any not tied to a current resident.
  await pruneOrphanPhotos(finalStudents);
  await setLastSyncTime(new Date().toISOString());
  return `Students: +${sResult.added} ~${sResult.changed} ↺${sResult.photoRefreshIds.length} -${sResult.deleted}` +
    (sResult.deletionSkipped ? ` (⚠ skipped deleting ${sResult.deletionSkipped} — sheet looked incomplete)` : '');
}

/** Download & reconcile the maid/cook list from the sheet. Returns a summary line. */
export async function syncMaidsCooksData(token: string, onProgress?: OnProgress): Promise<string> {
  const { syncPhotosFor } = makePhotoFetcher(token, onProgress);

  onProgress?.('Fetching maids & cooks...');
  const maidRows = await fetchCsv(token, { gid: sheetGids.maidsCooks });
  onProgress?.(`Processing ${maidRows.length} maids/cooks...`);
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
    onProgress?.('Downloading maid/cook photos...');
    finalMaids = await downloadAllPhotos(maidsAttached, (done, total) => {
      onProgress?.(`Maid/cook photos: ${done}/${total}`);
    }, MAIDCOOK_PHOTOS_DIR_NAME);
  } else {
    finalMaids = maidsAttached;
  }
  await saveLocalMaidsCooks(finalMaids);
  await pruneOrphanPhotos(finalMaids, MAIDCOOK_PHOTOS_DIR_NAME);
  await setMaidCookLastSyncTime(new Date().toISOString());
  return `Maids/Cooks: +${mResult.added} ~${mResult.changed} ↺${mResult.photoRefreshIds.length} -${mResult.deleted}` +
    (mResult.deletionSkipped ? ` (⚠ skipped deleting ${mResult.deletionSkipped} — sheet looked incomplete)` : '');
}

/** Download & reconcile the visitor list from the sheet. Returns a summary line. */
export async function syncVisitorsData(token: string, onProgress?: OnProgress): Promise<string> {
  onProgress?.('Fetching visitors...');
  const visitorRows = await fetchCsv(token, { gid: sheetGids.visitors });
  if (visitorRows.length === 0) return 'Visitors: no data';

  onProgress?.(`Processing ${visitorRows.length} visitors...`);
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
  await setVisitorLastSyncTime(new Date().toISOString());
  return `Visitors: ${visitors.length}`;
}

// Public ZOHO guest/visitor details sheet (anyone-with-link viewable) — pulled
// directly via the CSV export, no token/Apps Script proxy needed.
const ZOHO_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1vIRcG8MdJtecPw4ygK0IKGTKl3c0iZeTVIeY1uLp5ag/export?format=csv';

/** Parse one CSV line, honouring quoted fields and escaped quotes. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/**
 * Download & reconcile the ZOHO guest list from the public sheet. The sheet has
 * title/blank rows above the real header, so we locate the header row by finding
 * the one that contains "ZOHO ID No" rather than assuming row 0. Rows without a
 * ZOHO ID are skipped. Returns a summary line.
 */
export async function syncZohoGuestsData(onProgress?: OnProgress): Promise<string> {
  onProgress?.('Fetching ZOHO guests...');
  const res = await fetch(ZOHO_SHEET_CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error('ZOHO fetch failed: ' + res.status);
  const raw = await res.text();
  const lines = raw.split('\n').filter(l => l.trim() !== '');

  // Find the header row (the one that names the ZOHO ID column).
  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]).map(c => c.toLowerCase());
    if (cells.some(c => c.includes('zoho id'))) { headerIdx = i; header = parseCsvLine(lines[i]); break; }
  }
  if (headerIdx < 0) throw new Error('ZOHO sheet: header row not found');

  const col = (...names: string[]): number => {
    const lower = header.map(h => h.toLowerCase());
    for (const n of names) {
      const idx = lower.findIndex(h => h.includes(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const cId = col('zoho id');
  const cName = col('guest name', 'name');
  const cFlat = col('flat');
  const cIn = col('check-in', 'check in', 'checkin');
  const cOut = col('check-out', 'check out', 'checkout');
  const cVeh = col('vehicle');
  const cRem = col('remark');

  const guests: ZohoGuest[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const zohoId = cId >= 0 ? (cells[cId] || '').trim() : '';
    if (!zohoId) continue;
    guests.push({
      zoho_id: zohoId,
      name: cName >= 0 ? (cells[cName] || '').trim() : '',
      flat: cFlat >= 0 ? (cells[cFlat] || '').trim() : '',
      check_in: cIn >= 0 ? (cells[cIn] || '').trim() : '',
      check_out: cOut >= 0 ? (cells[cOut] || '').trim() : '',
      vehicle: cVeh >= 0 ? (cells[cVeh] || '').trim() : '',
      remarks: cRem >= 0 ? (cells[cRem] || '').trim() : '',
    });
  }

  await saveLocalZohoGuests(guests);
  await setZohoLastSyncTime(new Date().toISOString());
  return `ZOHO guests: ${guests.length}`;
}

let autoSyncing = false;

/**
 * Headless auto-sync used by the hourly background timer: pulls student,
 * visitor, and ZOHO guest data. Silently no-ops when offline or when another
 * (manual or auto) sync is already in flight. Student/visitor pulls need a
 * stored token; ZOHO uses a public sheet, so it syncs even without one.
 * Never throws — errors are swallowed so the timer keeps ticking.
 */
export async function runAutoSync(): Promise<void> {
  if (autoSyncing) return;

  const net = await NetInfo.fetch();
  if (!net.isConnected) return;

  autoSyncing = true;
  try {
    const token = await getSyncToken();
    if (token) {
      // Students and visitors — maid/cook stays manual (data not maintained).
      try { await syncStudentsData(token); } catch (_) { /* keep going */ }
      try { await syncVisitorsData(token); } catch (_) { /* visitors sheet may not exist */ }
    }
    // ZOHO uses a public sheet — sync regardless of token.
    try { await syncZohoGuestsData(); } catch (_) { /* public sheet may be unreachable */ }
  } finally {
    autoSyncing = false;
  }
}

/** True when an auto-sync is currently running (so the UI can defer a manual sync). */
export function isAutoSyncing(): boolean {
  return autoSyncing;
}
