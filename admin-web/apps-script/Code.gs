const REQUIRED_HEADERS = [
  'Name',
  'flat number',
  'Valid From',
  'ValidTill',
  'Aadhar/SRMID',
  'Moblie',
  'ID'
];

const DEFAULT_SPREADSHEET_ID = '1EDvYjDQVIpwib5PmQ5sbSchJI_B5HNHWNomXRLOxtk4';
const DEFAULT_ZIP_FILE_ID = '1De7JzvhoEHfsrVJzKojcQu_QgHq4tRUE';
const CAB_ENTRIES_FILE_ID = '1OkfSR2HYh2bg6t9HYIdOB-zsnD_EB4cz';

// Separate Drive folders for each log category
const FOLDER_STUDENTS = '12U_VPBkpatzeIaqKJ4wdZHf3-2GPHQgl';
const FOLDER_MAIDCOOK = '1T4es3-liT2hptht5Cmw97TjK6VLbXCgI';
const FOLDER_TAXIS    = '1bn6eM4iRsy98J9u08U6jIzbK3DoQQeNw';
const FOLDER_VISITORS = '1BZFQxiOvo1Xb6mTl_wc5meEKLtngsAY7';

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'status') {
      var statusResponse = getRequestStatusResponseObject_(e.parameter.requestId);
      if (e.parameter.callback) {
        return jsonpResponse_(e.parameter.callback, statusResponse);
      }
      return jsonResponse_(statusResponse.ok, statusResponse.result, statusResponse.error);
    }

    // Serve sheet CSV (proxy for private sheet)
    if (e && e.parameter && e.parameter.action === 'get_csv') {
      validateToken_(e.parameter.token);
      var ssId = e.parameter.ssId || DEFAULT_SPREADSHEET_ID;
      var ss = SpreadsheetApp.openById(ssId);
      var targetSheet;
      if (e.parameter.gid) {
        var gid = Number(e.parameter.gid);
        var sheets = ss.getSheets();
        for (var i = 0; i < sheets.length; i++) {
          if (sheets[i].getSheetId() === gid) { targetSheet = sheets[i]; break; }
        }
        if (!targetSheet) return jsonResponse_(false, null, 'Sheet with gid ' + gid + ' not found');
      } else {
        var sheetName = e.parameter.sheet || 'student id';
        targetSheet = ss.getSheetByName(sheetName);
        if (!targetSheet) return jsonResponse_(false, null, 'Sheet "' + sheetName + '" not found');
      }
      var csvText = sheetToCsv_(targetSheet);
      return ContentService.createTextOutput(csvText).setMimeType(ContentService.MimeType.CSV);
    }

    // Serve ZIP file content as base64 (proxy for private Drive file)
    if (e && e.parameter && e.parameter.action === 'get_zip') {
      validateToken_(e.parameter.token);
      var fileId = e.parameter.fileId || DEFAULT_ZIP_FILE_ID;
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var base64 = Utilities.base64Encode(blob.getBytes());
      return ContentService.createTextOutput(base64).setMimeType(ContentService.MimeType.TEXT);
    }

    // Return a short-lived OAuth token so the browser can initiate
    // a resumable Drive upload directly (CORS works for browser-initiated uploads).
    if (e && e.parameter && e.parameter.action === 'get_upload_url') {
      validateToken_(e.parameter.token);
      var fileId = e.parameter.fileId || DEFAULT_ZIP_FILE_ID;
      var oauthToken = ScriptApp.getOAuthToken();
      var uploadResult = {
        ok: true,
        result: { accessToken: oauthToken, fileId: fileId },
        error: null
      };
      if (e.parameter.callback) {
        return jsonpResponse_(e.parameter.callback, uploadResult);
      }
      return jsonResponse_(true, uploadResult.result, null);
    }

    if (e && e.parameter && e.parameter.action === 'list_photos') {
      var folderId = e.parameter.folderId;
      var source = e.parameter.source || 'folder'; // 'folder' or 'zip'
      if (source === 'zip') {
        var fileId = e.parameter.fileId;
        if (!fileId) return jsonResponse_(false, null, 'Missing fileId parameter for zip source');
        var zipPhotos = listPhotosInZip_(fileId);
        return jsonResponse_(true, zipPhotos, null);
      } else {
        if (!folderId) return jsonResponse_(false, null, 'Missing folderId parameter');
        var photoList = listPhotosInFolder_(folderId);
        return jsonResponse_(true, photoList, null);
      }
    }

    // Locate a "faces" subfolder living beside the photos ZIP, so the app can
    // download individual photos instead of the whole ZIP.
    if (e && e.parameter && e.parameter.action === 'get_faces') {
      var zipFileId = e.parameter.fileId || DEFAULT_ZIP_FILE_ID;
      var facesResult = findFacesFolderBesideFile_(zipFileId);
      if (e.parameter.callback) {
        return jsonpResponse_(e.parameter.callback, { ok: true, result: facesResult, error: null });
      }
      return jsonResponse_(true, facesResult, null);
    }

    // Return per-student update flags so the admin can upload/delete only the
    // faces that changed. Flag comes from an "update" or "status" column.
    if (e && e.parameter && e.parameter.action === 'get_student_flags') {
      validateToken_(e.parameter.token);
      var flagSsId = e.parameter.ssId || DEFAULT_SPREADSHEET_ID;
      var flagResult = getStudentFlags_(flagSsId, e.parameter.gid);
      if (e.parameter.callback) {
        return jsonpResponse_(e.parameter.callback, { ok: true, result: flagResult, error: null });
      }
      return jsonResponse_(true, flagResult, null);
    }

    return jsonResponse_(true, {
      service: 'idchecker-admin-uploader',
      status: 'ok',
      message: 'Web app is reachable. Use POST to upload rows and photos ZIP.',
      method: 'GET',
      version: 'v1'
    }, null);
  } catch (err) {
    return jsonResponse_(false, null, err && err.message ? err.message : String(err));
  }
}

