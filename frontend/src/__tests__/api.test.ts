// Tests for api.ts service layer

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Set required env var
process.env.EXPO_PUBLIC_BACKEND_URL = 'http://localhost:3000';

import {
  syncResidents,
  postAccessLog,
  createResident,
  deleteResident,
  pushLogsToGoogleDrive,
  uploadVisitorCheckin,
  pushMaidCookAttendance,
  pushTaxiLogs,
} from '../services/api';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function mockOk(data: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
    statusText: 'OK',
  });
}

function mockOkAppsScript(result: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, result }),
    statusText: 'OK',
  });
}

function mockFail(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    statusText,
    json: async () => ({}),
  });
}

describe('Backend API', () => {
  test('syncResidents calls correct URL', async () => {
    mockOk({ residents: [] });
    await syncResidents();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sync',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('syncResidents throws on non-OK response', async () => {
    mockFail(500, 'Server Error');
    await expect(syncResidents()).rejects.toThrow('Sync failed');
  });

  test('postAccessLog sends POST with correct body', async () => {
    mockOk({ id: 'LOG1' });
    const data = { resident_id: 'R1', resident_name: 'Test', unit: 'A-101', status: 'verified' };
    await postAccessLog(data);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/access-logs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });

  test('createResident sends POST', async () => {
    mockOk({ id: 'R1' });
    await createResident({ name: 'Test', unit: 'A-101' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/residents',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('deleteResident sends DELETE', async () => {
    mockOk({ deleted: true });
    await deleteResident('R1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/residents/R1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('Apps Script API', () => {
  test('pushLogsToGoogleDrive sends upload_logs action', async () => {
    mockOkAppsScript({ fileName: 'logs.csv', rowCount: 1 });
    const logs = [{ id: 'L1', resident_id: 'R1', resident_name: 'Test', unit: 'A-101', timestamp: '2026-01-01', status: 'verified' }];
    const result = await pushLogsToGoogleDrive(logs);
    expect(result.rowCount).toBe(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.action).toBe('upload_logs');
    expect(body.logs).toHaveLength(1);
  });

  test('pushLogsToGoogleDrive throws on server error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'quota exceeded' }),
    });
    await expect(pushLogsToGoogleDrive([])).rejects.toThrow('quota exceeded');
  });

  test('uploadVisitorCheckin sends visitor data', async () => {
    mockOkAppsScript({ uploaded: true, fileName: 'visitor_V1.jpg' });
    const data = {
      visitor: { id: 'V1', name: 'John', flat: 'A-101', phone: '1234', aadhar: '5678', purpose: 'Visit' },
      photoBase64: 'base64data',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const result = await uploadVisitorCheckin(data);
    expect(result.uploaded).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.action).toBe('upload_visitor_checkin');
  });

  test('pushMaidCookAttendance sends entries', async () => {
    mockOkAppsScript({ rowsAppended: 2 });
    const entries = [
      { id: 'A1', maid_cook_id: 'M1', name: 'Test', flat: 'A-101', direction: 'IN' as const, timestamp: '2026-01-01' },
    ];
    const result = await pushMaidCookAttendance(entries);
    expect(result.rowsAppended).toBe(2);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.action).toBe('upload_maid_cook_attendance');
  });

  test('pushTaxiLogs sends entries with photos', async () => {
    mockOkAppsScript({ rowsAppended: 1 });
    const entries = [
      { id: 'T1', vehicle_number: 'KA01', flat: 'A-101', timestamp: '2026-01-01', compositeBase64: 'photo' },
    ];
    const result = await pushTaxiLogs(entries);
    expect(result.rowsAppended).toBe(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.action).toBe('upload_taxi_log');
    expect(body.entries[0].vehicle_number).toBe('KA01');
  });

  test('pushTaxiLogs throws on HTTP error', async () => {
    mockFail(500, 'Internal Server Error');
    await expect(
      pushTaxiLogs([{ id: 'T1', vehicle_number: 'X', flat: '1', timestamp: '', compositeBase64: '' }]),
    ).rejects.toThrow('Taxi log upload failed');
  });
});

describe('Scale utility', () => {
  test('fs returns original size on phone (360px width)', () => {
    // Our mock sets width to 360
    const { fs } = require('../utils/scale');
    expect(fs(14)).toBe(14);
  });
});
