import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const LOG_PHOTOS_DIR = FileSystem.documentDirectory + 'log_photos/';

/** Save base64 photo to file, return file path */
export async function saveLogPhoto(base64: string, prefix: string): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(LOG_PHOTOS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(LOG_PHOTOS_DIR, { intermediates: true });
  }
  const fileName = `${prefix}_${Date.now()}.jpg`;
  const filePath = LOG_PHOTOS_DIR + fileName;
  await FileSystem.writeAsStringAsync(filePath, base64, { encoding: FileSystem.EncodingType.Base64 });
  return filePath;
}

/** Load base64 from file path. Returns empty string if file not found. */
export async function loadLogPhoto(pathOrBase64: string): Promise<string> {
  if (!pathOrBase64) return '';
  // Backward compat: if it doesn't look like a file path, it's inline base64
  if (!pathOrBase64.startsWith('file://') && !pathOrBase64.startsWith('/')) {
    return pathOrBase64;
  }
  try {
    const info = await FileSystem.getInfoAsync(pathOrBase64);
    if (!info.exists) return '';
    return await FileSystem.readAsStringAsync(pathOrBase64, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    return '';
  }
}

/** Delete a log photo file */
async function deleteLogPhoto(pathOrBase64: string): Promise<void> {
  if (!pathOrBase64 || (!pathOrBase64.startsWith('file://') && !pathOrBase64.startsWith('/'))) return;
  try {
    const info = await FileSystem.getInfoAsync(pathOrBase64);
    if (info.exists) await FileSystem.deleteAsync(pathOrBase64, { idempotent: true });
  } catch { /* ignore */ }
}

const RESIDENTS_KEY = '@gate_check_residents';
const ACCESS_LOGS_KEY = '@gate_check_logs';
const LAST_SYNC_KEY = '@gate_check_last_sync';
const MAIDS_COOKS_KEY = '@gate_check_maids_cooks';
const MAIDS_COOKS_SYNC_KEY = '@gate_check_maids_cooks_last_sync';
const VISITORS_KEY = '@gate_check_visitors';
const VISITORS_SYNC_KEY = '@gate_check_visitors_last_sync';
const PENDING_VISITOR_CHECKINS_KEY = '@gate_check_pending_visitor_checkins';
const CAMERA_CONSENT_KEY = '@gate_check_camera_consent';
const SCANNER_ONLY_MODE_KEY = '@gate_check_scanner_only_mode';
const MAID_COOK_ATTENDANCE_KEY = '@gate_check_maid_cook_attendance';
const MAID_COOK_ATTENDANCE_PUSHED_KEY = '@gate_check_maid_cook_attendance_pushed';
const DEVICE_LOCATION_KEY = '@gate_check_device_location';
const ACCESS_LOGS_PUSHED_KEY = '@gate_check_access_logs_pushed';
const TAXI_LOG_KEY = '@gate_check_taxi_log';
const TAXI_LOG_PUSHED_KEY = '@gate_check_taxi_log_pushed';
const SYNC_TOKEN_KEY = '@gate_check_sync_token';
const GLOBAL_LOGS_CACHE_KEY = '@gate_check_global_logs_cache';
const ZOHO_GUESTS_KEY = '@gate_check_zoho_guests';
const ZOHO_GUESTS_SYNC_KEY = '@gate_check_zoho_guests_last_sync';
const APP_DISPLAY_ROTATION_90_KEY = '@gate_check_app_display_rotation_90';
const KIOSK_RESULT_TIMEOUT_SECONDS_KEY = '@gate_check_kiosk_result_timeout_seconds';
const DEFAULT_KIOSK_RESULT_TIMEOUT_SECONDS = 5;

export interface PendingVisitorCheckin {
  id: string;
  visitor: { id: string; name: string; flat: string; phone: string; aadhar: string; purpose: string };
  compositeBase64: string;
  timestamp: string;
  location?: string;
}

export interface Resident {
  id: string;
  name: string;
  unit: string;
  aadhar_masked: string;
  phone_last4: string;
  vehicle_plate: string;
  photo_url: string;
  photo_base64: string;
  local_photo: string;
  validity: string;
  status: string;
  created_at: string;
  updated_at: string;
  is_new?: boolean;
}

export interface AccessLogEntry {
  id: string;
  resident_id: string;
  resident_name: string;
  unit: string;
  timestamp: string;
  status: string;
  location?: string;
}

/** A ZOHO guest/visitor row synced from the public ZOHO details sheet. */
export interface ZohoGuest {
  zoho_id: string;
  name: string;
  flat: string;
  check_in: string;   // raw text from the sheet, e.g. "27-Jul-2026 6:00"
  check_out: string;  // raw text from the sheet, e.g. "31-Jul-2026 23:00"
  vehicle: string;
  remarks: string;
}

export interface MaidCook {
  id: string;
  name: string;
  flats: string; // comma-separated flat numbers
  aadhar_masked: string;
  phone_last4: string;
  vehicle_plate: string;
  photo_url: string;
  photo_base64: string;
  local_photo: string;
  validity: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Visitor {
  id: string;
  name: string;
  flat: string;
  aadhar_last4: string;
  nature: string;          // Nature of Visitor
  visit_date: string;
  requested_by: string;    // Request raised by
  check_in: string;
  check_out: string;
  night_stay: string;
  office_status: string;   // EFOA Office Status
  local_photo: string;
  local_photo_id: string;   // ID document photo
  card_number: string;       // Physical card assigned to visitor
  status: string;
  created_at: string;
  updated_at: string;
}

export interface GlobalLogsCache {
  fetchedAt: string;
  accessLogs: AccessLogEntry[];
  visitorLogs: any[];
  maidCookLogs: any[];
  taxiLogs: any[];
}

// In-memory cache for O(1) lookups
let _cache: Resident[] | null = null;
let _lookupMap: Map<string, Resident> | null = null;

function buildLookupMap(residents: Resident[]): Map<string, Resident> {
  const map = new Map<string, Resident>();
  for (const r of residents) {
    map.set(r.id.toLowerCase(), r);
  }
  return map;
}

function invalidateCache() {
  _cache = null;
  _lookupMap = null;
}

// Residents
export async function getLocalResidents(): Promise<Resident[]> {
  if (_cache) return _cache;
  const data = await AsyncStorage.getItem(RESIDENTS_KEY);
  _cache = data ? JSON.parse(data) : [];
  _lookupMap = buildLookupMap(_cache!);
  return _cache!;
}

export async function saveLocalResidents(residents: Resident[]): Promise<void> {
  // Deduplicate by id - keep latest version
  const map = new Map<string, Resident>();
  for (const r of residents) {
    map.set(r.id, r);
  }
  const deduped = Array.from(map.values());
  await AsyncStorage.setItem(RESIDENTS_KEY, JSON.stringify(deduped));
  // Update cache immediately
  _cache = deduped;
  _lookupMap = buildLookupMap(deduped);
}

export async function getResidentById(id: string): Promise<Resident | null> {
  if (!_lookupMap) await getLocalResidents();
  return _lookupMap!.get(id.toLowerCase()) || null;
}

export async function deleteLocalResident(id: string): Promise<void> {
  const residents = await getLocalResidents();
  const filtered = residents.filter(r => r.id !== id);
  await AsyncStorage.setItem(RESIDENTS_KEY, JSON.stringify(filtered));
  _cache = filtered;
  _lookupMap = buildLookupMap(filtered);
}

// Pre-warm cache on import — call after app starts
export async function preloadResidents(): Promise<number> {
  const residents = await getLocalResidents();
  return residents.length;
}

// Access Logs
export async function getLocalAccessLogs(): Promise<AccessLogEntry[]> {
  const data = await AsyncStorage.getItem(ACCESS_LOGS_KEY);
  return data ? JSON.parse(data) : [];
}

function anonymizeName(name: string): string {
  if (!name || name === 'ADMIN_ACTION') return name;
  const parts = name.trim().split(/\s+/);
  return parts.map(p => p.charAt(0).toUpperCase() + '***').join(' ');
}

export async function addAccessLog(log: AccessLogEntry): Promise<void> {
  const anonymized = { ...log, resident_name: anonymizeName(log.resident_name) };
  const logs = await getLocalAccessLogs();
  logs.unshift(anonymized);
  const trimmed = logs.slice(0, 5000);
  await AsyncStorage.setItem(ACCESS_LOGS_KEY, JSON.stringify(trimmed));
}

/** Get the set of access log IDs already pushed */
export async function getPushedAccessLogIds(): Promise<Set<string>> {
  const data = await AsyncStorage.getItem(ACCESS_LOGS_PUSHED_KEY);
  return new Set(data ? JSON.parse(data) : []);
}

/** Mark access log IDs as pushed */
export async function markAccessLogsPushed(ids: string[]): Promise<void> {
  const existing = await getPushedAccessLogIds();
  for (const id of ids) existing.add(id);
  const arr = Array.from(existing);
  const trimmed = arr.slice(-5000);
  await AsyncStorage.setItem(ACCESS_LOGS_PUSHED_KEY, JSON.stringify(trimmed));
}

/** Get unpushed access logs */
export async function getUnpushedAccessLogs(): Promise<AccessLogEntry[]> {
  const all = await getLocalAccessLogs();
  const pushed = await getPushedAccessLogIds();
  return all.filter(e => !pushed.has(e.id));
}

// Sync timestamp
export async function getLastSyncTime(): Promise<string | null> {
  return await AsyncStorage.getItem(LAST_SYNC_KEY);
}

export async function setLastSyncTime(time: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SYNC_KEY, time);
}

export async function clearAllData(): Promise<void> {
  // Delete log photo files from disk to prevent orphans
  try {
    const dirInfo = await FileSystem.getInfoAsync(LOG_PHOTOS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(LOG_PHOTOS_DIR, { idempotent: true });
    }
  } catch { /* ignore */ }
  await AsyncStorage.multiRemove([
    RESIDENTS_KEY, LAST_SYNC_KEY, MAIDS_COOKS_KEY, MAIDS_COOKS_SYNC_KEY,
    VISITORS_KEY, VISITORS_SYNC_KEY, PENDING_VISITOR_CHECKINS_KEY,
    ACCESS_LOGS_KEY, ACCESS_LOGS_PUSHED_KEY,
    MAID_COOK_ATTENDANCE_KEY, MAID_COOK_ATTENDANCE_PUSHED_KEY,
    TAXI_LOG_KEY, TAXI_LOG_PUSHED_KEY,
    GLOBAL_LOGS_CACHE_KEY,
    ZOHO_GUESTS_KEY, ZOHO_GUESTS_SYNC_KEY,
  ]);
  invalidateMaidCookCache();
  invalidateVisitorCache();
  invalidateZohoCache();
}

export async function clearSyncData(): Promise<void> {
  await AsyncStorage.multiRemove([RESIDENTS_KEY, LAST_SYNC_KEY, MAIDS_COOKS_KEY, MAIDS_COOKS_SYNC_KEY, VISITORS_KEY, VISITORS_SYNC_KEY, ZOHO_GUESTS_KEY, ZOHO_GUESTS_SYNC_KEY, GLOBAL_LOGS_CACHE_KEY]);
  _cache = null;
  _lookupMap = null;
  invalidateMaidCookCache();
  invalidateVisitorCache();
  invalidateZohoCache();
}

// ---- Maids & Cooks ----

let _maidCookCache: MaidCook[] | null = null;
let _maidCookLookupMap: Map<string, MaidCook> | null = null;

function buildMaidCookLookupMap(items: MaidCook[]): Map<string, MaidCook> {
  const map = new Map<string, MaidCook>();
  for (const m of items) {
    map.set(m.id.toLowerCase(), m);
  }
  return map;
}

function invalidateMaidCookCache() {
  _maidCookCache = null;
  _maidCookLookupMap = null;
}

export async function getLocalMaidsCooks(): Promise<MaidCook[]> {
  if (_maidCookCache) return _maidCookCache;
  const data = await AsyncStorage.getItem(MAIDS_COOKS_KEY);
  _maidCookCache = data ? JSON.parse(data) : [];
  _maidCookLookupMap = buildMaidCookLookupMap(_maidCookCache!);
  return _maidCookCache!;
}

export async function saveLocalMaidsCooks(items: MaidCook[]): Promise<void> {
  const map = new Map<string, MaidCook>();
  for (const m of items) map.set(m.id, m);
  const deduped = Array.from(map.values());
  await AsyncStorage.setItem(MAIDS_COOKS_KEY, JSON.stringify(deduped));
  _maidCookCache = deduped;
  _maidCookLookupMap = buildMaidCookLookupMap(deduped);
}

export async function getMaidCookById(id: string): Promise<MaidCook | null> {
  if (!_maidCookLookupMap) await getLocalMaidsCooks();
  return _maidCookLookupMap!.get(id.toLowerCase()) || null;
}

export async function preloadMaidsCooks(): Promise<number> {
  const items = await getLocalMaidsCooks();
  return items.length;
}

export async function getMaidCookLastSyncTime(): Promise<string | null> {
  return await AsyncStorage.getItem(MAIDS_COOKS_SYNC_KEY);
}

export async function setMaidCookLastSyncTime(time: string): Promise<void> {
  await AsyncStorage.setItem(MAIDS_COOKS_SYNC_KEY, time);
}

// ---- Visitors ----

let _visitorCache: Visitor[] | null = null;
let _visitorLookupMap: Map<string, Visitor> | null = null;

function buildVisitorLookupMap(items: Visitor[]): Map<string, Visitor> {
  const map = new Map<string, Visitor>();
  for (const v of items) {
    map.set(v.id.toLowerCase(), v);
  }
  return map;
}

function invalidateVisitorCache() {
  _visitorCache = null;
  _visitorLookupMap = null;
}

export async function getLocalVisitors(): Promise<Visitor[]> {
  if (_visitorCache) return _visitorCache;
  const data = await AsyncStorage.getItem(VISITORS_KEY);
  _visitorCache = data ? JSON.parse(data) : [];
  _visitorLookupMap = buildVisitorLookupMap(_visitorCache!);
  return _visitorCache!;
}

export async function saveLocalVisitors(items: Visitor[]): Promise<void> {
  const map = new Map<string, Visitor>();
  for (const v of items) map.set(v.id, v);
  const deduped = Array.from(map.values());
  await AsyncStorage.setItem(VISITORS_KEY, JSON.stringify(deduped));
  _visitorCache = deduped;
  _visitorLookupMap = buildVisitorLookupMap(deduped);
}

export async function getVisitorById(id: string): Promise<Visitor | null> {
  if (!_visitorLookupMap) await getLocalVisitors();
  return _visitorLookupMap!.get(id.toLowerCase()) || null;
}

export async function getVisitorsByFlat(flat: string): Promise<Visitor[]> {
  const all = await getLocalVisitors();
  const normalizedFlat = flat.trim().toLowerCase();
  return all.filter(v => v.flat.trim().toLowerCase() === normalizedFlat);
}

export async function getVisitorByCard(cardNumber: string): Promise<Visitor | null> {
  const all = await getLocalVisitors();
  const card = cardNumber.trim();
  if (!card) return null;
  return all.find(v => v.card_number && v.card_number.trim() === card) || null;
}

export async function assignCardToVisitor(visitorId: string, cardNumber: string): Promise<void> {
  const visitors = await getLocalVisitors();
  // Clear this card from any other visitor first
  const card = cardNumber.trim();
  for (let i = 0; i < visitors.length; i++) {
    if (visitors[i].card_number && visitors[i].card_number.trim() === card) {
      visitors[i] = { ...visitors[i], card_number: '', updated_at: new Date().toISOString() };
    }
  }
  // Assign to the target visitor
  const idx = visitors.findIndex(v => v.id.toLowerCase() === visitorId.toLowerCase());
  if (idx >= 0) {
    visitors[idx] = { ...visitors[idx], card_number: card, updated_at: new Date().toISOString() };
  }
  await saveLocalVisitors(visitors);
}

export async function returnCard(cardNumber: string): Promise<void> {
  const visitors = await getLocalVisitors();
  const card = cardNumber.trim();
  if (!card) return;
  let changed = false;
  for (let i = 0; i < visitors.length; i++) {
    if (visitors[i].card_number && visitors[i].card_number.trim() === card) {
      visitors[i] = { ...visitors[i], card_number: '', updated_at: new Date().toISOString() };
      changed = true;
    }
  }
  if (changed) await saveLocalVisitors(visitors);
}

/** Get visitors who have a card assigned and are past their check_out time */
export async function getOverstayVisitors(): Promise<Visitor[]> {
  const visitors = await getLocalVisitors();
  const now = new Date();
  return visitors.filter(v => {
    // Must have a card assigned (still inside)
    if (!v.card_number || !v.card_number.trim()) return false;
    // Need a check_out time to compare against
    if (!v.check_out || !v.check_out.trim()) return false;
    // Parse check_out time (e.g. "17:00", "5:00 PM", "17:30")
    const coTime = parseTimeToToday(v.check_out.trim(), v.visit_date);
    if (!coTime) return false;
    return now > coTime;
  });
}

/** Parse a time string (HH:MM, H:MM AM/PM) into a Date object for today or the visit date */
function parseTimeToToday(timeStr: string, visitDate?: string): Date | null {
  const now = new Date();
  let hours = 0, minutes = 0;

  // Try "HH:MM" or "H:MM"
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    hours = parseInt(match24[1], 10);
    minutes = parseInt(match24[2], 10);
  } else {
    // Try "H:MM AM/PM" or "HH:MM AM/PM"
    const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      hours = parseInt(match12[1], 10);
      minutes = parseInt(match12[2], 10);
      const period = match12[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
    } else {
      return null;
    }
  }

  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  return d;
}