function doPost(e) {
  var requestId = null;
  try {
    if (!e) {
      return jsonResponse_(false, null, 'Missing request payload');
    }

    const payload = parsePayload_(e);
    requestId = String(payload.requestId || '').trim() || null;

    // Handle CSV fetch via POST (token in body instead of URL)
    if (payload.action === 'get_csv') {
      validateToken_(payload.token);
      var ssId = payload.ssId || DEFAULT_SPREADSHEET_ID;
      var ss = SpreadsheetApp.openById(ssId);
      var targetSheet;
      var rawGid = payload.gid || (e.parameter && e.parameter.gid);
      if (rawGid) {
        var gid = Number(rawGid);
        var sheets = ss.getSheets();
        for (var i = 0; i < sheets.length; i++) {
          if (sheets[i].getSheetId() === gid) { targetSheet = sheets[i]; break; }
        }
        if (!targetSheet) return jsonResponse_(false, null, 'Sheet with gid ' + gid + ' not found');
      } else {
        var sheetName = payload.sheet || (e.parameter && e.parameter.sheet) || 'student id';
        targetSheet = ss.getSheetByName(sheetName);
        if (!targetSheet) return jsonResponse_(false, null, 'Sheet "' + sheetName + '" not found');
      }
      var csvText = sheetToCsv_(targetSheet);
      return ContentService.createTextOutput(csvText).setMimeType(ContentService.MimeType.CSV);
    }

    // Handle log upload action (no token/sheetName validation needed for logs)
    if (payload.action === 'upload_logs') {
      var logResult = uploadLogsToDrive_(payload);
      return jsonResponse_(true, logResult, null);
    }

    // Handle visitor check-in upload (photo + info)
    if (payload.action === 'upload_visitor_checkin') {
      var visitorResult = uploadVisitorCheckin_(payload);
      return jsonResponse_(true, visitorResult, null);
    }

    // Handle maid/cook attendance log upload
    if (payload.action === 'upload_maid_cook_attendance') {
      var attResult = uploadMaidCookAttendance_(payload);
      return jsonResponse_(true, attResult, null);
    }

    // Handle taxi/cab log upload
    if (payload.action === 'upload_taxi_log') {
      var taxiResult = uploadTaxiLog_(payload);
      return jsonResponse_(true, taxiResult, null);
    }

    // Handle consolidated global log fetch for EM Office
    if (payload.action === 'get_global_logs') {
      validateToken_(payload.token);
      var logsResult = getGlobalLogs_();
      return jsonResponse_(true, logsResult, null);
    }

    validatePayload_(payload);
    validateToken_(payload.token);

    let rowResult = { appended: 0, updated: 0, total: 0 };
    const hasRows = Array.isArray(payload.rows) && payload.rows.length > 0;
    if (hasRows) {
      rowResult = appendRows_(
        payload.spreadsheetId || DEFAULT_SPREADSHEET_ID,
        payload.sheetName,
        payload.rows
      );
    }

    let zipUpdated = false;
    if (payload.zipBase64 && payload.driveZipFileId) {
      replaceZipInDrive_(
        payload.driveZipFileId,
        payload.zipBase64
      );
      zipUpdated = true;
    }

    if (requestId) {
      saveRequestStatus_(requestId, {
        ok: true,
        rowsAppended: rowResult.appended,
        rowsUpdated: rowResult.updated,
        rowsTotal: rowResult.total,
        zipUpdated: zipUpdated,
        error: null
      });
    }

    return jsonResponse_(true, {
      rowsAppended: rowResult.appended,
      rowsUpdated: rowResult.updated,
      rowsTotal: rowResult.total,
      zipUpdated: zipUpdated
    }, null);
  } catch (err) {
    if (requestId) {
      saveRequestStatus_(requestId, {
        ok: false,
        rowsAppended: 0,
        zipUpdated: false,
        error: err && err.message ? err.message : String(err)
      });
    }
    return jsonResponse_(false, null, err && err.message ? err.message : String(err));
  }
}

