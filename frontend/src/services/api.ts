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
  location?: string;
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
  location?: string;
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

export async function uploadVisitorCheckin(data: {
  checkinId?: string;
  visitor: { id: string; name: string; flat: string; phone: string; aadhar: string; purpose: string };
  photoBase64: string;
  idPhotoBase64?: string;
  timestamp: string;
  location?: string;
}): Promise<{ uploaded: boolean; fileName?: string }> {
  const payload: any = {
    action: 'upload_visitor_checkin',
    checkinId: data.checkinId || '',
    visitor: data.visitor,
    photoBase64: data.photoBase64,
    timestamp: data.timestamp,
    location: data.location || '',
  };
  if (data.idPhotoBase64) payload.idPhotoBase64 = data.idPhotoBase64;

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

    if (!res.ok) throw new Error('Visitor upload failed: ' + res.statusText);
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Visitor upload failed');
    return result.result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Upload timed out - check internet connection');
    }
    throw error;
  }
}

// Push maid/cook attendance logs to Google Sheet "maid/cook log" tab
export async function pushMaidCookAttendance(entries: Array<{
  id: string;
  maid_cook_id: string;
  name: string;
  flat: string;
  direction: 'IN' | 'OUT';
  timestamp: string;
  location?: string;
}>): Promise<{ rowsAppended: number }> {
  const payload = {
    action: 'upload_maid_cook_attendance',
    entries,
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
    if (!res.ok) throw new Error('Attendance upload failed: ' + res.statusText);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Attendance upload failed');
    return data.result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Upload timed out');
    throw error;
  }
}

// Push taxi/cab logs to Google Sheet + photo to Drive
export async function pushTaxiLogs(entries: Array<{
  id: string;
  vehicle_number: string;
  vehicle_type?: string;
  flat: string;
  timestamp: string;
  compositeBase64: string;
  location?: string;
}>): Promise<{ rowsAppended: number }> {
  const payload = {
    action: 'upload_taxi_log',
    entries: entries.map(e => ({
      id: e.id,
      vehicle_number: e.vehicle_number,
      vehicle_type: e.vehicle_type || '',
      flat: e.flat,
      timestamp: e.timestamp,
      compositeBase64: e.compositeBase64,
      location: e.location || '',
    })),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error('Taxi log upload failed: ' + res.statusText);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Taxi log upload failed');
    return data.result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Upload timed out');
    throw error;
  }
}

export async function fetchGlobalLogs(syncToken: string): Promise<{
  accessLogs: Array<Record<string, string>>;
  visitorLogs: Array<Record<string, string>>;
  maidCookLogs: Array<Record<string, string>>;
  taxiLogs: Array<Record<string, string>>;
}> {
  const payload = {
    action: 'get_global_logs',
    token: syncToken,
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

    if (!res.ok) throw new Error('Global log fetch failed: ' + res.statusText);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Global log fetch failed');
    return data.result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Global log fetch timed out - check internet connection');
    }
    throw error;
  }
}