/** Get all visitors currently inside the campus (have a card assigned) */
export async function getVisitorsInsideCampus(): Promise<Visitor[]> {
  const visitors = await getLocalVisitors();
  return visitors.filter(v => v.card_number && v.card_number.trim() !== '');
}

export async function updateVisitorPhoto(visitorId: string, photoUri: string): Promise<void> {
  const visitors = await getLocalVisitors();
  const idx = visitors.findIndex(v => v.id.toLowerCase() === visitorId.toLowerCase());
  if (idx >= 0) {
    visitors[idx] = { ...visitors[idx], local_photo: photoUri, updated_at: new Date().toISOString() };
    await saveLocalVisitors(visitors);
  }
}

export async function updateVisitorIdPhoto(visitorId: string, photoUri: string): Promise<void> {
  const visitors = await getLocalVisitors();
  const idx = visitors.findIndex(v => v.id.toLowerCase() === visitorId.toLowerCase());
  if (idx >= 0) {
    visitors[idx] = { ...visitors[idx], local_photo_id: photoUri, updated_at: new Date().toISOString() };
    await saveLocalVisitors(visitors);
  }
}

export async function preloadVisitors(): Promise<number> {
  const items = await getLocalVisitors();
  return items.length;
}

export async function getVisitorLastSyncTime(): Promise<string | null> {
  return await AsyncStorage.getItem(VISITORS_SYNC_KEY);
}