/**
 * List image files in a Google Drive folder.
 * Returns { files: [ { name: "2627.jpg", id: "FILE_ID" }, ... ] }
 */
/**
 * Find a subfolder named "faces" inside the same parent folder as the given
 * file (the photos ZIP). The match is case-insensitive.
 * Returns { found: Boolean, folderId: String|null }.
 */
function findFacesFolderBesideFile_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var parents = file.getParents();
  while (parents.hasNext()) {
    var parent = parents.next();
    var subFolders = parent.getFolders();
    while (subFolders.hasNext()) {
      var sub = subFolders.next();
      if (String(sub.getName()).trim().toLowerCase() === 'faces') {
        return { found: true, folderId: sub.getId() };
      }
    }
  }
  return { found: false, folderId: null };
}

/**
 * Read the student sheet and return the per-row update flag, so the admin can
 * upload/delete only the faces that changed.
 * Flag is read from a column named "update" or "status" (case-insensitive) and
 * lower-cased. Returns { rows: [ { id: "2627", flag: "n" }, ... ] }.
 */
function getStudentFlags_(ssId, gid) {
  var ss = SpreadsheetApp.openById(ssId || DEFAULT_SPREADSHEET_ID);
  var sheet;
  if (gid) {
    var gidNum = Number(gid);
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === gidNum) { sheet = sheets[i]; break; }
    }
  }
  if (!sheet) sheet = ss.getSheetByName('student id') || ss.getSheets()[0];

  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return { rows: [] };

  var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var idCol = header.indexOf('id');
  var flagCol = -1;
  for (var c = 0; c < header.length; c++) {
    if (header[c] === 'update' || header[c] === 'status') { flagCol = c; break; }
  }
  if (idCol < 0) return { rows: [] };

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][idCol] || '').trim();
    if (!id) continue;
    var flag = flagCol >= 0 ? String(values[r][flagCol] || '').trim().toLowerCase() : '';
    rows.push({ id: id, flag: flag });
  }
  return { rows: rows };
}

function listPhotosInFolder_(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var result = [];
  var imageExts = /\.(jpg|jpeg|png|webp|gif)$/i;
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    if (imageExts.test(name)) {
      result.push({ name: name, id: f.getId() });
    }
  }
  return { files: result, source: 'folder' };
}

/**
 * List image files inside a ZIP stored in Google Drive.
 * Returns { files: [ { name: "2627.jpg" }, ... ], zipFileId: "..." }
 * Also returns zipDownloadUrl for direct download of the full ZIP.
 */
function listPhotosInZip_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var zip = Utilities.unzip(blob);
  var result = [];
  var imageExts = /\.(jpg|jpeg|png|webp|gif)$/i;
  for (var i = 0; i < zip.length; i++) {
    var name = zip[i].getName();
    // Strip folder prefix if any (e.g. "photos/2627.jpg" → "2627.jpg")
    var baseName = name.split('/').pop() || name;
    if (imageExts.test(baseName)) {
      result.push({ name: baseName });
    }
  }
  return {
    files: result,
    source: 'zip',
    zipFileId: fileId,
    zipDownloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId
  };
}

function getRequestStatusResponseObject_(requestId) {
  if (!requestId) {
    return {
      ok: false,
      result: null,
      error: 'requestId is required'
    };
  }

  var key = 'REQ_' + requestId;
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) {
    return {
      ok: true,
      result: {
        found: false,
        requestId: requestId
      },
      error: null
    };
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      result: null,
      error: 'Corrupted request status for ' + requestId
    };
  }

  return {
    ok: true,
    result: {
      found: true,
      requestId: requestId,
      status: parsed
    },
    error: null
  };
}

function saveRequestStatus_(requestId, status) {
  var key = 'REQ_' + requestId;
  var payload = {
    ok: !!status.ok,
    rowsAppended: Number(status.rowsAppended || 0),
    zipUpdated: !!status.zipUpdated,
    error: status.error || null,
    ts: new Date().toISOString()
  };

  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(payload));
}

function parsePayload_(e) {
  // Preferred: simple form post with `payload=<json>` to avoid browser preflight.
  if (e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  // Backward compatible: raw JSON body.
  if (e.postData && e.postData.contents) {
    var raw = e.postData.contents;

    // Handle form-encoded body when Apps Script does not populate e.parameter.
    // Example: payload=%7B%22rows%22%3A...%7D
    if (typeof raw === 'string' && raw.indexOf('payload=') === 0) {
      var encoded = raw.split('&').filter(function (part) {
        return part.indexOf('payload=') === 0;
      }).map(function (part) {
        return part.substring('payload='.length);
      })[0] || '';

      var decoded = decodeURIComponent(encoded.replace(/\+/g, ' '));
      return JSON.parse(decoded);
    }

    return JSON.parse(raw);
  }

  throw new Error('Missing payload body');
}

function validatePayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid JSON payload');
  }
  if (!payload.sheetName) {
    throw new Error('sheetName is required');
  }
  const hasRows = Array.isArray(payload.rows) && payload.rows.length > 0;
  const hasZip = !!payload.zipBase64 && !!payload.driveZipFileId;
  if (!hasRows && !hasZip) {
    throw new Error('rows or zipBase64 must be provided');
  }
}

