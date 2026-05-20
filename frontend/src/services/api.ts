const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Add timeout to fetch requests
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000) {
  if (!BACKEND_URL) {
    throw new Error('Backend URL not configured. Check .env file.');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - check internet connection');
    }
    throw error;
  }
}

export async function syncResidents() {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/sync`);
  if (!res.ok) throw new Error('Sync failed - ' + res.statusText);
  return res.json();
}

export async function postAccessLog(data: {
  resident_id: string;
  resident_name: string;
  unit: string;
  status: string;
}) {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/access-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to log access');
  return res.json();
}

export async function createResident(data: {
  id?: string;
  name: string;
  unit: string;
  aadhar_masked?: string;
  vehicle_plate?: string;
}) {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/residents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create resident');
  return res.json();
}

export async function deleteResident(id: string) {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/residents/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete resident');
  return res.json();
}

export async function importFromSheet(sheetUrl: string) {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/import-sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_url: sheetUrl }),
  });
  if (!res.ok) throw new Error('Failed to import from sheet');
  return res.json();
}

export async function getSheetUrl(): Promise<string> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/config/sheet-url`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.sheet_url || '';
}

export async function saveSheetUrl(sheetUrl: string) {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/config/sheet-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_url: sheetUrl }),
  });
  if (!res.ok) throw new Error('Failed to save sheet URL');
  return res.json();
}

// Push access logs to Google Drive via Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';
const LOGS_FOLDER_ID = '1HYUCLO1VmuA20XgQKGqxuBofg0YwvDkZ';

export async function pushLogsToGoogleDrive(logs: Array<{
  id: string;
  resident_id: string;
  resident_name: string;
  unit: string;
  timestamp: string;
  status: string;
}>): Promise<{ fileName: string; rowCount: number }> {
  const payload = {
    action: 'upload_logs',
    folderId: LOGS_FOLDER_ID,
    logs: logs,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('Upload failed: ' + res.statusText);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Upload failed');
    return data.result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Upload timed out - check internet connection');
    }
    throw error;
  }
}