export async function setVisitorLastSyncTime(time: string): Promise<void> {
  await AsyncStorage.setItem(VISITORS_SYNC_KEY, time);
}

// ---- ZOHO Guests ----
let _zohoCache: ZohoGuest[] | null = null;
let _zohoLookupMap: Map<string, ZohoGuest> | null = null;

function invalidateZohoCache() {
  _zohoCache = null;
  _zohoLookupMap = null;
}

function buildZohoLookupMap(items: ZohoGuest[]): Map<string, ZohoGuest> {
  const map = new Map<string, ZohoGuest>();
  for (const g of items) {
    const key = String(g.zoho_id || '').trim().toLowerCase();
    if (key) map.set(key, g);
  }
  return map;
}

export async function getLocalZohoGuests(): Promise<ZohoGuest[]> {
  if (_zohoCache) return _zohoCache;
  const data = await AsyncStorage.getItem(ZOHO_GUESTS_KEY);
  _zohoCache = data ? JSON.parse(data) : [];
  _zohoLookupMap = buildZohoLookupMap(_zohoCache!);
  return _zohoCache!;
}

export async function saveLocalZohoGuests(items: ZohoGuest[]): Promise<void> {
  // Last row wins on duplicate ZOHO IDs.
  const map = new Map<string, ZohoGuest>();
  for (const g of items) {
    const key = String(g.zoho_id || '').trim().toLowerCase();
    if (key) map.set(key, g);
  }
  const deduped = Array.from(map.values());
  await AsyncStorage.setItem(ZOHO_GUESTS_KEY, JSON.stringify(deduped));
  _zohoCache = deduped;
  _zohoLookupMap = buildZohoLookupMap(deduped);
}