function validateToken_(providedToken) {
  var expectedToken = 'Admin2026';
  if (!providedToken || providedToken !== expectedToken) {
    throw new Error('Invalid upload token');
  }
}

/**
 * Convert a sheet tab to CSV text.
 */
function sheetToCsv_(sheet) {
  var data = sheet.getDataRange().getValues();
  var csv = data.map(function(row) {
    return row.map(function(cell) {
      var val = cell instanceof Date
        ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(cell);
      if (val.indexOf(',') >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',');
  }).join('\n');
  return csv;
}

function appendRows_(spreadsheetId, sheetName, rows) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
  }

  const values = rows.map(function (row) {
    return REQUIRED_HEADERS.map(function (h) {
      return row[h] !== undefined && row[h] !== null ? String(row[h]).trim() : '';
    });
  }).filter(function (arr) {
    const id = arr[REQUIRED_HEADERS.indexOf('ID')];
    const name = arr[REQUIRED_HEADERS.indexOf('Name')];
    return id || name;
  });

  if (!values.length) {
    throw new Error('No valid rows to append');
  }

  // Build a map of existing IDs to their row numbers
  const idColIndex = REQUIRED_HEADERS.indexOf('ID');
  const lastRow = sheet.getLastRow();
  var existingIdMap = {};

  if (lastRow > 1) {
    const existingData = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();
    for (var r = 0; r < existingData.length; r++) {
      var existingId = String(existingData[r][idColIndex]).trim();
      if (existingId) {
        existingIdMap[existingId] = r + 2; // row number (1-based, skip header)
      }
    }
  }

  var updated = 0;
  var appended = 0;
  var toAppend = [];

  values.forEach(function (rowArr) {
    var rowId = String(rowArr[idColIndex]).trim();
    if (rowId && existingIdMap[rowId]) {
      // Update existing row
      sheet.getRange(existingIdMap[rowId], 1, 1, REQUIRED_HEADERS.length).setValues([rowArr]);
      updated++;
    } else {
      toAppend.push(rowArr);
    }
  });

  if (toAppend.length) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, REQUIRED_HEADERS.length).setValues(toAppend);
    appended = toAppend.length;
  }

  return { updated: updated, appended: appended, total: values.length };
}

/**
 * Replace the ZIP file on Google Drive with new ZIP bytes.
 */
function replaceZipInDrive_(fileId, zipBase64) {
  var bytes = Utilities.base64Decode(zipBase64);
  var token = ScriptApp.getOAuthToken();
  var url = 'https://www.googleapis.com/upload/drive/v3/files/' +
    encodeURIComponent(fileId) + '?uploadType=media';

  var response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    contentType: 'application/zip',
    payload: bytes,
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      'Drive update failed (' + code + '): ' +
      response.getContentText().substring(0, 300)
    );
  }
}

function jsonResponse_(ok, result, error) {
  const body = {
    ok: ok,
    result: result || null,
    error: error || null,
    ts: new Date().toISOString()
  };

  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Format incoming timestamp text/date into IST for CSV output.
 * Expected output example: 2026-06-09 17:16:33 IST
 */
function toIstTimestamp_(value) {
  if (!value) {
    return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss') + ' IST';
  }

  var dateObj = null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    dateObj = value;
  } else {
    dateObj = new Date(String(value));
  }

  if (isNaN(dateObj.getTime())) {
    return String(value);
  }

  return Utilities.formatDate(dateObj, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss') + ' IST';
}

function getGlobalLogs_() {
  var taxiLogsFromFile = augmentTaxiLogsWithPhotoUrls_(readTaxiLogsFromCabEntriesFile_(), buildDrivePhotoUrlMap_(FOLDER_TAXIS));
  var taxiLogsFromFolder = readLogsFromCsvFolder_(FOLDER_TAXIS, 'taxi_logs.csv', function (row) {
    return {
      id: row['Log ID'] || '',
      vehicle_type: row['Vehicle Type'] || '',
      vehicle_number: row['Vehicle Number'] || '',
      flat: row['Flat'] || '',
      photo_file: row['Photo File'] || '',
      timestamp: row['Timestamp'] || '',
      location: row['Location'] || ''
    };
  });

  return {
    accessLogs: readLogsFromCsvFolder_(FOLDER_STUDENTS, 'access_logs.csv', function (row) {
      return {
        id: row['Log ID'] || '',
        resident_id: row['Resident ID'] || '',
        resident_name: row['Resident Name'] || '',
        unit: row['Unit'] || '',
        timestamp: row['Timestamp'] || '',
        status: row['Status'] || '',
        location: row['Location'] || ''
      };
    }),
    visitorLogs: readLogsFromCsvFolder_(FOLDER_VISITORS, 'visitor_logs.csv', function (row) {
      return {
        id: row['Visitor ID'] || row['Timestamp'] || '',
        visitor_id: row['Visitor ID'] || '',
        name: row['Name'] || '',
        flat: row['Flat'] || '',
        phone: row['Phone'] || '',
        aadhar: row['Aadhar'] || '',
        purpose: row['Purpose'] || '',
        photo_file: row['Photo File'] || '',
        timestamp: row['Timestamp'] || '',
        location: row['Location'] || ''
      };
    }),
    maidCookLogs: readLogsFromCsvFolder_(FOLDER_MAIDCOOK, 'maidcook_logs.csv', function (row) {
      return {
        id: row['Log ID'] || '',
        maid_cook_id: row['Maid/Cook ID'] || '',
        name: row['Name'] || '',
        flat: row['Flat'] || '',
        direction: row['Direction'] || '',
        timestamp: row['Timestamp'] || '',
        location: row['Location'] || ''
      };
    }),
    taxiLogs: mergeLogLists_(taxiLogsFromFile, taxiLogsFromFolder),
    fetchedAt: new Date().toISOString()
  };
}

function buildDrivePhotoUrlMap_(folderId) {
  var map = {};
  try {
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var name = String(file.getName() || '').trim();
      if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(name)) continue;
      var url = 'https://drive.google.com/uc?export=download&id=' + file.getId();
      map[name.toLowerCase()] = url;
      map[name.replace(/\.[^.]+$/, '').toLowerCase()] = url;
    }
  } catch (err) {}
  return map;
}

