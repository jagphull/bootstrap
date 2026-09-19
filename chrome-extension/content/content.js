// Injected on demand (via chrome.scripting.executeScript) by popup.js.
// Builds a floating, shadow-DOM-isolated panel that drives:
//  - the guided setup wizard (pick fields + image gallery on the live page)
//  - the "save this vehicle" review/select-images/save flow
// Guarded against double-injection.
(function () {
  if (window.__autoScraperContentLoaded) {
    return; // already injected in this tab; the existing listener still works
  }
  window.__autoScraperContentLoaded = true;

  const generateSelector = window.__autoScraperGenerateSelector;

  const PANEL_CSS = `
    :host { all: initial; }
    .panel {
      position: fixed; top: 16px; right: 16px; width: 360px; max-height: 85vh;
      overflow-y: auto; background: #fff; color: #1a1a1a; border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,.25); font: 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      z-index: 2147483647; border: 1px solid #ddd;
    }
    .hdr { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#1a73e8; color:#fff; border-radius:10px 10px 0 0; }
    .hdr h1 { font-size:14px; margin:0; font-weight:600; }
    .hdr button { background:transparent; border:none; color:#fff; font-size:16px; cursor:pointer; line-height:1; padding:2px 6px; }
    .body { padding:14px; }
    label { display:block; font-weight:600; margin:10px 0 4px; }
    label:first-child { margin-top:0; }
    input[type=text], select, textarea { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #ccc; border-radius:6px; font-size:13px; }
    .row { display:flex; gap:8px; margin-top:8px; }
    .row > * { flex: 1; }
    button.btn { cursor:pointer; border:1px solid #1a73e8; background:#1a73e8; color:#fff; padding:7px 12px; border-radius:6px; font-size:13px; font-weight:600; }
    button.btn.secondary { background:#fff; color:#1a73e8; }
    button.btn.danger { background:#fff; color:#d93025; border-color:#d93025; }
    button.btn:disabled { opacity:.5; cursor:default; }
    .hint { color:#666; font-size:11px; margin-top:4px; }
    .field-item { display:flex; align-items:center; gap:6px; padding:6px 8px; background:#f5f6f7; border-radius:6px; margin-top:6px; }
    .field-item .name { flex:1; font-weight:600; }
    .field-item .val { color:#666; font-size:11px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .field-item button { background:none; border:none; color:#d93025; cursor:pointer; font-size:14px; }
    .status { margin-top:10px; padding:8px 10px; border-radius:6px; font-size:12px; }
    .status.ok { background:#e6f4ea; color:#137333; }
    .status.err { background:#fce8e6; color:#c5221f; }
    .status.info { background:#e8f0fe; color:#1967d2; }
    .imgs { display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; margin-top:8px; max-height:220px; overflow-y:auto; }
    .imgs label { display:block; margin:0; font-weight:normal; position:relative; cursor:pointer; }
    .imgs img { width:100%; height:70px; object-fit:cover; border-radius:4px; display:block; border:2px solid transparent; }
    .imgs input { position:absolute; top:2px; left:2px; }
    .imgs input:checked + img { border-color:#1a73e8; }
    .steps { color:#888; font-size:11px; margin-bottom:8px; }
    .highlight-box { position:fixed; pointer-events:none; z-index:2147483646; background:rgba(26,115,232,.25); border:2px solid #1a73e8; border-radius:2px; }
  `;

  let host, shadow, panelEl, highlightEl;
  let state = null;

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__auto_scraper_host__';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);
    panelEl = document.createElement('div');
    panelEl.className = 'panel';
    shadow.appendChild(panelEl);
    highlightEl = document.createElement('div');
    highlightEl.className = 'highlight-box';
    highlightEl.style.display = 'none';
    shadow.appendChild(highlightEl);
  }

  function closePanel() {
    stopPicking();
    if (host) host.remove();
    host = null;
    state = null;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  }

  // ---------- element picking ----------

  let picking = null; // { onPick(el) }

  function startPicking(onPick) {
    stopPicking();
    picking = { onPick };
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClickCapture, true);
    document.body.style.cursor = 'crosshair';
  }

  function stopPicking() {
    if (!picking) return;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClickCapture, true);
    document.body.style.cursor = '';
    if (highlightEl) highlightEl.style.display = 'none';
    picking = null;
  }

  function onMouseMove(e) {
    if (!picking) return;
    const target = e.composedPath()[0];
    if (!target || target === highlightEl) return;
    const r = target.getBoundingClientRect();
    highlightEl.style.display = 'block';
    highlightEl.style.top = r.top + 'px';
    highlightEl.style.left = r.left + 'px';
    highlightEl.style.width = r.width + 'px';
    highlightEl.style.height = r.height + 'px';
  }

  function onClickCapture(e) {
    if (!picking) return;
    const target = e.composedPath()[0];
    if (host && host.contains(target)) return; // clicks inside our own panel
    e.preventDefault();
    e.stopPropagation();
    const cb = picking.onPick;
    stopPicking();
    cb(target);
  }

  // ---------- extraction ----------

  function extractFieldValue(selector) {
    let node;
    try {
      node = document.querySelector(selector);
    } catch (e) {
      return '';
    }
    if (!node) return '';
    if (node.tagName === 'IMG') return node.currentSrc || node.getAttribute('src') || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) return node.value;
    if (node.tagName === 'META') return node.getAttribute('content') || '';
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function extractImages(gallerySelector) {
    if (!gallerySelector) return [];
    let container;
    try {
      container = document.querySelector(gallerySelector);
    } catch (e) {
      return [];
    }
    if (!container) return [];
    const urls = [];
    container.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.getAttribute('data-src') || img.getAttribute('src') || '';
      if (!src) return;
      try {
        urls.push(new URL(src, location.href).toString());
      } catch (e) {}
    });
    container.querySelectorAll('*').forEach((n) => {
      const bg = getComputedStyle(n).backgroundImage;
      if (bg && bg.startsWith('url(')) {
        const m = bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && m[1]) {
          try {
            urls.push(new URL(m[1], location.href).toString());
          } catch (e) {}
        }
      }
    });
    return Array.from(new Set(urls)).filter((u) => !/\.svg(\?|$)/i.test(u));
  }

  // ---------- messaging helper ----------

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false, error: 'no response' }));
    });
  }

  // ---------- render ----------

  function render() {
    ensureHost();
    panelEl.innerHTML = '';
    panelEl.appendChild(
      el('div', { class: 'hdr' }, [
        el('h1', { text: state.title }),
        el('button', { text: '×', onclick: closePanel }),
      ])
    );
    const body = el('div', { class: 'body' });
    panelEl.appendChild(body);
    state.renderBody(body);
  }

  function setStatus(container, text, kind) {
    const existing = container.querySelector('.status');
    if (existing) existing.remove();
    if (!text) return;
    container.appendChild(el('div', { class: `status ${kind}`, text }));
  }

  // ---------- setup wizard ----------

  function openSetup(domain, existingProfile) {
    const profile = existingProfile
      ? JSON.parse(JSON.stringify(existingProfile))
      : { name: domain, sheetId: '', sheetTab: 'Vehicles', driveFolderId: '', fields: [], gallerySelector: '', keyField: '__url__' };

    state = {
      title: existingProfile ? 'Edit profile' : 'Set up this site',
      step: 'info',
      domain,
      profile,
      renderBody(body) {
        if (this.step === 'info') return renderStepInfo(body, this);
        if (this.step === 'sheet') return renderStepSheet(body, this);
        if (this.step === 'folder') return renderStepFolder(body, this);
        if (this.step === 'fields') return renderStepFields(body, this);
        if (this.step === 'gallery') return renderStepGallery(body, this);
        if (this.step === 'key') return renderStepKey(body, this);
        if (this.step === 'done') return renderStepDone(body, this);
      },
    };
    render();
  }

  function renderStepInfo(body, st) {
    body.appendChild(el('div', { class: 'steps', text: 'Step 1 of 6 · Profile name' }));
    body.appendChild(el('label', { text: 'Profile name' }));
    const input = el('input', { type: 'text', value: st.profile.name || st.domain });
    input.value = st.profile.name || st.domain;
    body.appendChild(input);
    body.appendChild(el('div', { class: 'hint', text: `Applies to pages on ${st.domain}` }));
    body.appendChild(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn',
          text: 'Next',
          onclick: () => {
            st.profile.name = input.value.trim() || st.domain;
            st.step = 'sheet';
            render();
          },
        }),
      ])
    );
  }

  function renderStepSheet(body, st) {
    body.appendChild(el('div', { class: 'steps', text: 'Step 2 of 6 · Google Sheet' }));
    body.appendChild(el('label', { text: 'Existing Sheet URL or ID' }));
    const input = el('input', { type: 'text', placeholder: 'https://docs.google.com/spreadsheets/d/...' });
    input.value = st.profile.sheetId || '';
    body.appendChild(input);
    body.appendChild(el('div', { class: 'hint', text: 'Sheet tab name to write into:' }));
    const tabInput = el('input', { type: 'text' });
    tabInput.value = st.profile.sheetTab || 'Vehicles';
    body.appendChild(tabInput);

    const statusHost = el('div');
    body.appendChild(statusHost);

    body.appendChild(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn secondary',
          text: 'Create new sheet',
          onclick: async (e) => {
            e.target.disabled = true;
            setStatus(statusHost, 'Creating spreadsheet…', 'info');
            const res = await send({ type: 'CREATE_SPREADSHEET', title: `${st.profile.name} - Vehicle Inventory` });
            e.target.disabled = false;
            if (!res.ok) return setStatus(statusHost, res.error, 'err');
            input.value = res.result.spreadsheetId;
            tabInput.value = res.result.sheetTitle;
            setStatus(statusHost, `Created: ${res.result.url}`, 'ok');
          },
        }),
        el('button', {
          class: 'btn',
          text: 'Next',
          onclick: () => {
            const raw = input.value.trim();
            const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
            st.profile.sheetId = m ? m[1] : raw;
            st.profile.sheetTab = tabInput.value.trim() || 'Vehicles';
            if (!st.profile.sheetId) return setStatus(statusHost, 'A sheet is required.', 'err');
            st.step = 'folder';
            render();
          },
        }),
      ])
    );
    body.appendChild(
      el('button', { class: 'btn secondary', text: '← Back', onclick: () => { st.step = 'info'; render(); } })
    );
  }

  function renderStepFolder(body, st) {
    body.appendChild(el('div', { class: 'steps', text: 'Step 3 of 6 · Google Drive folder for photos' }));
    body.appendChild(el('label', { text: 'Existing folder URL or ID (optional)' }));
    const input = el('input', { type: 'text', placeholder: 'https://drive.google.com/drive/folders/...' });
    input.value = st.profile.driveFolderId || '';
    body.appendChild(input);

    const statusHost = el('div');
    body.appendChild(statusHost);

    body.appendChild(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn secondary',
          text: 'Create new folder',
          onclick: async (e) => {
            e.target.disabled = true;
            setStatus(statusHost, 'Creating folder…', 'info');
            const res = await send({ type: 'CREATE_DRIVE_FOLDER', name: `${st.profile.name} - Vehicle Photos` });
            e.target.disabled = false;
            if (!res.ok) return setStatus(statusHost, res.error, 'err');
            input.value = res.result.id;
            setStatus(statusHost, `Created: ${res.result.webViewLink}`, 'ok');
          },
        }),
        el('button', {
          class: 'btn',
          text: 'Next',
          onclick: () => {
            const raw = input.value.trim();
            const m = raw.match(/\/folders\/([a-zA-Z0-9-_]+)/);
            st.profile.driveFolderId = m ? m[1] : raw;
            st.step = 'fields';
            render();
          },
        }),
      ])
    );
    body.appendChild(
      el('button', { class: 'btn secondary', text: '← Back', onclick: () => { st.step = 'sheet'; render(); } })
    );
  }

  function renderStepFields(body, st) {
    body.appendChild(el('div', { class: 'steps', text: 'Step 4 of 6 · Add fields to capture' }));
    body.appendChild(el('label', { text: 'Field name (e.g. Price, VIN, Mileage)' }));
    const nameInput = el('input', { type: 'text', placeholder: 'e.g. VIN' });
    body.appendChild(nameInput);

    const statusHost = el('div');
    body.appendChild(statusHost);

    body.appendChild(
      el('button', {
        class: 'btn',
        text: 'Pick on page',
        onclick: () => {
          const label = nameInput.value.trim();
          if (!label) return setStatus(statusHost, 'Enter a field name first.', 'err');
          setStatus(statusHost, 'Click the element on the page that holds this value…', 'info');
          panelEl.style.display = 'none';
          startPicking((target) => {
            panelEl.style.display = '';
            const selector = generateSelector(target);
            const value = extractFieldValue(selector);
            st.profile.fields.push({ key: label.toLowerCase().replace(/\s+/g, '_'), label, selector });
            nameInput.value = '';
            render();
            const s = panelEl.querySelector('.status');
            if (s) s.remove();
            const info = panelEl.querySelector('.body');
            if (info) info.appendChild(el('div', { class: 'status ok', text: `Added "${label}": "${value.slice(0, 60)}"` }));
          });
        },
      })
    );

    const list = el('div');
    st.profile.fields.forEach((f, i) => {
      list.appendChild(
        el('div', { class: 'field-item' }, [
          el('div', { class: 'name', text: f.label }),
          el('div', { class: 'val', text: extractFieldValue(f.selector) || '(not found on this page)' }),
          el('button', {
            text: '×',
            onclick: () => {
              st.profile.fields.splice(i, 1);
              render();
            },
          }),
        ])
      );
    });
    body.appendChild(list);

    body.appendChild(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn',
          text: 'Next: mark photo gallery',
          onclick: () => {
            st.step = 'gallery';
            render();
          },
        }),
      ])
    );
    body.appendChild(
      el('button', { class: 'btn secondary', text: '← Back', onclick: () => { st.step = 'folder'; render(); } })
    );
  }

  function renderStepGallery(body, st) {
    body.appendChild(el('div', { class: 'steps', text: 'Step 5 of 6 · Mark the photo gallery' }));
    body.appendChild(
      el('div', {
        class: 'hint',
        text: 'Click the container element that holds this vehicle’s photos (e.g. the carousel/gallery box), not an individual photo.',
      })
    );
    const statusHost = el('div');
    body.appendChild(statusHost);
    if (st.profile.gallerySelector) {
      const count = extractImages(st.profile.gallerySelector).length;
      setStatus(statusHost, `Gallery selector set. Found ${count} image(s) on this page.`, 'ok');
    }
    body.appendChild(
      el('button', {
        class: 'btn',
        text: st.profile.gallerySelector ? 'Re-pick gallery container' : 'Pick gallery container on page',
        onclick: () => {
          setStatus(statusHost, 'Click the photo gallery container…', 'info');
          panelEl.style.display = 'none';
          startPicking((target) => {
            panelEl.style.display = '';
            st.profile.gallerySelector = generateSelector(target);
            render();
          });
        },
      })
    );
    body.appendChild(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn',
          text: 'Next',
          onclick: () => {
            st.step = 'key';
            render();
          },
        }),
      ])
    );
    body.appendChild(
      el('button', { class: 'btn secondary', text: '← Back', onclick: () => { st.step = 'fields'; render(); } })
    );
  }

  function renderStepKey(body, st) {
    body.appendChild(el('div', { class: 'steps', text: 'Step 6 of 6 · Duplicate detection' }));
    body.appendChild(el('label', { text: 'Which field uniquely identifies a vehicle?' }));
    body.appendChild(
      el('div', { class: 'hint', text: 'Re-saving a vehicle with a matching value updates its existing row instead of adding a duplicate.' })
    );
    const select = el('select');
    select.appendChild(el('option', { value: '__url__', text: 'Listing page URL' }));
    st.profile.fields.forEach((f) => select.appendChild(el('option', { value: f.label, text: f.label })));
    select.value = st.profile.keyField || '__url__';
    body.appendChild(select);

    const statusHost = el('div');
    body.appendChild(statusHost);

    body.appendChild(
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn',
          text: 'Save profile',
          onclick: async (e) => {
            st.profile.keyField = select.value;
            e.target.disabled = true;
            setStatus(statusHost, 'Requesting permission and saving…', 'info');
            const res = await send({ type: 'SAVE_PROFILE', domain: st.domain, profile: st.profile });
            e.target.disabled = false;
            if (!res.ok) return setStatus(statusHost, res.error, 'err');
            st.step = 'done';
            render();
          },
        }),
      ])
    );
    body.appendChild(
      el('button', { class: 'btn secondary', text: '← Back', onclick: () => { st.step = 'gallery'; render(); } })
    );
  }

  function renderStepDone(body) {
    body.appendChild(el('div', { class: 'status ok', text: 'Profile saved! Use the extension popup to save individual vehicles from listing pages on this site.' }));
    body.appendChild(el('button', { class: 'btn', text: 'Close', onclick: closePanel }));
  }

  // ---------- save vehicle flow ----------

  function openSave(domain, profile) {
    if (!profile) {
      state = {
        title: 'Save vehicle',
        renderBody(body) {
          body.appendChild(el('div', { class: 'status err', text: 'No profile configured for this site yet. Use "Set up this site" first.' }));
        },
      };
      render();
      return;
    }

    const fieldValues = {};
    profile.fields.forEach((f) => (fieldValues[f.label] = extractFieldValue(f.selector)));
    const images = extractImages(profile.gallerySelector);
    const selected = new Set(images.slice(0, 30));

    state = {
      title: 'Save vehicle',
      renderBody(body) {
        body.appendChild(el('div', { class: 'steps', text: `Profile: ${profile.name}` }));

        profile.fields.forEach((f) => {
          body.appendChild(el('label', { text: f.label }));
          const input = el('input', { type: 'text' });
          input.value = fieldValues[f.label] || '';
          input.addEventListener('input', () => (fieldValues[f.label] = input.value));
          body.appendChild(input);
        });

        body.appendChild(el('label', { text: `Photos (${images.length} found, ${selected.size} selected)` }));
        const grid = el('div', { class: 'imgs' });
        images.slice(0, 30).forEach((url) => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = selected.has(url);
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(url);
            else selected.delete(url);
          });
          grid.appendChild(el('label', {}, [cb, el('img', { src: url })]));
        });
        body.appendChild(grid);
        if (images.length === 0) {
          body.appendChild(el('div', { class: 'hint', text: 'No images found. Check the gallery selector in the profile editor.' }));
        }

        const statusHost = el('div');
        body.appendChild(statusHost);

        body.appendChild(
          el('div', { class: 'row' }, [
            el('button', {
              class: 'btn',
              text: 'Save to Sheet',
              onclick: async (e) => {
                e.target.disabled = true;
                setStatus(statusHost, `Uploading ${selected.size} photo(s) and saving row…`, 'info');
                const res = await send({
                  type: 'SAVE_VEHICLE',
                  domain,
                  sourceUrl: location.href,
                  fields: fieldValues,
                  images: Array.from(selected),
                });
                e.target.disabled = false;
                if (!res.ok) return setStatus(statusHost, res.error, 'err');
                setStatus(
                  statusHost,
                  res.result.action === 'updated'
                    ? `Updated existing row (row ${res.result.row}). ${res.result.imagesUploaded} photo(s) uploaded.`
                    : `Added new row. ${res.result.imagesUploaded} photo(s) uploaded.`,
                  'ok'
                );
              },
            }),
          ])
        );
      },
    };
    render();
  }

  // ---------- message handler ----------

  async function handleMessage(msg, sender, sendResponse) {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'OPEN_SETUP') {
      const res = await send({ type: 'GET_PROFILES' });
      openSetup(msg.domain, res.ok ? res.profiles[msg.domain] : null);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'OPEN_SAVE') {
      const res = await send({ type: 'GET_PROFILES' });
      openSave(msg.domain, res.ok ? res.profiles[msg.domain] : null);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender, sendResponse);
    return true;
  });
})();