export async function getZohoGuestById(zohoId: string): Promise<ZohoGuest | null> {
  if (!_zohoLookupMap) await getLocalZohoGuests();
  return _zohoLookupMap!.get(String(zohoId || '').trim().toLowerCase()) || null;
}

export async function preloadZohoGuests(): Promise<number> {
  const items = await getLocalZohoGuests();
  return items.length;
}

export async function getZohoLastSyncTime(): Promise<string | null> {
  return await AsyncStorage.getItem(ZOHO_GUESTS_SYNC_KEY);
}

export async function setZohoLastSyncTime(time: string): Promise<void> {
  await AsyncStorage.setItem(ZOHO_GUESTS_SYNC_KEY, time);
}

// ---- Pending Visitor Check-ins Queue ----

export async function getPendingVisitorCheckins(): Promise<PendingVisitorCheckin[]> {
  const data = await AsyncStorage.getItem(PENDING_VISITOR_CHECKINS_KEY);
  return data ? JSON.parse(data) : [];
}

export async function addPendingVisitorCheckin(checkin: PendingVisitorCheckin): Promise<void> {
  // Save photo to file to avoid CursorWindow size limit
  const filePath = await saveLogPhoto(checkin.compositeBase64, 'visitor');
  const stored = { ...checkin, compositeBase64: filePath };
  const pending = await getPendingVisitorCheckins();
  pending.push(stored);
  await AsyncStorage.setItem(PENDING_VISITOR_CHECKINS_KEY, JSON.stringify(pending));
}