function augmentTaxiLogsWithPhotoUrls_(logs, photoUrlMap) {
  return (logs || []).map(function (log) {
    var photoFile = String(log.photo_file || '').trim();
    var photoUrl = '';
    if (photoFile) {
      var key = photoFile.toLowerCase();
      photoUrl = photoUrlMap[key] || photoUrlMap[photoFile.replace(/\.[^.]+$/, '').toLowerCase()] || '';
    }
    return Object.assign({}, log, { photo_url: photoUrl });
  });
}

function readTaxiLogsFromCabEntriesFile_() {
  if (!CAB_ENTRIES_FILE_ID) return [];
  try {
    var file = DriveApp.getFileById(CAB_ENTRIES_FILE_ID);
    var mimeType = file.getMimeType();

    // Google Sheet source: export the first sheet as rows.
    if (mimeType === MimeType.GOOGLE_SHEETS) {
      var ss = SpreadsheetApp.openById(CAB_ENTRIES_FILE_ID);
      var sheet = ss.getSheets()[0];
      if (!sheet) return [];
      var data = sheet.getDataRange().getValues();
      if (!data || data.length < 2) return [];
      var headers = data[0].map(function (h) { return String(h || '').trim(); });
      var rows = [];
      for (var i = 1; i < data.length; i++) {
        var row = {};
        for (var c = 0; c < headers.length; c++) {
          row[headers[c]] = data[i][c] !== null && data[i][c] !== undefined ? String(data[i][c]) : '';
        }
        rows.push({
          id: row['Log ID'] || row['ID'] || row['id'] || '',
          vehicle_type: row['Vehicle Type'] || row['vehicle_type'] || row['Type'] || 'taxi',
          vehicle_number: row['Vehicle Number'] || row['vehicle_number'] || row['Number'] || '',
          flat: row['Flat'] || row['flat'] || '',
          photo_file: row['Photo File'] || row['photo_file'] || '',
          timestamp: row['Timestamp'] || row['timestamp'] || '',
          location: row['Location'] || row['location'] || ''
        });
      }
      return rows;
    }

    // Text/CSV source: parse the blob content.
    var content = file.getBlob().getDataAsString();
    if (!content) return [];
    var lines = content.split('\n');
    if (lines.length < 2) return [];
    var headersCsv = parseCsvLine_(lines[0]).map(function (h) { return h.replace(/^"|"$/g, ''); });
    var items = [];
    for (var li = 1; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      var cols = parseCsvLine_(line);
      var row = {};
      for (var c = 0; c < headersCsv.length; c++) {
        row[headersCsv[c]] = (cols[c] || '').replace(/^"|"$/g, '');
      }
      items.push({
        id: row['Log ID'] || row['ID'] || '',
        vehicle_type: row['Vehicle Type'] || 'taxi',
        vehicle_number: row['Vehicle Number'] || '',
        flat: row['Flat'] || '',
        photo_file: row['Photo File'] || '',
        timestamp: row['Timestamp'] || '',
        location: row['Location'] || ''
      });
    }
    return items;
  } catch (err) {
    return [];
  }
}

function mergeLogLists_(primary, fallback) {
  var seen = {};
  var merged = [];
  var lists = [primary || [], fallback || []];
  for (var i = 0; i < lists.length; i++) {
    for (var j = 0; j < lists[i].length; j++) {
      var item = lists[i][j];
      var key = String(item.id || item.timestamp || item.vehicle_number || '').trim();
      if (!key || seen[key]) continue;
      seen[key] = true;
      merged.push(item);
    }
  }
  return merged;
}

