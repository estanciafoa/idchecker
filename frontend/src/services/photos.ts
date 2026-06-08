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

async function listDriveFolderFiles(folderId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const url = `${APPS_SCRIPT_URL}?action=list_photos&folderId=${encodeURIComponent(folderId)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Apps Script error: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list photos');
  for (const f of data.result?.files || []) {
    if (isImageFile(f.name)) {
      const stem = getFileStem(f.name).toLowerCase();
      map.set(stem, `https://drive.google.com/uc?export=download&id=${f.id}`);
    }
  }
  return map;
}

/**
 * Download only the photos needed for the given IDs from a Google Drive folder.
 * Skips photos that already exist locally.
 */
export async function downloadPhotosFromDriveFolder(
  folderId: string,
  ids: string[],
  onProgress?: (done: number, total: number, status: string) => void
): Promise<number> {
  if (!folderId || ids.length === 0) return 0;

  if (onProgress) onProgress(0, ids.length, 'Listing photos in Drive folder...');
  const driveFiles = await listDriveFolderFiles(folderId);
  if (onProgress) onProgress(0, ids.length, `Found ${driveFiles.size} photos in folder`);

  const photosDir = await ensureLegacyPhotosDir();
  const total = ids.length;
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let notFound = 0;

  for (const id of ids) {
    const driveUrl = driveFiles.get(id.toLowerCase());
    if (driveUrl) {
      const localPath = `${photosDir}/${id}.jpg`;
      const info = await getInfoAsync(localPath);
      if (!info.exists) {
        try {
          await downloadAsync(driveUrl, localPath);
          downloaded++;
        } catch (e) {
          console.warn(`Photo download failed for ${id}:`, e);
          failed++;
        }
      } else {
        skipped++;
      }
    } else {
      notFound++;
    }
    done++;
    if (onProgress) onProgress(done, total, `Photos: ${done}/${total} | ↓${downloaded} ✓${skipped} ✗${failed} ?${notFound}`);
  }

  return downloaded;
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
export async function deleteLocalPhoto(residentId: string): Promise<void> {
  try {
    const dir = await getPhotosDir();
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
