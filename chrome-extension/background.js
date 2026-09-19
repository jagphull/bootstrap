// Background service worker: owns Google OAuth, all Sheets/Drive API calls,
// and profile storage. Content scripts / popup / options talk to it via
// chrome.runtime.sendMessage.

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';

function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to get Google auth token'));
      } else {
        resolve(token);
      }
    });
  });
}

async function apiFetch(url, options = {}) {
  const token = await getAuthToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Token may have expired/been revoked; clear cache once and let caller retry.
    if (res.status === 401) {
      await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
    }
    throw new Error(`Google API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Sheets ----------

async function createSpreadsheet(title) {
  const data = await apiFetch(SHEETS_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Vehicles' } }],
    }),
  });
  return { spreadsheetId: data.spreadsheetId, sheetTitle: 'Vehicles', url: data.spreadsheetUrl };
}

async function getSheetValues(sheetId, tab) {
  const range = encodeURIComponent(tab);
  const data = await apiFetch(`${SHEETS_BASE}/${sheetId}/values/${range}`);
  return data.values || [];
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function ensureHeader(sheetId, tab, headers) {
  const values = await getSheetValues(sheetId, tab);
  const currentHeader = values[0] || [];
  const matches =
    headers.length === currentHeader.length && headers.every((h, i) => h === currentHeader[i]);
  if (!matches) {
    const range = `${tab}!A1`;
    await apiFetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, values: [headers] }),
    });
  }
  return values;
}

async function appendOrUpdateRow(sheetId, tab, headers, rowObj, keyHeader) {
  const values = await ensureHeader(sheetId, tab, headers);
  const keyIdx = headers.indexOf(keyHeader);
  const rowArray = headers.map((h) => (rowObj[h] ?? '').toString());

  let matchRowIndex = -1;
  if (keyIdx >= 0 && rowObj[keyHeader]) {
    const keyVal = rowObj[keyHeader].toString();
    for (let i = 1; i < values.length; i++) {
      if ((values[i][keyIdx] || '') === keyVal) {
        matchRowIndex = i;
        break;
      }
    }
  }

  if (matchRowIndex >= 0) {
    const rowNumber = matchRowIndex + 1;
    const range = `${tab}!A${rowNumber}:${colLetter(headers.length)}${rowNumber}`;
    await apiFetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, values: [rowArray] }),
    });
    return { action: 'updated', row: rowNumber };
  }

  const appendRange = `${tab}!A1`;
  await apiFetch(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [rowArray] }),
    }
  );
  return { action: 'appended' };
}

// ---------- Drive ----------

async function createDriveFolder(name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  return apiFetch(`${DRIVE_BASE}/files?fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function uploadImageToDrive(imageUrl, filename, folderId) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch image (${imgRes.status}): ${imageUrl}`);
  const blob = await imgRes.blob();

  const metadata = { name: filename };
  if (folderId) metadata.parents = [folderId];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const token = await getAuthToken();
  const res = await fetch(`${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
  const data = await res.json();

  // Make the file link-viewable so the URL works when pasted/IMAGE()'d in Sheets.
  await apiFetch(`${DRIVE_BASE}/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return `https://drive.google.com/uc?export=view&id=${data.id}`;
}

// ---------- Profile storage ----------

async function getProfiles() {
  const { profiles } = await chrome.storage.local.get('profiles');
  return profiles || {};
}

async function saveProfile(domain, profile) {
  const profiles = await getProfiles();
  profiles[domain] = profile;
  await chrome.storage.local.set({ profiles });
  return profiles;
}

async function deleteProfile(domain) {
  const profiles = await getProfiles();
  delete profiles[domain];
  await chrome.storage.local.set({ profiles });
  return profiles;
}

// ---------- Save vehicle (images -> Drive, row -> Sheet) ----------

async function saveVehicle({ domain, sourceUrl, fields, images }) {
  const profiles = await getProfiles();
  const profile = profiles[domain];
  if (!profile) throw new Error(`No profile configured for ${domain}`);
  if (!profile.sheetId) throw new Error('Profile has no Google Sheet configured');

  const vinEntry = Object.entries(fields).find(([label]) => /vin/i.test(label));
  const namePart = (vinEntry ? vinEntry[1] : '') || sourceUrl || 'vehicle';

  const uploadedLinks = [];
  for (let i = 0; i < images.length; i++) {
    const keyPart = namePart.toString().slice(0, 40);
    const filename = `${keyPart}-${i + 1}.jpg`.replace(/[^\w.-]+/g, '_');
    const link = await uploadImageToDrive(images[i], filename, profile.driveFolderId);
    uploadedLinks.push(link);
  }

  const headers = [...profile.fields.map((f) => f.label), 'Listing URL', 'Image URLs', 'Last Updated'];
  const rowObj = { 'Listing URL': sourceUrl, 'Image URLs': uploadedLinks.join(', '), 'Last Updated': new Date().toISOString() };
  for (const f of profile.fields) rowObj[f.label] = fields[f.label] ?? '';

  const keyHeader = profile.keyField === '__url__' ? 'Listing URL' : profile.keyField;

  const result = await appendOrUpdateRow(profile.sheetId, profile.sheetTab || 'Vehicles', headers, rowObj, keyHeader);
  return { ...result, imagesUploaded: uploadedLinks.length };
}

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'GET_PROFILES':
          sendResponse({ ok: true, profiles: await getProfiles() });
          break;
        case 'SAVE_PROFILE':
          sendResponse({ ok: true, profiles: await saveProfile(msg.domain, msg.profile) });
          break;
        case 'DELETE_PROFILE':
          sendResponse({ ok: true, profiles: await deleteProfile(msg.domain) });
          break;
        case 'CREATE_SPREADSHEET':
          sendResponse({ ok: true, result: await createSpreadsheet(msg.title) });
          break;
        case 'CREATE_DRIVE_FOLDER':
          sendResponse({ ok: true, result: await createDriveFolder(msg.name, msg.parentId) });
          break;
        case 'SAVE_VEHICLE':
          sendResponse({ ok: true, result: await saveVehicle(msg) });
          break;
        case 'AUTH_CHECK':
          await getAuthToken(true);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});