function readLogsFromCsvFolder_(folderId, fileName, mapRow) {
  var folder = DriveApp.getFolderById(folderId);
  var files = getOrderedCsvFiles_(folder, fileName);
  var items = [];

  for (var i = 0; i < files.length; i++) {
    var content = files[i].file.getBlob().getDataAsString();
    if (!content) continue;
    var lines = content.split('\n');
    if (lines.length <= 1) continue;

    var headers = parseCsvLine_(lines[0]).map(function (h) { return h.replace(/^"|"$/g, ''); });
    for (var li = 1; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      var cols = parseCsvLine_(line);
      var row = {};
      for (var c = 0; c < headers.length; c++) {
        row[headers[c]] = (cols[c] || '').replace(/^"|"$/g, '');
      }
      items.push(mapRow(row));
    }
  }

  return items;
}

function getOrderedCsvFiles_(folder, fileName) {
  var dotIdx = fileName.lastIndexOf('.');
  var baseName = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;
  var ext = dotIdx > 0 ? fileName.substring(dotIdx) : '.csv';
  var allFiles = [];
  var iter = folder.getFiles();
  while (iter.hasNext()) {
    var f = iter.next();
    var fname = f.getName();
    if (fname === baseName + ext || fname.match(new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)' + ext.replace(/[.]/g, '\\.') + '$'))) {
      var num = 1;
      var m = fname.match(new RegExp('_(\\d+)' + ext.replace(/[.]/g, '\\.') + '$'));
      if (m) num = parseInt(m[1], 10);
      allFiles.push({ file: f, num: num, name: fname });
    }
  }
  allFiles.sort(function(a, b) { return a.num - b.num; });
  return allFiles;
}

// ---- LOG UPLOAD (Access / Student logs) ----
function uploadLogsToDrive_(payload) {
  if (!payload.logs || !Array.isArray(payload.logs) || payload.logs.length === 0) {
    throw new Error('logs array is required and must not be empty');
  }

  var headers = ['Timestamp', 'Resident ID', 'Resident Name', 'Unit', 'Status', 'Location', 'Log ID'];
  var rows = payload.logs.map(function(log) {
    return [
      toIstTimestamp_(log.timestamp),
      log.resident_id || '',
      log.resident_name || '',
      log.unit || '',
      log.status || '',
      log.location || '',
      log.id || ''
    ];
  });

  // logIdCol = 6 (0-based index of 'Log ID' column) for dedup
  var appended = appendToCsvFile_(FOLDER_STUDENTS, 'access_logs.csv', headers, rows, 6);

  return { fileName: 'access_logs.csv', rowCount: appended };
}

// ---- VISITOR CHECK-IN ----
function uploadVisitorCheckin_(payload) {
  var visitor = payload.visitor;
  if (!visitor || !visitor.id) {
    throw new Error('visitor object with id is required');
  }
  var timestamp = payload.timestamp || new Date().toISOString();
  var istTimestamp = toIstTimestamp_(timestamp);

  var folder = DriveApp.getFolderById(FOLDER_VISITORS);

  var photoFileName = '';
  // Save photo to Drive
  if (payload.photoBase64) {
    var safeName = 'visitor_' + String(visitor.id).replace(/[^A-Za-z0-9_-]/g, '') +
      '_' + timestamp.replace(/[:.]/g, '-') + '.jpg';
    var bytes = Utilities.base64Decode(payload.photoBase64);
    var blob = Utilities.newBlob(bytes, 'image/jpeg', safeName);
    folder.createFile(blob);
    photoFileName = safeName;
  }

  // Append to visitor_log sheet
  var ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  var sheet = ss.getSheetByName('visitor_log');
  if (!sheet) {
    sheet = ss.insertSheet('visitor_log');
    sheet.getRange(1, 1, 1, 9).setValues([
      ['Timestamp', 'Visitor ID', 'Name', 'Flat', 'Phone', 'Aadhar', 'Purpose', 'Photo File', 'Location']
    ]);
  }
  sheet.appendRow([
    istTimestamp,
    visitor.id || '',
    visitor.name || '',
    visitor.flat || '',
    visitor.phone || '',
    visitor.aadhar || '',
    visitor.purpose || '',
    photoFileName || '',
    payload.location || ''
  ]);

  // Append to persistent CSV
  var csvHeaders = ['Timestamp', 'Visitor ID', 'Name', 'Flat', 'Phone', 'Aadhar', 'Purpose', 'Photo File', 'Location'];
  var csvRow = [[
    istTimestamp,
    visitor.id || '',
    visitor.name || '',
    visitor.flat || '',
    visitor.phone || '',
    visitor.aadhar || '',
    visitor.purpose || '',
    photoFileName,
    payload.location || ''
  ]];
  appendToCsvFile_(FOLDER_VISITORS, 'visitor_logs.csv', csvHeaders, csvRow, -1);

  return { uploaded: true, fileName: photoFileName };
}

