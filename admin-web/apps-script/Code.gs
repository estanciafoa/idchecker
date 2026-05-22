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

// ---- LOG UPLOAD ----
function uploadLogsToDrive_(payload) {
  if (!payload.logs || !Array.isArray(payload.logs) || payload.logs.length === 0) {
    throw new Error('logs array is required and must not be empty');
  }

  var folderId = payload.folderId || '1HYUCLO1VmuA20XgQKGqxuBofg0YwvDkZ';
  var folder = DriveApp.getFolderById(folderId);

  // Build CSV
  var headers = ['timestamp', 'resident_id', 'resident_name', 'unit', 'status'];
  var csvRows = [headers.join(',')];
  payload.logs.forEach(function (log) {
    var row = headers.map(function (h) {
      var val = String(log[h] || '').replace(/"/g, '""');
      return '"' + val + '"';
    });
    csvRows.push(row.join(','));
  });
  var csvContent = csvRows.join('\n');

  // File name: access_logs_YYYY-MM-DD_HH-MM.csv
  var now = new Date();
  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  var fileName = 'access_logs_' +
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    '_' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '.csv';

  folder.createFile(fileName, csvContent, 'text/csv');

  return { fileName: fileName, rowCount: payload.logs.length };
}

// ---- VISITOR CHECK-IN ----
function uploadVisitorCheckin_(payload) {
  var visitor = payload.visitor;
  if (!visitor || !visitor.id) {
    throw new Error('visitor object with id is required');
  }
  var timestamp = payload.timestamp || new Date().toISOString();

  var photoFileName = null;
  // Save photo to Drive
  if (payload.photoBase64) {
    var folderId = payload.folderId || '1HYUCLO1VmuA20XgQKGqxuBofg0YwvDkZ';
    var folder = DriveApp.getFolderById(folderId);
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
    sheet.getRange(1, 1, 1, 8).setValues([
      ['Timestamp', 'Visitor ID', 'Name', 'Flat', 'Phone', 'Aadhar', 'Purpose', 'Photo File']
    ]);
  }
  sheet.appendRow([
    timestamp,
    visitor.id || '',
    visitor.name || '',
    visitor.flat || '',
    visitor.phone || '',
    visitor.aadhar || '',
    visitor.purpose || '',
    photoFileName || ''
  ]);

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
    sheet.getRange(1, 1, 1, 6).setValues([
      ['Timestamp', 'Maid/Cook ID', 'Name', 'Flat', 'Direction', 'Log ID']
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
  for (var j = 0; j < entries.length; j++) {
    var e = entries[j];
    var logId = e.id || '';
    if (logId && existingIds[String(logId)]) continue; // skip duplicate
    sheet.appendRow([
      e.timestamp || new Date().toISOString(),
      e.maid_cook_id || '',
      e.name || '',
      e.flat || '',
      e.direction || '',
      logId
    ]);
    appended++;
  }

  return { rowsAppended: appended };
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
