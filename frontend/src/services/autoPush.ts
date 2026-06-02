import NetInfo from '@react-native-community/netinfo';
import {
  getUnpushedAccessLogs, markAccessLogsPushed,
  getPendingVisitorCheckins, removePendingVisitorCheckin,
  getUnpushedAttendance, markAttendancePushed,
  getUnpushedTaxiLogs, markTaxiLogsPushed,
} from './storage';
import {
  pushLogsToGoogleDrive, uploadVisitorCheckin,
  pushMaidCookAttendance, pushTaxiLogs,
} from './api';

let syncing = false;

/**
 * Push all unpushed logs to the cloud.
 * Silently skips if already syncing or no network.
 */
export async function pushAllUnpushed(): Promise<void> {
  if (syncing) return;

  const state = await NetInfo.fetch();
  if (!state.isConnected) return;

  syncing = true;
  try {
    // Access logs
    const accessLogs = await getUnpushedAccessLogs();
    if (accessLogs.length > 0) {
      try {
        await pushLogsToGoogleDrive(accessLogs);
        await markAccessLogsPushed(accessLogs.map(e => e.id));
      } catch { /* will retry next time */ }
    }

    // Visitor check-ins
    const checkins = await getPendingVisitorCheckins();
    for (const checkin of checkins) {
      try {
        await uploadVisitorCheckin({
          visitor: checkin.visitor,
          photoBase64: checkin.compositeBase64,
          timestamp: checkin.timestamp,
          location: checkin.location,
        });
        await removePendingVisitorCheckin(checkin.id);
      } catch { /* will retry next time */ }
    }

    // Maid/cook attendance
    const attendance = await getUnpushedAttendance();
    if (attendance.length > 0) {
      try {
        await pushMaidCookAttendance(attendance);
        await markAttendancePushed(attendance.map(e => e.id));
      } catch { /* will retry next time */ }
    }

    // Taxi logs
    const taxiLogs = await getUnpushedTaxiLogs();
    if (taxiLogs.length > 0) {
      try {
        await pushTaxiLogs(taxiLogs);
        await markTaxiLogsPushed(taxiLogs.map(e => e.id));
      } catch { /* will retry next time */ }
    }
  } finally {
    syncing = false;
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * Start listening for network recovery. When connectivity returns,
 * automatically push any cached logs.
 */
export function startNetworkSync(): void {
  if (unsubscribe) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      pushAllUnpushed();
    }
  });
}

export function stopNetworkSync(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
