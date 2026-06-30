import { File, Directory, Paths } from 'expo-file-system/next';
import { parseValidityDate } from '../utils/dateUtils';
import {
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
  readDirectoryAsync,
  downloadAsync,
  deleteAsync,
  EncodingType,
  documentDirectory,
  cacheDirectory,
} from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { type Resident } from './storage';

const PHOTOS_DIR_NAME = 'resident_photos';
export const MAIDCOOK_PHOTOS_DIR_NAME = 'maidcook_photos';

async function getPhotosDir(dirName: string = PHOTOS_DIR_NAME): Promise<Directory> {
  const dir = new Directory(Paths.document, dirName);
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

function getFileExtension(url: string): string {
  const match = url.match(/\.(jpg|jpeg|png|gif|webp)/i);
  return match ? match[0] : '.jpg';
}

/**
 * Convert Google Drive share/view URLs to direct download URLs.
 * Handles formats:
 *   https://drive.google.com/file/d/FILE_ID/view?...
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID  (already direct)
 */
function toDirectUrl(url: string): string {
  if (!url) return url;
  // googleapis.com URLs with access_token are already direct — don't transform
  if (url.includes('googleapis.com/')) return url;
  // Already a direct download URL
  if (url.includes('drive.google.com/uc')) return url;
  // /file/d/FILE_ID/...
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([^/?\s]+)/);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  // open?id=FILE_ID
  const openMatch = url.match(/drive\.google\.com\/open\?id=([^&\s]+)/);
  if (openMatch) return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
  return url;
}

function getLegacyPhotosDirPath(dirName: string = PHOTOS_DIR_NAME): string {
  return `${documentDirectory}${dirName}`;
}