export async function removePendingVisitorCheckin(id: string): Promise<void> {
  const pending = await getPendingVisitorCheckins();
  const toRemove = pending.find(c => c.id === id);
  if (toRemove) await deleteLogPhoto(toRemove.compositeBase64);
  const filtered = pending.filter(c => c.id !== id);
  await AsyncStorage.setItem(PENDING_VISITOR_CHECKINS_KEY, JSON.stringify(filtered));
}

export async function clearPendingVisitorCheckins(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_VISITOR_CHECKINS_KEY);
}

// ---- Camera Consent ----

export async function hasCameraConsent(): Promise<boolean> {
  const val = await AsyncStorage.getItem(CAMERA_CONSENT_KEY);
  return val === 'true';
}

export async function setCameraConsent(): Promise<void> {
  await AsyncStorage.setItem(CAMERA_CONSENT_KEY, 'true');
}

// ---- Scanner-Only Mode (for devices without camera, e.g., Android TV boxes) ----

export async function isScannerOnlyMode(): Promise<boolean> {
  const val = await AsyncStorage.getItem(SCANNER_ONLY_MODE_KEY);
  return val === 'true';
}

export async function setScannerOnlyMode(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(SCANNER_ONLY_MODE_KEY, enabled ? 'true' : 'false');
}

