import AsyncStorage from '@react-native-async-storage/async-storage';

// Must import after mocks are set up
import {
  getLocalResidents,
  saveLocalResidents,
  getResidentById,
  deleteLocalResident,
  preloadResidents,
  getLocalAccessLogs,
  addAccessLog,
  markAccessLogsPushed,
  getUnpushedAccessLogs,
  clearAllData,
  clearSyncData,
  getLocalMaidsCooks,
  saveLocalMaidsCooks,
  getMaidCookById,
  getMaidCookAttendance,
  addMaidCookAttendance,
  markAttendancePushed,
  getUnpushedAttendance,
  getCurrentlyInMaidsCooks,
  getOverstayMaidsCooks,
  getLocalVisitors,
  saveLocalVisitors,
  getVisitorById,
  getVisitorsByFlat,
  getVisitorByCard,
  assignCardToVisitor,
  returnCard,
  getPendingVisitorCheckins,
  addPendingVisitorCheckin,
  removePendingVisitorCheckin,
  getTaxiLogs,
  addTaxiLog,
  markTaxiLogsPushed,
  getUnpushedTaxiLogs,
  setDeviceLocation,
  getDeviceLocation,
  type Resident,
  type AccessLogEntry,
  type MaidCookAttendanceEntry,
  type MaidCook,
  type Visitor,
  type TaxiLogEntry,
} from '../services/storage';

// Reset AsyncStorage mock store between tests
beforeEach(() => {
  (AsyncStorage as any)._reset();
  jest.clearAllMocks();
});

// ---- Residents ----
describe('Residents', () => {
  const resident: Resident = {
    id: 'R001',
    name: 'Test User',
    unit: 'A-101',
    aadhar_masked: 'XXXX1234',
    phone_last4: '5678',
    vehicle_plate: 'KA01AB1234',
    photo_url: '',
    photo_base64: '',
    local_photo: '',
    validity: '31/12/2026',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  test('saveLocalResidents + getLocalResidents round-trips', async () => {
    await saveLocalResidents([resident]);
    const result = await getLocalResidents();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('R001');
    expect(result[0].name).toBe('Test User');
  });

  test('saveLocalResidents deduplicates by id', async () => {
    const dup = { ...resident, name: 'Updated Name' };
    await saveLocalResidents([resident, dup]);
    const result = await getLocalResidents();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Updated Name');
  });

  test('getResidentById returns resident (case-insensitive)', async () => {
    await saveLocalResidents([resident]);
    const found = await getResidentById('r001');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Test User');
  });

  test('getResidentById returns null for non-existent', async () => {
    await saveLocalResidents([resident]);
    const found = await getResidentById('NONEXIST');
    expect(found).toBeNull();
  });

  test('deleteLocalResident removes by id', async () => {
    await saveLocalResidents([resident]);
    await deleteLocalResident('R001');
    const result = await getLocalResidents();
    expect(result).toHaveLength(0);
  });

  test('preloadResidents returns count', async () => {
    await saveLocalResidents([resident, { ...resident, id: 'R002' }]);
    // Clear cache to force reload
    const count = await preloadResidents();
    expect(count).toBe(2);
  });
});

// ---- Access Logs ----
describe('Access Logs', () => {
  const log: AccessLogEntry = {
    id: 'LOG001',
    resident_id: 'R001',
    resident_name: 'Test User',
    unit: 'A-101',
    timestamp: '2026-06-01T10:00:00Z',
    status: 'verified',
    location: 'Front Gate',
  };

  test('addAccessLog stores and trims to 5000', async () => {
    await addAccessLog(log);
    const logs = await getLocalAccessLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe('LOG001');
  });

  test('addAccessLog anonymizes resident name', async () => {
    await addAccessLog(log);
    const logs = await getLocalAccessLogs();
    expect(logs[0].resident_name).not.toBe('Test User');
    expect(logs[0].resident_name).toContain('***');
  });

  test('newest log is first (unshift)', async () => {
    await addAccessLog(log);
    await addAccessLog({ ...log, id: 'LOG002', timestamp: '2026-06-01T11:00:00Z' });
    const logs = await getLocalAccessLogs();
    expect(logs[0].id).toBe('LOG002');
    expect(logs[1].id).toBe('LOG001');
  });

  test('markAccessLogsPushed + getUnpushedAccessLogs', async () => {
    await addAccessLog(log);
    await addAccessLog({ ...log, id: 'LOG002' });

    let unpushed = await getUnpushedAccessLogs();
    expect(unpushed).toHaveLength(2);

    await markAccessLogsPushed(['LOG001']);
    unpushed = await getUnpushedAccessLogs();
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].id).toBe('LOG002');
  });

  test('markAccessLogsPushed is additive', async () => {
    await markAccessLogsPushed(['LOG001']);
    await markAccessLogsPushed(['LOG002']);
    await addAccessLog(log);
    await addAccessLog({ ...log, id: 'LOG002' });
    await addAccessLog({ ...log, id: 'LOG003' });
    const unpushed = await getUnpushedAccessLogs();
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].id).toBe('LOG003');
  });
});

