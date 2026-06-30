import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getLocalResidents, saveLocalResidents, getSyncToken,
  getLocalMaidsCooks, saveLocalMaidsCooks,
} from './storage';
import {
  getFacesFolderId,
  downloadPhotosFromDriveFolder,
  attachLocalPhotosById,
  repairPoisonedFaces,
  MAIDCOOK_PHOTOS_DIR_NAME,
} from './photos';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';

let backfilling = false;

/**
 * Fetch the set of student IDs whose sheet flag is n/u/up — the only rows we
 * are allowed to pull a missing face for. Returns null if it can't be fetched
 * (no token / offline / error), in which case we skip the backfill entirely.
 */
async function getFlaggedStudentIds(): Promise<Set<string> | null> {
  const token = await getSyncToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `${APPS_SCRIPT_URL}?action=get_student_flags&token=${encodeURIComponent(token)}`,
      { redirect: 'follow' },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    const flagged = new Set<string>();
    for (const r of data.result?.rows || []) {
      const f = String(r.flag || '').toLowerCase();
      if (f === 'n' || f === 'u' || f === 'up') flagged.add(String(r.id).toLowerCase());
    }
    return flagged;
  } catch (_) {
    return null;
  }
}

/**
 * Best-effort background backfill: when online, pull a face from the Drive
 * "faces" folder for residents that have NO local photo AND whose sheet row is
 * flagged n/u/up. Blank-flag residents are intentionally left alone so this
 * stays cheap. No-ops when offline, already running, or nothing qualifies.
 * Faces already on disk are skipped by downloadPhotosFromDriveFolder.
 */
export async function backfillMissingPhotos(): Promise<void> {
  if (backfilling) return;

  const state = await NetInfo.fetch();
  if (!state.isConnected) return;

  backfilling = true;
  try {
    const residents = await getLocalResidents();
    const missing = residents.filter(r => !r.local_photo);
    if (missing.length === 0) return;

    const flagged = await getFlaggedStudentIds();
    if (!flagged || flagged.size === 0) return; // nothing flagged → nothing to pull

    const pullIds = missing.map(r => r.id).filter(id => flagged.has(id.toLowerCase()));
    if (pullIds.length === 0) return;

    const facesFolderId = await getFacesFolderId();
    if (!facesFolderId) return;

    const downloaded = await downloadPhotosFromDriveFolder(facesFolderId, pullIds);
    if (downloaded > 0) {
      const attached = await attachLocalPhotosById(residents);
      await saveLocalResidents(attached);
    }
  } catch (_) {
    // best-effort; retry on the next connectivity event
  } finally {
    backfilling = false;
  }
}

let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start backfilling flagged missing faces whenever connectivity returns (debounced).
 */
export function startPhotoBackfill(): void {
  if (unsubscribe) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        backfillMissingPhotos();
      }, 4000);
    }
  });
}

export function stopPhotoBackfill(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

const REPAIR_DONE_KEY = '@photo_repair_v1';

/**
 * One-time repair: delete poisoned (HTML-saved-as-jpg) face files left by the
 * old download path and re-fetch them cleanly. Runs once per device (guarded by
 * a flag), only when online and a faces folder exists.
 */
export async function runPhotoRepairOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(REPAIR_DONE_KEY)) return;
    const state = await NetInfo.fetch();
    if (!state.isConnected) return; // try again next launch (don't mark done)
    const folderId = await getFacesFolderId();
    if (!folderId) return;

    const fixedResidents = await repairPoisonedFaces(folderId);
    if (fixedResidents > 0) {
      const residents = await getLocalResidents();
      await saveLocalResidents(await attachLocalPhotosById(residents));
    }
    const fixedMaids = await repairPoisonedFaces(folderId, MAIDCOOK_PHOTOS_DIR_NAME);
    if (fixedMaids > 0) {
      const maids = await getLocalMaidsCooks();
      await saveLocalMaidsCooks(await attachLocalPhotosById(maids, MAIDCOOK_PHOTOS_DIR_NAME));
    }
    await AsyncStorage.setItem(REPAIR_DONE_KEY, new Date().toISOString());
  } catch (_) {
    // best-effort; will retry next launch since the flag isn't set
  }
}