// ---- MAID/COOK ATTENDANCE LOG ----
function uploadMaidCookAttendance_(payload) {
  var entries = payload.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('entries array is required');
  }

  var ss = SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
  var sheet = ss.getSheetByName('maid_cook_log');
  if (!sheet) {
    sheet = ss.insertSheet('maid_cook_log');
    sheet.getRange(1, 1, 1, 7).setValues([
      ['Timestamp', 'Maid/Cook ID', 'Name', 'Flat', 'Direction', 'Log ID', 'Location']
    ]);
  }

  // Read existing Log IDs to avoid duplicates
  var lastRow = sheet.getLastRow();
  var existingIds = {};
  if (lastRow > 1) {
    var logIdCol = 6; // column F
    var ids = sheet.getRange(2, logIdCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0]) existingIds[String(ids[i][0])] = true;
    }
  }

  var appended = 0;
  var csvRows = [];
  for (var j = 0; j < entries.length; j++) {
    var e = entries[j];
    var logId = e.id || '';
    if (logId && existingIds[String(logId)]) continue; // skip duplicate
    var entryTimestamp = toIstTimestamp_(e.timestamp || new Date().toISOString());
    sheet.appendRow([
      entryTimestamp,
      e.maid_cook_id || '',
      e.name || '',
      e.flat || '',
      e.direction || '',
      logId,
      e.location || ''
    ]);
    csvRows.push([
      entryTimestamp,
      e.maid_cook_id || '',
      e.name || '',
      e.flat || '',
      e.direction || '',
      logId,
      e.location || ''
    ]);
    appended++;
  }

  // Append to persistent CSV (logIdCol = 5 for dedup)
  if (csvRows.length > 0) {
    var csvHeaders = ['Timestamp', 'Maid/Cook ID', 'Name', 'Flat', 'Direction', 'Log ID', 'Location'];
    appendToCsvFile_(FOLDER_MAIDCOOK, 'maidcook_logs.csv', csvHeaders, csvRows, 5);
  }

  return { rowsAppended: appended };
}

// ---- TAXI/CAB LOG ----
function uploadTaxiLog_(payload) {
  var entries = payload.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('entries array is required');
  }

  var folder = DriveApp.getFolderById(FOLDER_TAXIS);

  var appended = 0;
  var csvRows = [];
  for (var j = 0; j < entries.length; j++) {
    var e = entries[j];
    var logId = e.id || '';

    // Save composite photo to Drive (dedup by logId — skip if file already exists)
    var photoFileName = '';
    if (e.compositeBase64) {
      var safeId = String(logId).replace(/[^A-Za-z0-9_-]/g, '');
      var safeName = 'taxi_' + safeId +
        '_' + (e.timestamp || '').replace(/[:.]/g, '-') + '.jpg';
      // Check if a file for this logId already exists (any timestamp)
      var existing = folder.searchFiles("title contains 'taxi_" + safeId + "_'");
      if (existing.hasNext()) {
        // Already uploaded — reuse existing filename, skip upload
        photoFileName = existing.next().getName();
      } else {
        var bytes = Utilities.base64Decode(e.compositeBase64);
        var blob = Utilities.newBlob(bytes, 'image/jpeg', safeName);
        folder.createFile(blob);
        photoFileName = safeName;
      }
    }

    csvRows.push([
      toIstTimestamp_(e.timestamp || new Date().toISOString()),
      e.vehicle_type || '',
      e.vehicle_number || '',
      e.flat || '',
      logId,
      photoFileName,
      e.location || ''
    ]);
    appended++;
  }

  // Append to persistent CSV (logIdCol = 4 for dedup)
  if (csvRows.length > 0) {
    var csvHeaders = ['Timestamp', 'Vehicle Type', 'Vehicle Number', 'Flat', 'Log ID', 'Photo File', 'Location'];
    appendToCsvFile_(FOLDER_TAXIS, 'taxi_logs.csv', csvHeaders, csvRows, 4);
  }

  return { rowsAppended: appended };
}

/**
 * Append rows to a persistent CSV file in a Drive folder.
 * If the file doesn't exist, it is created with headers.
 * If it exists, new rows are appended (duplicates skipped by logId column).
 * After 10000 data rows, a new numbered file is created (e.g. access_logs_2.csv).
 *
 * @param {string} folderId  - Google Drive folder ID
 * @param {string} fileName  - e.g. "access_logs.csv"
 * @param {string[]} headers - column headers
 * @param {string[][]} rows  - array of row arrays (same order as headers)
 * @param {number} logIdCol  - 0-based index of the log-ID column for dedup (-1 to skip dedup)
 * @returns {number} number of rows actually appended
 */