async function ensureLegacyPhotosDir(dirName: string = PHOTOS_DIR_NAME): Promise<string> {
  const dir = getLegacyPhotosDirPath(dirName);
  const info = await getInfoAsync(dir);
  if (!info.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
}

function getFileStem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function normalizeToken(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stemMatchesResidentId(stem: string, residentId: string): boolean {
  const stemToken = normalizeToken(stem);
  const idToken = normalizeToken(residentId);
  if (!stemToken || !idToken) return false;
  // Exact match is ideal, but many real uploads include prefixes/suffixes.
  return stemToken === idToken || stemToken.includes(idToken);
}

/**
 * Download a photo from URL and save to local file system.
 * Returns the local file URI or empty string if failed.
 */
export async function downloadPhoto(residentId: string, photoUrl: string, dirName?: string): Promise<string> {
  if (!photoUrl) return '';

  try {
    const dir = await getPhotosDir(dirName);
    const directUrl = toDirectUrl(photoUrl);
    const ext = getFileExtension(directUrl);
    const fileName = `${residentId}${ext}`;
    const filePath = new File(dir, fileName);

    // Skip if already downloaded
    if (filePath.exists) {
      return filePath.uri;
    }

    // Download
    const output = await File.downloadFileAsync(directUrl, dir, { name: fileName });
    return output.uri;
  } catch (error) {
    console.warn(`Photo download failed for ${residentId}:`, error);
    return '';
  }
}

/**
 * Download all photos for residents that have a photo_url but no local_photo.
 * Returns updated residents with local_photo paths.
 */
export async function downloadAllPhotos<T extends { id: string; photo_url: string; local_photo: string }>(
  residents: T[],
  onProgress?: (done: number, total: number) => void,
  dirName?: string
): Promise<T[]> {
  const total = residents.filter(r => r.photo_url && !r.local_photo).length;
  let done = 0;

  const updated = [...residents];
  for (let i = 0; i < updated.length; i++) {
    const r = updated[i];
    if (r.photo_url && !r.local_photo) {
      const localUri = await downloadPhoto(r.id, r.photo_url, dirName);
      if (localUri) {
        updated[i] = { ...r, local_photo: localUri };
      }
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  return updated;
}

/**
 * Download photos ZIP, extract image files into app-private photos folder,
 * and delete ZIP once extraction completes.
 */
export async function importPhotosFromZip(
  zipUrl: string,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  if (!zipUrl) return 0;

  const directUrl = toDirectUrl(zipUrl);
  const photosDir = await ensureLegacyPhotosDir();
  const zipPath = `${cacheDirectory}photos_sync.zip`;

  try {
    await downloadAsync(directUrl, zipPath);
    const zipBase64 = await readAsStringAsync(zipPath, {
      encoding: EncodingType.Base64,
    });

    const zip = await JSZip.loadAsync(zipBase64, { base64: true });
    const files = Object.values(zip.files).filter((f) => !f.dir && isImageFile(f.name));
    const total = files.length;
    let done = 0;

    for (const f of files) {
      const fileName = f.name.split('/').pop() || f.name;
      const dataBase64 = await f.async('base64');
      await writeAsStringAsync(`${photosDir}/${fileName}`, dataBase64, {
        encoding: EncodingType.Base64,
      });
      done++;
      if (onProgress) onProgress(done, total);
    }

    return total;
  } finally {
    const zipInfo = await getInfoAsync(zipPath);
    if (zipInfo.exists) {
      await deleteAsync(zipPath, { idempotent: true });
    }
  }
}

/**
 * Import photos from a base64-encoded ZIP string (no download needed).
 * Used when the ZIP is served inline by the Apps Script proxy.
 */
export async function importPhotosFromBase64(
  zipBase64: string,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  if (!zipBase64) return 0;

  const photosDir = await ensureLegacyPhotosDir();
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const files = Object.values(zip.files).filter((f) => !f.dir && isImageFile(f.name));
  const total = files.length;
  let done = 0;

  for (const f of files) {
    const fileName = f.name.split('/').pop() || f.name;
    const dataBase64 = await f.async('base64');
    await writeAsStringAsync(`${photosDir}/${fileName}`, dataBase64, {
      encoding: EncodingType.Base64,
    });
    done++;
    if (onProgress) onProgress(done, total);
  }

  return total;
}

/**
 * List files in a Google Drive folder via Apps Script proxy.
 * Returns a map of file stem (without extension, lowercased) → direct download URL.
 */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';

/**
 * Fetch a single face image BY NAME through the Apps Script proxy (get_face)
 * and save it locally. The proxy resolves the file with getFilesByName (an
 * indexed lookup) and streams the bytes server-side as base64 — so the folder
 * stays private AND we never have to list the whole folder to find one face.
 * Returns true on success, false if the face doesn't exist / fetch failed.
 */
const DOWNLOAD_CONCURRENCY = 6;
const MAX_FACE_RETRIES = 3;

/** Run items through worker() with at most `concurrency` in flight. Never rejects. */
async function runPool<T>(items: T[], worker: (item: T, index: number) => Promise<void>, concurrency: number): Promise<void> {
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const runOne = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: n }, () => runOne()));
}

async function downloadFaceByName(folderId: string, name: string, localPath: string): Promise<boolean> {
  const url = `${APPS_SCRIPT_URL}?action=get_face&folderId=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name)}`;
  for (let attempt = 0; attempt < MAX_FACE_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) {
        const base64 = await res.text();
        // The proxy returns raw base64; a JSON body means a definitive
        // "not found"/error — don't retry that.
        if (!base64 || base64.trimStart().startsWith('{')) return false;
        await writeAsStringAsync(localPath, base64, { encoding: EncodingType.Base64 });
        return true;
      }
      // Retry only transient HTTP statuses.
      if (res.status !== 429 && (res.status < 500 || res.status > 599)) return false;
    } catch (_) {
      // network error — fall through to backoff and retry
    }
    if (attempt < MAX_FACE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt) + Math.random() * 300));
    }
  }
  return false;
}

/**
 * Locate a "faces" folder living beside the photos ZIP in Google Drive.
 * Returns the folder id, or null if there is no such folder (caller should
 * then fall back to the ZIP).
 */
export async function getFacesFolderId(): Promise<string | null> {
  try {
    const url = `${APPS_SCRIPT_URL}?action=get_faces`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && data.result?.found && data.result.folderId) {
      return data.result.folderId as string;
    }
    return null;
  } catch (e) {
    console.warn('getFacesFolderId failed:', e);
    return null;
  }
}

