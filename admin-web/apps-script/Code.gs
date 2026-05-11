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

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'status') {
      var statusResponse = getRequestStatusResponseObject_(e.parameter.requestId);
      if (e.parameter.callback) {
        return jsonpResponse_(e.parameter.callback, statusResponse);
      }
      return jsonResponse_(statusResponse.ok, statusResponse.result, statusResponse.error);
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
        payload.zipBase64,
        payload.zipFileName || 'resident_photos.zip'
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
  const expectedToken = PropertiesService.getScriptProperties().getProperty('ADMIN_UPLOAD_TOKEN');
  if (!expectedToken) {
    return;
  }
  if (!providedToken || providedToken !== expectedToken) {
    throw new Error('Invalid upload token');
  }
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

function replaceZipInDrive_(fileId, zipBase64, zipFileName) {
  const bytes = Utilities.base64Decode(zipBase64);
  const blob = Utilities.newBlob(bytes, 'application/zip', zipFileName);

  // Use DriveApp to update the file with proper Drive API scope
  try {
    const file = DriveApp.getFileById(fileId);
    file.setContent(blob);
  } catch (err) {
    throw new Error('Drive update failed: ' + err.message);
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