export async function getKioskResultTimeoutSeconds(): Promise<number> {
  const val = await AsyncStorage.getItem(KIOSK_RESULT_TIMEOUT_SECONDS_KEY);
  const seconds = Number(val);
  if (!Number.isFinite(seconds)) return DEFAULT_KIOSK_RESULT_TIMEOUT_SECONDS;
  return Math.min(60, Math.max(1, Math.round(seconds)));
}

export async function setKioskResultTimeoutSeconds(seconds: number): Promise<void> {
  const safeSeconds = Math.min(60, Math.max(1, Math.round(seconds)));
  await AsyncStorage.setItem(KIOSK_RESULT_TIMEOUT_SECONDS_KEY, String(safeSeconds));
}

// ---- App Display Rotation ----

export async function isAppDisplayRotation90(): Promise<boolean> {
  const val = await AsyncStorage.getItem(APP_DISPLAY_ROTATION_90_KEY);
  return val === 'true';
}

export async function setAppDisplayRotation90(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(APP_DISPLAY_ROTATION_90_KEY, enabled ? 'true' : 'false');
}

// ---- Maid/Cook Attendance ----

export interface MaidCookAttendanceEntry {
  id: string;           // unique log id (timestamp-based)
  maid_cook_id: string;
  name: string;
  flat: string;         // flat they are going to
  direction: 'IN' | 'OUT';
  timestamp: string;    // ISO string
  location?: string;    // device location (e.g. "Front Gate")
}