/**
 * Download the faces for the given IDs from the Drive "faces" folder.
 * Each face is fetched DIRECTLY BY NAME (`<id>.jpg`) via the get_face proxy —
 * no whole-folder listing — so this is fast even for a folder with thousands of
 * files. Skips faces already on disk unless the ID is in refreshIds.
 */
export async function downloadPhotosFromDriveFolder(
  folderId: string,
  ids: string[],
  onProgress?: (done: number, total: number, status: string) => void,
  dirName?: string,
  refreshIds?: Set<string>
): Promise<number> {
  if (!folderId || ids.length === 0) return 0;

  const photosDir = await ensureLegacyPhotosDir(dirName);
  const total = ids.length;
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let notFound = 0;

  // Download up to DOWNLOAD_CONCURRENCY faces at once (was serial → slow).
  await runPool(ids, async (id) => {
    const localPath = `${photosDir}/${id}.jpg`;
    const info = await getInfoAsync(localPath);
    // Re-download when the photo changed in the sheet (refreshIds), even if a
    // stale copy already exists locally; otherwise skip what we already have.
    const mustRefresh = refreshIds?.has(id.toLowerCase()) ?? false;
    if (!info.exists || mustRefresh) {
      try {
        const ok = await downloadFaceByName(folderId, `${id}.jpg`, localPath);
        if (ok) downloaded++; else notFound++;
      } catch (e) {
        console.warn(`Photo download failed for ${id}:`, e);
        failed++;
      }
    } else {
      skipped++;
    }
    done++;
    if (onProgress) onProgress(done, total, `Photos: ${done}/${total} | ↓${downloaded} ✓${skipped} ✗${failed} ?${notFound}`);
  }, DOWNLOAD_CONCURRENCY);

  return downloaded;
}

// Real compressed faces are ~30–60 KB. The old broken uc?export path saved
// Google's HTML sign-in page (~900 KB) as "<id>.jpg", which renders blank.
// Anything this large is almost certainly a poisoned (non-image) file.
const POISON_SIZE_BYTES = 150 * 1024;

/**
 * Self-heal poisoned face files: delete any locally-stored "image" that is
 * implausibly large (an HTML error page saved as .jpg by the old download
 * path), then re-fetch those IDs cleanly from the faces folder. Returns the
 * number of faces re-downloaded. Cheap when there's nothing to repair.
 */
export async function repairPoisonedFaces(folderId: string, dirName?: string): Promise<number> {
  if (!folderId) return 0;
  const dir = await ensureLegacyPhotosDir(dirName);
  let names: string[];
  try {
    names = await readDirectoryAsync(dir);
  } catch {
    return 0;
  }
  const poisonedIds: string[] = [];
  for (const n of names) {
    if (!isImageFile(n)) continue;
    const info = await getInfoAsync(`${dir}/${n}`);
    if (info.exists && (info.size || 0) > POISON_SIZE_BYTES) {
      poisonedIds.push(getFileStem(n));
      try { await deleteAsync(`${dir}/${n}`, { idempotent: true }); } catch (_) {}
    }
  }
  if (poisonedIds.length === 0) return 0;
  return downloadPhotosFromDriveFolder(folderId, poisonedIds, undefined, dirName);
}

/**
 * Populate local_photo using extracted local files with name = item id.
 * Works for Resident, MaidCook, or any type with id + local_photo.
 */