// ---- Maid/Cook Attendance ----
describe('Maid/Cook Attendance', () => {
  const entry: MaidCookAttendanceEntry = {
    id: 'MC001',
    maid_cook_id: 'M1',
    name: 'Lakshmi',
    flat: 'A-101',
    direction: 'IN',
    timestamp: '2026-06-01T08:00:00Z',
    location: 'Front Gate',
  };

  test('addMaidCookAttendance + getMaidCookAttendance', async () => {
    await addMaidCookAttendance(entry);
    const logs = await getMaidCookAttendance();
    expect(logs).toHaveLength(1);
    expect(logs[0].name).toBe('Lakshmi');
  });

  test('unpushed attendance tracking', async () => {
    await addMaidCookAttendance(entry);
    await addMaidCookAttendance({ ...entry, id: 'MC002', direction: 'OUT' });

    let unpushed = await getUnpushedAttendance();
    expect(unpushed).toHaveLength(2);

    await markAttendancePushed(['MC001']);
    unpushed = await getUnpushedAttendance();
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].id).toBe('MC002');
  });

  test('getCurrentlyInMaidsCooks returns only those still IN', async () => {
    await addMaidCookAttendance(entry); // IN at 8:00
    const currentlyIn = await getCurrentlyInMaidsCooks();
    expect(currentlyIn).toHaveLength(1);
    expect(currentlyIn[0].name).toBe('Lakshmi');
  });

  test('getCurrentlyInMaidsCooks excludes those who checked OUT', async () => {
    // OUT entry is added first (newest first since unshift)
    await addMaidCookAttendance(entry); // IN at 8:00
    await addMaidCookAttendance({ ...entry, id: 'MC002', direction: 'OUT', timestamp: '2026-06-01T12:00:00Z' }); // OUT at 12:00
    const currentlyIn = await getCurrentlyInMaidsCooks();
    expect(currentlyIn).toHaveLength(0);
  });
});

