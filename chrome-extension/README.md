# Dealer Inventory Scraper (Chrome extension)

Semi-automated scraper for dealership vehicle listing pages. You configure a
"profile" per site once (by clicking the fields you want on the live page),
then on any matching vehicle page you click **Save vehicle from this page**:
it re-reads those same fields, lets you pick which photos to keep, uploads
the photos to a Google Drive folder, and appends (or updates) a row in a
Google Sheet with the field values plus links to the uploaded photos.

## How it works

- **Popup** (`popup/`) — click the toolbar icon. It shows whether the current
  site has a profile and launches setup / save.
- **In-page overlay** (`content/`) — a floating panel injected into the page
  that drives the guided setup wizard (click-to-pick fields and the photo
  gallery container) and the per-vehicle review/save panel.
- **Options page** (`options/`) — lists all saved profiles for editing raw
  selectors, the Sheet/Drive IDs, the duplicate-detection key, and granting
  permission for image CDN domains.
- **Background service worker** (`background.js`) — owns the Google OAuth
  token and all Sheets/Drive API calls (creating the sheet/folder, uploading
  images, appending/updating rows).

Everything is stored locally in `chrome.storage.local` under a `profiles`
map keyed by hostname — nothing is sent anywhere except Google's APIs and
the dealer site itself (to fetch photo bytes for upload).

## One-time Google Cloud setup (required before first use)

The extension needs its own OAuth client so it can write to your Sheets/Drive
on your behalf.

1. **Load the extension unpacked first** (so you know its extension ID):
   - Open `chrome://extensions`, enable **Developer mode** (top right).
   - Click **Load unpacked** and select this `chrome-extension/` folder.
   - Copy the **ID** shown on the extension's card (looks like
     `abcdefghijklmnopabcdefghijklmnop`).

2. **Create/select a Google Cloud project**: https://console.cloud.google.com/

3. **Enable APIs** (APIs & Services → Library): enable both
   - Google Sheets API
   - Google Drive API

4. **Configure the OAuth consent screen** (APIs & Services → OAuth consent
   screen). "External" + "Testing" is fine; add your own Google account
   under **Test users** so you can authorize the app.

5. **Create an OAuth client ID** (APIs & Services → Credentials → Create
   Credentials → OAuth client ID):
   - Application type: **Chrome Extension**
   - Item ID / Application ID: paste the extension ID from step 1.
   - Create, then copy the generated **Client ID**
     (`....apps.googleusercontent.com`).

6. **Paste the client ID into `manifest.json`**, replacing the placeholder:
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     ...
   }
   ```

7. Go back to `chrome://extensions` and click the **reload** icon on the
   extension's card to pick up the manifest change.

The requested scopes are intentionally narrow:
- `spreadsheets` — read/write the sheets you point it at.
- `drive.file` — only files/folders the extension itself creates or that you
  explicitly hand it an ID for; it cannot browse your whole Drive.

## Using it — first site: Scarsview Chrysler

1. Go to the inventory listing page, e.g.
   `https://www.scarsviewchrysler.com/vehicles/used/?st=price,asc&view=grid&sc=used`,
   then open one vehicle's detail page (setup should be done on a detail
   page so the fields you click actually exist).
2. Click the extension icon → **Set up this site**. Chrome will ask you to
   grant it permission to read `www.scarsviewchrysler.com` — allow it.
3. A panel appears on the page and walks you through:
   1. Profile name.
   2. Google Sheet — paste an existing sheet URL, or click **Create new
      sheet**.
   3. Google Drive folder for photos — paste an existing folder URL, or
      click **Create new folder**.
   4. Fields — type a label (e.g. `Year`, `Make`, `Model`, `Trim`, `Mileage`,
      `Price`, `VIN`, `Exterior Color`), click **Pick on page**, then click
      the matching text on the page. Repeat for every field you want.
   5. Photo gallery — click **Pick gallery container on page**, then click
      the element that wraps the vehicle's photos (the carousel/gallery
      box, not a single photo).
   6. Duplicate key — choose which field uniquely identifies a vehicle
      (VIN is recommended if you captured it; otherwise it falls back to
      the listing URL). Re-saving a vehicle with a matching key updates its
      row instead of adding a new one.
   7. **Save profile**.
4. On any other vehicle detail page on that same site, click the extension
   icon → **Save vehicle from this page**. The panel shows the extracted
   values (editable) and thumbnails of the photos it found with checkboxes
   — uncheck any you don't want — then click **Save to Sheet**.
5. First time you save, Chrome will prompt you to sign in to Google and
   approve the Sheets/Drive scopes.

To add another dealer site later, just repeat step 1–3 on that site — each
hostname gets its own profile, sheet, folder, and field list.

## Managing / fixing a profile

Click **Manage all profiles** in the popup (or right-click the extension
icon → Options) to open the options page. From there you can hand-edit CSS
selectors, change the Sheet/Drive IDs, change the duplicate key, delete
fields, delete a whole profile, or grant permission for a separate image CDN
domain if a site's photos are hosted off-domain (uploads from that domain
will otherwise fail with a fetch error).

## Known limitations (MVP)

- CSS selectors are generated from element position/classes; if a site
  redesigns or uses heavily randomized class names, you may need to re-pick
  a field.
- Setup should be performed on a vehicle **detail** page, not the grid/list
  page, since it reads live values from whatever page is open.
- Image detection looks for `<img>` tags and CSS `background-image` inside
  the marked gallery container; lazy-loaded galleries that only populate on
  click-through may need you to open the full gallery first.
- Uploaded Drive photos are set to "anyone with the link can view" so the
  URL works when pasted into Sheets (e.g. with `=IMAGE(...)`); this is
  required for the sheet's image links to render for anyone you share the
  sheet with, but keep that in mind if the photos are sensitive.