export async function attachLocalPhotosById<T extends { id: string; local_photo: string }>(items: T[], dirName?: string): Promise<T[]> {
  const updated = [...items];
  const photosDir = await getPhotosDir(dirName);
  const legacyDir = await ensureLegacyPhotosDir(dirName);
  const legacyNames = await readDirectoryAsync(legacyDir);
  const legacyImageNames = legacyNames.filter((n) => isImageFile(n));

  for (let i = 0; i < updated.length; i++) {
    const r = updated[i];
    const idLower = r.id.toLowerCase();

    let foundUri = '';
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
      const candidates = [`${r.id}${ext}`, `${idLower}${ext}`, `${r.id.toUpperCase()}${ext}`];
      for (const name of candidates) {
        const f = new File(photosDir, name);
        if (f.exists) {
          foundUri = f.uri;
          break;
        }
      }
      if (foundUri) break;
    }

    if (foundUri) {
      updated[i] = { ...r, local_photo: foundUri };
      continue;
    }

    // Fallback: match by normalized stem, allowing ids embedded in file names.
    const match = legacyImageNames.find((n) => stemMatchesResidentId(getFileStem(n), r.id));
    if (match) {
      updated[i] = { ...r, local_photo: `${legacyDir}/${match}` };
    }
  }

  return updated;
}

/**
 * Delete a resident's photo from local file system.
 */
export async function deleteLocalPhoto(residentId: string, dirName?: string): Promise<void> {
  try {
    const dir = await getPhotosDir(dirName);
    // Try common extensions
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      const file = new File(dir, `${residentId}${ext}`);
      if (file.exists) {
        file.delete();
        break;
      }
    }
  } catch (_) {}
}

/**
 * Remove local photos that no longer belong to any current item, so the app
 * never keeps "extra" photos (e.g. for residents deleted via the sheet's
 * update/status "D" flag). A file is kept only when its name matches a current
 * id, or it is the file a current item already points at.
 */
export async function pruneOrphanPhotos(
  items: { id: string; local_photo: string }[],
  dirName?: string
): Promise<number> {
  const dir = await ensureLegacyPhotosDir(dirName);
  let names: string[];
  try {
    names = await readDirectoryAsync(dir);
  } catch {
    return 0;
  }

  const validIds = new Set(items.map(i => i.id.toLowerCase()));
  const usedNames = new Set(
    items
      .map(i => (i.local_photo || '').split('/').pop() || '')
      .filter(Boolean)
      .map(n => n.toLowerCase())
  );

  let removed = 0;
  for (const name of names) {
    if (!isImageFile(name)) continue;
    const stem = getFileStem(name).toLowerCase();
    const keep = validIds.has(stem) || usedNames.has(name.toLowerCase());
    if (!keep) {
      try {
        await deleteAsync(`${dir}/${name}`, { idempotent: true });
        removed++;
      } catch (_) {}
    }
  }
  return removed;
}

/**
 * Delete ALL photos from local file system (new + legacy directories).
 */
export async function clearAllPhotos(): Promise<void> {
  try {
    const dir = new Directory(Paths.document, PHOTOS_DIR_NAME);
    if (dir.exists) dir.delete();
  } catch (_) {}
  try {
    const mcDir = new Directory(Paths.document, MAIDCOOK_PHOTOS_DIR_NAME);
    if (mcDir.exists) mcDir.delete();
  } catch (_) {}
  try {
    const legacyDir = getLegacyPhotosDirPath();
    const info = await getInfoAsync(legacyDir);
    if (info.exists) await deleteAsync(legacyDir, { idempotent: true });
  } catch (_) {}
  try {
    const legacyMcDir = getLegacyPhotosDirPath(MAIDCOOK_PHOTOS_DIR_NAME);
    const mcInfo = await getInfoAsync(legacyMcDir);
    if (mcInfo.exists) await deleteAsync(legacyMcDir, { idempotent: true });
  } catch (_) {}
}

/**
 * Check if a resident's validity date has expired.
 */
function isExpired(validity: string): boolean {
  if (!validity) return false;
  if (validity.toUpperCase().includes('BLACK LISTED')) return false;
  const validityDate = parseValidityDate(validity);
  if (!validityDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return validityDate < today;
}

/**
 * Cleanup local photos for expired residents only.
 * Blacklisted residents stay in the database with their photos intact.
 */
export async function cleanupExpiredPhotos(residents: Resident[]): Promise<Resident[]> {
  const updated = [...residents];
  for (let i = 0; i < updated.length; i++) {
    const r = updated[i];
    if (r.local_photo && isExpired(r.validity)) {
      await deleteLocalPhoto(r.id);
      updated[i] = { ...r, local_photo: '' };
    }
  }
  return updated;
}