export async function getMaidCookAttendance(): Promise<MaidCookAttendanceEntry[]> {
  const data = await AsyncStorage.getItem(MAID_COOK_ATTENDANCE_KEY);
  return data ? JSON.parse(data) : [];
}

export async function addMaidCookAttendance(entry: MaidCookAttendanceEntry): Promise<void> {
  const logs = await getMaidCookAttendance();
  logs.unshift(entry);
  // Keep last 2000 entries
  const trimmed = logs.slice(0, 2000);
  await AsyncStorage.setItem(MAID_COOK_ATTENDANCE_KEY, JSON.stringify(trimmed));
}

/** Get the set of log IDs already pushed to the sheet */
export async function getPushedAttendanceIds(): Promise<Set<string>> {
  const data = await AsyncStorage.getItem(MAID_COOK_ATTENDANCE_PUSHED_KEY);
  return new Set(data ? JSON.parse(data) : []);
}

/** Mark log IDs as pushed */
export async function markAttendancePushed(ids: string[]): Promise<void> {
  const existing = await getPushedAttendanceIds();
  for (const id of ids) existing.add(id);
  // Keep only last 5000 IDs to prevent unbounded growth
  const arr = Array.from(existing);
  const trimmed = arr.slice(-5000);
  await AsyncStorage.setItem(MAID_COOK_ATTENDANCE_PUSHED_KEY, JSON.stringify(trimmed));
}

/** Get unpushed attendance entries */
export async function getUnpushedAttendance(): Promise<MaidCookAttendanceEntry[]> {
  const all = await getMaidCookAttendance();
  const pushed = await getPushedAttendanceIds();
  return all.filter(e => !pushed.has(e.id));
}

/** Get maids/cooks currently IN (no matching OUT after their latest IN) */
export async function getCurrentlyInMaidsCooks(): Promise<{ maid_cook_id: string; name: string; flat: string; in_time: string }[]> {
  const all = await getMaidCookAttendance();
  // Walk entries (newest first) and track state per maid_cook_id+flat
  const seen = new Map<string, { direction: 'IN' | 'OUT'; name: string; flat: string; in_time: string }>();
  for (const entry of all) {
    const key = entry.maid_cook_id.toLowerCase() + '|' + entry.flat.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { direction: entry.direction, name: entry.name, flat: entry.flat, in_time: entry.timestamp });
    }
  }
  const result: { maid_cook_id: string; name: string; flat: string; in_time: string }[] = [];
  for (const [key, val] of seen) {
    if (val.direction === 'IN') {
      result.push({ maid_cook_id: key.split('|')[0], name: val.name, flat: val.flat, in_time: val.in_time });
    }
  }
  return result;
}

