import AsyncStorage from '@react-native-async-storage/async-storage';

const RESIDENTS_KEY = '@gate_check_residents';
const ACCESS_LOGS_KEY = '@gate_check_logs';
const LAST_SYNC_KEY = '@gate_check_last_sync';
const MAIDS_COOKS_KEY = '@gate_check_maids_cooks';
const MAIDS_COOKS_SYNC_KEY = '@gate_check_maids_cooks_last_sync';
const VISITORS_KEY = '@gate_check_visitors';
const VISITORS_SYNC_KEY = '@gate_check_visitors_last_sync';
const PENDING_VISITOR_CHECKINS_KEY = '@gate_check_pending_visitor_checkins';
const CAMERA_CONSENT_KEY = '@gate_check_camera_consent';
const MAID_COOK_ATTENDANCE_KEY = '@gate_check_maid_cook_attendance';
const MAID_COOK_ATTENDANCE_PUSHED_KEY = '@gate_check_maid_cook_attendance_pushed';
const DEVICE_LOCATION_KEY = '@gate_check_device_location';

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
  const trimmed = logs.slice(0, 500);
  await AsyncStorage.setItem(ACCESS_LOGS_KEY, JSON.stringify(trimmed));
}

// Sync timestamp
export async function getLastSyncTime(): Promise<string | null> {
  return await AsyncStorage.getItem(LAST_SYNC_KEY);
}

export async function setLastSyncTime(time: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SYNC_KEY, time);
}

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove([RESIDENTS_KEY, LAST_SYNC_KEY, MAIDS_COOKS_KEY, MAIDS_COOKS_SYNC_KEY, VISITORS_KEY, VISITORS_SYNC_KEY, PENDING_VISITOR_CHECKINS_KEY]);
  invalidateMaidCookCache();
  invalidateVisitorCache();
}

export async function clearSyncData(): Promise<void> {
  await AsyncStorage.multiRemove([RESIDENTS_KEY, LAST_SYNC_KEY, MAIDS_COOKS_KEY, MAIDS_COOKS_SYNC_KEY, VISITORS_KEY, VISITORS_SYNC_KEY]);
  _cache = null;
  _lookupMap = null;
  invalidateMaidCookCache();
  invalidateVisitorCache();
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

// ---- Pending Visitor Check-ins Queue ----

export async function getPendingVisitorCheckins(): Promise<PendingVisitorCheckin[]> {
  const data = await AsyncStorage.getItem(PENDING_VISITOR_CHECKINS_KEY);
  return data ? JSON.parse(data) : [];
}

export async function addPendingVisitorCheckin(checkin: PendingVisitorCheckin): Promise<void> {
  const pending = await getPendingVisitorCheckins();
  pending.push(checkin);
  await AsyncStorage.setItem(PENDING_VISITOR_CHECKINS_KEY, JSON.stringify(pending));
}

export async function removePendingVisitorCheckin(id: string): Promise<void> {
  const pending = await getPendingVisitorCheckins();
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
] as const;

export type DeviceLocation = typeof LOCATION_OPTIONS[number];

export async function getDeviceLocation(): Promise<string> {
  const val = await AsyncStorage.getItem(DEVICE_LOCATION_KEY);
  return val || '';
}

export async function setDeviceLocation(location: string): Promise<void> {
  await AsyncStorage.setItem(DEVICE_LOCATION_KEY, location);
}
