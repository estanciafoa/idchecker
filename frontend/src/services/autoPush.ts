import NetInfo from '@react-native-community/netinfo';
import {
  getUnpushedAccessLogs, markAccessLogsPushed,
  getPendingVisitorCheckins, removePendingVisitorCheckin,
  getUnpushedAttendance, markAttendancePushed,
  getUnpushedTaxiLogs, markTaxiLogsPushed,
  loadLogPhoto,
} from './storage';
import {
  pushLogsToGoogleDrive, uploadVisitorCheckin,
  pushMaidCookAttendance, pushTaxiLogs,
} from './api';

let syncing = false;
let lastPushErrors: string[] = [];

/** Get errors from the last push attempt (for diagnostics) */
export function getLastPushErrors(): string[] {
  return lastPushErrors;
}

/**
 * Push all unpushed logs to the cloud.
 * Silently skips if already syncing or no network.
 */
export async function pushAllUnpushed(): Promise<void> {
  if (syncing) return;

  const state = await NetInfo.fetch();
  if (!state.isConnected) return;

  syncing = true;
  const errors: string[] = [];
  try {
    // Access logs
    const accessLogs = await getUnpushedAccessLogs();
    if (accessLogs.length > 0) {
      try {
        await pushLogsToGoogleDrive(accessLogs);
        await markAccessLogsPushed(accessLogs.map(e => e.id));
      } catch (e: any) { errors.push(`Access logs: ${e.message || 'unknown'}`); }
    }

    // Visitor check-ins
    const checkins = await getPendingVisitorCheckins();
    for (const checkin of checkins) {
      try {
        const photoBase64 = await loadLogPhoto(checkin.compositeBase64);
        await uploadVisitorCheckin({
          checkinId: checkin.id,
          visitor: checkin.visitor,
          photoBase64,
          timestamp: checkin.timestamp,
          location: checkin.location,
        });
        await removePendingVisitorCheckin(checkin.id);
      } catch (e: any) { errors.push(`Visitor ${checkin.id}: ${e.message || 'unknown'}`); }
    }

    // Maid/cook attendance
    const attendance = await getUnpushedAttendance();
    if (attendance.length > 0) {
      try {
        await pushMaidCookAttendance(attendance);
        await markAttendancePushed(attendance.map(e => e.id));
      } catch (e: any) { errors.push(`Attendance: ${e.message || 'unknown'}`); }
    }

    // Taxi logs
    const taxiLogs = await getUnpushedTaxiLogs();
    if (taxiLogs.length > 0) {
      try {
        const withPhotos = await Promise.all(taxiLogs.map(async e => ({
          ...e,
          compositeBase64: await loadLogPhoto(e.compositeBase64),
        })));
        await pushTaxiLogs(withPhotos);
        await markTaxiLogsPushed(taxiLogs.map(e => e.id));
      } catch (e: any) { errors.push(`Taxi logs: ${e.message || 'unknown'}`); }
    }
  } finally {
    lastPushErrors = errors;
    syncing = false;
  }
}

let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start listening for network recovery. When connectivity returns,
 * automatically push any cached logs (debounced to avoid rapid fire).
 */
export function startNetworkSync(): void {
  if (unsubscribe) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        pushAllUnpushed();
      }, 3000);
    }
  });
}

export function stopNetworkSync(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