function appendToCsvFile_(folderId, fileName, headers, rows, logIdCol) {
  var MAX_ROWS = 10000;
  var folder = DriveApp.getFolderById(folderId);

  // Derive base name and extension: "access_logs.csv" → base="access_logs", ext=".csv"
  var dotIdx = fileName.lastIndexOf('.');
  var baseName = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;
  var ext = dotIdx > 0 ? fileName.substring(dotIdx) : '.csv';

  // Find all numbered CSV files for this base name
  // Pattern: baseName.csv, baseName_2.csv, baseName_3.csv, ...
  var allFiles = [];
  var iter = folder.getFiles();
  var pattern = new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(_\\d+)?' + ext.replace(/[.]/g, '\\.') + '$', 'i');
  while (iter.hasNext()) {
    var f = iter.next();
    var fname = f.getName();
    if (fname === baseName + ext || fname.match(new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)' + ext.replace(/[.]/g, '\\.') + '$'))) {
      var num = 1;
      var m = fname.match(new RegExp('_(\\d+)' + ext.replace(/[.]/g, '\\.') + '$'));
      if (m) num = parseInt(m[1], 10);
      allFiles.push({ file: f, num: num, name: fname });
    }
  }
  // Sort by number ascending
  allFiles.sort(function(a, b) { return a.num - b.num; });

  // Collect ALL existing IDs across all files for dedup
  var existingIds = {};
  for (var fi = 0; fi < allFiles.length; fi++) {
    if (logIdCol >= 0) {
      var content = allFiles[fi].file.getBlob().getDataAsString();
      if (content) {
        var lines = content.split('\n');
        for (var li = 1; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line) continue;
          var cols = parseCsvLine_(line);
          if (cols[logIdCol]) {
            existingIds[cols[logIdCol].replace(/^"|"$/g, '')] = true;
          }
        }
      }
    }
  }

  // Filter out duplicates
  var newRows = [];
  for (var j = 0; j < rows.length; j++) {
    if (logIdCol >= 0) {
      var id = String(rows[j][logIdCol] || '').replace(/^"|"$/g, '');
      if (id && existingIds[id]) continue;
    }
    newRows.push(rows[j]);
  }

  if (newRows.length === 0) return 0;

  // Find the latest file and its row count
  var latestEntry = allFiles.length > 0 ? allFiles[allFiles.length - 1] : null;
  var latestContent = '';
  var latestRowCount = 0;

  if (latestEntry) {
    latestContent = latestEntry.file.getBlob().getDataAsString();
    var dataLines = latestContent.split('\n').filter(function(l) { return l.trim() !== ''; });
    latestRowCount = Math.max(0, dataLines.length - 1); // subtract header
  }

  var totalAppended = 0;
  var rowIdx = 0;

  while (rowIdx < newRows.length) {
    var spaceLeft;
    if (latestEntry && latestRowCount < MAX_ROWS) {
      // Append to existing latest file
      spaceLeft = MAX_ROWS - latestRowCount;
      var batch = newRows.slice(rowIdx, rowIdx + spaceLeft);
      var csvLines = batch.map(function(row) {
        return row.map(function(cell) {
          var val = String(cell || '').replace(/"/g, '""');
          return '"' + val + '"';
        }).join(',');
      });
      var updated = latestContent.replace(/\n*$/, '') + '\n' + csvLines.join('\n') + '\n';
      latestEntry.file.setContent(updated);
      latestContent = updated;
      latestRowCount += batch.length;
      totalAppended += batch.length;
      rowIdx += batch.length;
    } else {
      // Create a new file
      var nextNum = latestEntry ? latestEntry.num + 1 : 1;
      var newFileName = nextNum === 1 ? baseName + ext : baseName + '_' + nextNum + ext;
      var headerLine = headers.map(function(h) {
        return '"' + String(h).replace(/"/g, '""') + '"';
      }).join(',');
      spaceLeft = MAX_ROWS;
      var batch2 = newRows.slice(rowIdx, rowIdx + spaceLeft);
      var csvLines2 = batch2.map(function(row) {
        return row.map(function(cell) {
          var val = String(cell || '').replace(/"/g, '""');
          return '"' + val + '"';
        }).join(',');
      });
      var newContent = headerLine + '\n' + csvLines2.join('\n') + '\n';
      var newFile = folder.createFile(newFileName, newContent, 'text/csv');
      latestEntry = { file: newFile, num: nextNum, name: newFileName };
      latestContent = newContent;
      latestRowCount = batch2.length;
      totalAppended += batch2.length;
      rowIdx += batch2.length;
    }
  }

  return totalAppended;
}

/**
 * Simple CSV line parser (handles quoted fields).
 */
function parseCsvLine_(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function jsonpResponse_(callbackName, bodyObject) {
  var safeCallback = String(callbackName || '').replace(/[^A-Za-z0-9_$.]/g, '');
  if (!safeCallback) {
    return jsonResponse_(false, null, 'Invalid callback name');
  }

  var payload = {
    ok: bodyObject.ok,
    result: bodyObject.result || null,
    error: bodyObject.error || null,
    ts: new Date().toISOString()
  };

  return ContentService
    .createTextOutput(safeCallback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