/** Get maids/cooks who have been IN for more than the given hours */
export async function getOverstayMaidsCooks(maxHours: number = 8): Promise<{ maid_cook_id: string; name: string; flat: string; in_time: string; hours: number }[]> {
  const currentlyIn = await getCurrentlyInMaidsCooks();
  const now = Date.now();
  return currentlyIn
    .map(m => ({ ...m, hours: Math.round((now - new Date(m.in_time).getTime()) / 3600000 * 10) / 10 }))
    .filter(m => m.hours >= maxHours);
}

// ---- Device Location ----
export const LOCATION_OPTIONS = [
  'Front Gate',
  'Tower 1',
  'Tower 2',
  'Tower 3',
  'Tower 4',
  'Tower 5',
  'Rear Gate',
  'EM Office',
] as const;

export type DeviceLocation = typeof LOCATION_OPTIONS[number];

export async function getDeviceLocation(): Promise<string> {
  const val = await AsyncStorage.getItem(DEVICE_LOCATION_KEY);
  return val || '';
}

export async function setDeviceLocation(location: string): Promise<void> {
  await AsyncStorage.setItem(DEVICE_LOCATION_KEY, location);
}

export async function getSyncToken(): Promise<string> {
  return (await AsyncStorage.getItem(SYNC_TOKEN_KEY)) || '';
}

export async function setSyncToken(token: string): Promise<void> {
  await AsyncStorage.setItem(SYNC_TOKEN_KEY, token);
}

export async function clearNewFlags(): Promise<void> {
  const residents = await getLocalResidents();
  const updated = residents.map(r => ({ ...r, is_new: false }));
  await saveLocalResidents(updated);
}

// ---- Taxi/Cab Log ----

export type VehicleType = 'auto' | 'car' | 'tempo';

export interface TaxiLogEntry {
  id: string;
  vehicle_number: string;
  vehicle_type?: VehicleType;
  flat: string;
  timestamp: string;
  compositeBase64: string;
  location?: string;
}

export async function addTaxiLog(entry: TaxiLogEntry): Promise<void> {
  // Save photo to file to avoid CursorWindow size limit
  const filePath = await saveLogPhoto(entry.compositeBase64, 'taxi');
  const stored = { ...entry, compositeBase64: filePath };
  const logs = await getTaxiLogs();
  logs.unshift(stored);
  const trimmed = logs.slice(0, 2000);
  await AsyncStorage.setItem(TAXI_LOG_KEY, JSON.stringify(trimmed));
}

export async function getTaxiLogs(): Promise<TaxiLogEntry[]> {
  const data = await AsyncStorage.getItem(TAXI_LOG_KEY);
  return data ? JSON.parse(data) : [];
}

export async function getPushedTaxiLogIds(): Promise<Set<string>> {
  const data = await AsyncStorage.getItem(TAXI_LOG_PUSHED_KEY);
  return new Set(data ? JSON.parse(data) : []);
}

export async function markTaxiLogsPushed(ids: string[]): Promise<void> {
  const existing = await getPushedTaxiLogIds();
  for (const id of ids) existing.add(id);
  const arr = Array.from(existing);
  const trimmed = arr.slice(-5000);
  await AsyncStorage.setItem(TAXI_LOG_PUSHED_KEY, JSON.stringify(trimmed));
}

export async function getUnpushedTaxiLogs(): Promise<TaxiLogEntry[]> {
  const all = await getTaxiLogs();
  const pushed = await getPushedTaxiLogIds();
  return all.filter(e => !pushed.has(e.id));
}

export async function getGlobalLogsCache(): Promise<GlobalLogsCache | null> {
  const data = await AsyncStorage.getItem(GLOBAL_LOGS_CACHE_KEY);
  return data ? JSON.parse(data) : null;
}

export async function saveGlobalLogsCache(cache: GlobalLogsCache): Promise<void> {
  await AsyncStorage.setItem(GLOBAL_LOGS_CACHE_KEY, JSON.stringify(cache));
}

export async function clearGlobalLogsCache(): Promise<void> {
  await AsyncStorage.removeItem(GLOBAL_LOGS_CACHE_KEY);
}
