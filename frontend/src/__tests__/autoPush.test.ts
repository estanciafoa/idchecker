import NetInfo from '@react-native-community/netinfo';

// Mock storage and api modules
jest.mock('../services/storage', () => ({
  getUnpushedAccessLogs: jest.fn(async () => []),
  markAccessLogsPushed: jest.fn(async () => {}),
  getPendingVisitorCheckins: jest.fn(async () => []),
  removePendingVisitorCheckin: jest.fn(async () => {}),
  getUnpushedAttendance: jest.fn(async () => []),
  markAttendancePushed: jest.fn(async () => {}),
  getUnpushedTaxiLogs: jest.fn(async () => []),
  markTaxiLogsPushed: jest.fn(async () => {}),
  loadLogPhoto: jest.fn(async (path: string) => path),
}));

jest.mock('../services/api', () => ({
  pushLogsToGoogleDrive: jest.fn(async () => ({ rowCount: 1 })),
  uploadVisitorCheckin: jest.fn(async () => ({ uploaded: true })),
  pushMaidCookAttendance: jest.fn(async () => ({ rowsAppended: 1 })),
  pushTaxiLogs: jest.fn(async () => ({ rowsAppended: 1 })),
}));

import { pushAllUnpushed, getLastPushErrors, startNetworkSync, stopNetworkSync } from '../services/autoPush';
import * as storage from '../services/storage';
import * as api from '../services/api';

beforeEach(() => {
  jest.clearAllMocks();
  // Reset syncing flag by ensuring previous push finished
});

describe('pushAllUnpushed', () => {
  test('does nothing when no network', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: false });
    await pushAllUnpushed();
    expect(storage.getUnpushedAccessLogs).not.toHaveBeenCalled();
  });

  test('pushes access logs when available', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true });
    const logs = [{ id: 'L1', resident_id: 'R1', resident_name: 'Test', unit: 'A-101', timestamp: '2026-01-01', status: 'verified' }];
    (storage.getUnpushedAccessLogs as jest.Mock).mockResolvedValueOnce(logs);
    await pushAllUnpushed();
    expect(api.pushLogsToGoogleDrive).toHaveBeenCalledWith(logs);
    expect(storage.markAccessLogsPushed).toHaveBeenCalledWith(['L1']);
  });

  test('pushes visitor checkins individually', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true });
    const checkins = [{ id: 'C1', visitor: { id: 'V1' }, compositeBase64: 'photo', timestamp: '2026-01-01' }];
    (storage.getPendingVisitorCheckins as jest.Mock).mockResolvedValueOnce(checkins);
    await pushAllUnpushed();
    expect(api.uploadVisitorCheckin).toHaveBeenCalled();
    expect(storage.removePendingVisitorCheckin).toHaveBeenCalledWith('C1');
  });

  test('pushes maid/cook attendance when available', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true });
    const attendance = [{ id: 'A1', maid_cook_id: 'M1', name: 'Lakshmi', flat: 'A-101', direction: 'IN', timestamp: '2026-01-01' }];
    (storage.getUnpushedAttendance as jest.Mock).mockResolvedValueOnce(attendance);
    await pushAllUnpushed();
    expect(api.pushMaidCookAttendance).toHaveBeenCalledWith(attendance);
    expect(storage.markAttendancePushed).toHaveBeenCalledWith(['A1']);
  });

  test('pushes taxi logs with photos', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true });
    const taxiLogs = [{ id: 'T1', vehicle_number: 'KA01', flat: 'A-101', timestamp: '2026-01-01', compositeBase64: 'photo_path' }];
    (storage.getUnpushedTaxiLogs as jest.Mock).mockResolvedValueOnce(taxiLogs);
    await pushAllUnpushed();
    expect(api.pushTaxiLogs).toHaveBeenCalled();
    expect(storage.markTaxiLogsPushed).toHaveBeenCalledWith(['T1']);
  });

  test('captures errors per category and continues', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true });
    const logs = [{ id: 'L1' }];
    (storage.getUnpushedAccessLogs as jest.Mock).mockResolvedValueOnce(logs);
    (api.pushLogsToGoogleDrive as jest.Mock).mockRejectedValueOnce(new Error('network fail'));
    // Other categories should still be attempted
    const taxi = [{ id: 'T1', compositeBase64: 'p' }];
    (storage.getUnpushedTaxiLogs as jest.Mock).mockResolvedValueOnce(taxi);

    await pushAllUnpushed();

    // Taxi should still have been attempted even though access failed
    expect(api.pushTaxiLogs).toHaveBeenCalled();
    const errors = getLastPushErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toContain('Access logs');
  });

  test('skips when no logs to push', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true });
    await pushAllUnpushed();
    expect(api.pushLogsToGoogleDrive).not.toHaveBeenCalled();
    expect(api.pushMaidCookAttendance).not.toHaveBeenCalled();
    expect(api.pushTaxiLogs).not.toHaveBeenCalled();
  });
});

describe('startNetworkSync / stopNetworkSync', () => {
  test('startNetworkSync registers a listener', () => {
    startNetworkSync();
    expect(NetInfo.addEventListener).toHaveBeenCalled();
    stopNetworkSync(); // cleanup
  });

  test('stopNetworkSync unsubscribes', () => {
    startNetworkSync();
    stopNetworkSync();
    // Calling start again should work (no double subscription)
    startNetworkSync();
    stopNetworkSync();
  });
});