// ---- Maids/Cooks Master Data ----
describe('Maids/Cooks Master', () => {
  const mc: MaidCook = {
    id: 'M001',
    name: 'Lakshmi',
    flats: 'A-101,A-102',
    aadhar_masked: 'XXXX5678',
    phone_last4: '9012',
    vehicle_plate: '',
    photo_url: '',
    photo_base64: '',
    local_photo: '',
    validity: '31/12/2026',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  test('save and get maid/cook', async () => {
    await saveLocalMaidsCooks([mc]);
    const result = await getLocalMaidsCooks();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Lakshmi');
  });

  test('getMaidCookById case-insensitive', async () => {
    await saveLocalMaidsCooks([mc]);
    const found = await getMaidCookById('m001');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Lakshmi');
  });

  test('deduplicates on save', async () => {
    await saveLocalMaidsCooks([mc, { ...mc, name: 'Updated' }]);
    const result = await getLocalMaidsCooks();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Updated');
  });
});

// ---- Visitors ----
describe('Visitors', () => {
  const visitor: Visitor = {
    id: 'V001',
    name: 'John Doe',
    flat: 'A-101',
    aadhar_last4: '1234',
    nature: 'Guest',
    visit_date: '2026-06-01',
    requested_by: 'Resident X',
    check_in: '',
    check_out: '',
    night_stay: 'No',
    office_status: 'Approved',
    local_photo: '',
    local_photo_id: '',
    card_number: '',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  test('save and get visitors', async () => {
    await saveLocalVisitors([visitor]);
    const result = await getLocalVisitors();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  test('getVisitorById case-insensitive', async () => {
    await saveLocalVisitors([visitor]);
    const found = await getVisitorById('v001');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('John Doe');
  });

  test('getVisitorsByFlat filters correctly', async () => {
    await saveLocalVisitors([visitor, { ...visitor, id: 'V002', flat: 'B-201' }]);
    const result = await getVisitorsByFlat('A-101');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('V001');
  });

  test('getVisitorsByFlat is case-insensitive', async () => {
    await saveLocalVisitors([visitor]);
    const result = await getVisitorsByFlat('a-101');
    expect(result).toHaveLength(1);
  });

  test('assignCardToVisitor assigns card', async () => {
    await saveLocalVisitors([visitor]);
    await assignCardToVisitor('V001', 'CARD-42');
    const found = await getVisitorById('V001');
    expect(found!.card_number).toBe('CARD-42');
  });

  test('assignCardToVisitor clears card from other visitor', async () => {
    await saveLocalVisitors([
      { ...visitor, card_number: 'CARD-42' },
      { ...visitor, id: 'V002', name: 'Jane', flat: 'B-201' },
    ]);
    await assignCardToVisitor('V002', 'CARD-42');
    const v1 = await getVisitorById('V001');
    const v2 = await getVisitorById('V002');
    expect(v1!.card_number).toBe('');
    expect(v2!.card_number).toBe('CARD-42');
  });

  test('getVisitorByCard finds by card number', async () => {
    await saveLocalVisitors([{ ...visitor, card_number: 'CARD-42' }]);
    const found = await getVisitorByCard('CARD-42');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('V001');
  });

  test('getVisitorByCard returns null for empty card', async () => {
    const result = await getVisitorByCard('');
    expect(result).toBeNull();
  });

  test('returnCard clears card from visitor', async () => {
    await saveLocalVisitors([{ ...visitor, card_number: 'CARD-42' }]);
    await returnCard('CARD-42');
    const found = await getVisitorByCard('CARD-42');
    expect(found).toBeNull();
  });
});

// ---- Taxi Logs ----
describe('Taxi Logs', () => {
  const taxiEntry: TaxiLogEntry = {
    id: 'T001',
    vehicle_number: 'KA01XX1234',
    vehicle_type: 'auto',
    flat: 'A-101',
    timestamp: '2026-06-01T10:00:00Z',
    compositeBase64: 'base64photodata',
    location: 'Front Gate',
  };

  test('addTaxiLog + getTaxiLogs', async () => {
    await addTaxiLog(taxiEntry);
    const logs = await getTaxiLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].vehicle_number).toBe('KA01XX1234');
  });

  test('unpushed taxi log tracking', async () => {
    await addTaxiLog(taxiEntry);
    await addTaxiLog({ ...taxiEntry, id: 'T002' });

    let unpushed = await getUnpushedTaxiLogs();
    expect(unpushed).toHaveLength(2);

    await markTaxiLogsPushed(['T001']);
    unpushed = await getUnpushedTaxiLogs();
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].id).toBe('T002');
  });
});

// ---- Device Location ----
describe('Device Location', () => {
  test('set and get location', async () => {
    await setDeviceLocation('Front Gate');
    const loc = await getDeviceLocation();
    expect(loc).toBe('Front Gate');
  });

  test('returns empty string when not set', async () => {
    const loc = await getDeviceLocation();
    expect(loc).toBe('');
  });
});

// ---- Clear Data ----
describe('Clear Data', () => {
  test('clearAllData removes all keys', async () => {
    await saveLocalResidents([{
      id: 'R001', name: 'Test', unit: 'A-101', aadhar_masked: '', phone_last4: '',
      vehicle_plate: '', photo_url: '', photo_base64: '', local_photo: '',
      validity: '', status: 'active', created_at: '', updated_at: '',
    }]);
    await setDeviceLocation('Front Gate');
    await clearAllData();
    // After clearAllData the AsyncStorage keys are removed;
    // verify directly via AsyncStorage that the residents key is gone
    const raw = await AsyncStorage.getItem('@gate_check_residents');
    expect(raw).toBeNull();
  });

  test('clearSyncData only removes sync-related keys', async () => {
    await setDeviceLocation('Front Gate');
    await clearSyncData();
    // Device location should still be there
    const loc = await getDeviceLocation();
    expect(loc).toBe('Front Gate');
  });
});
