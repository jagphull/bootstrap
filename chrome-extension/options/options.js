function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false, error: 'no response' })));
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

function setStatus(container, text, kind) {
  const existing = container.querySelector('.status');
  if (existing) existing.remove();
  if (!text) return;
  container.appendChild(el('div', { class: `status ${kind}`, text }));
}

function renderProfileCard(domain, profile) {
  const working = JSON.parse(JSON.stringify(profile));
  const card = el('div', { class: 'card' });

  card.appendChild(el('h2', { text: profile.name || domain }));
  card.appendChild(el('div', { class: 'domain', text: domain }));

  const sheetLink = working.sheetId
    ? el('a', { href: `https://docs.google.com/spreadsheets/d/${working.sheetId}`, target: '_blank', text: 'Open sheet ↗' })
    : null;
  const folderLink = working.driveFolderId
    ? el('a', { href: `https://drive.google.com/drive/folders/${working.driveFolderId}`, target: '_blank', text: 'Open folder ↗' })
    : null;
  if (sheetLink || folderLink) {
    card.appendChild(el('div', { class: 'form-row' }, [sheetLink, folderLink]));
  }

  const sheetIdInput = el('input', { type: 'text' });
  sheetIdInput.value = working.sheetId || '';
  const sheetTabInput = el('input', { type: 'text' });
  sheetTabInput.value = working.sheetTab || 'Vehicles';
  const folderIdInput = el('input', { type: 'text' });
  folderIdInput.value = working.driveFolderId || '';

  card.appendChild(el('div', { class: 'form-row' }, [el('label', { text: 'Sheet ID' }), sheetIdInput]));
  card.appendChild(el('div', { class: 'form-row' }, [el('label', { text: 'Sheet tab' }), sheetTabInput]));
  card.appendChild(el('div', { class: 'form-row' }, [el('label', { text: 'Drive folder ID' }), folderIdInput]));

  const keySelect = el('select');
  keySelect.appendChild(el('option', { value: '__url__', text: 'Listing page URL' }));
  working.fields.forEach((f) => keySelect.appendChild(el('option', { value: f.label, text: f.label })));
  keySelect.value = working.keyField || '__url__';
  card.appendChild(el('div', { class: 'form-row' }, [el('label', { text: 'Duplicate key' }), keySelect]));

  card.appendChild(el('h2', { text: 'Fields', style: 'margin-top:16px;font-size:14px;' }));
  const fieldsHost = el('div');
  function renderFields() {
    fieldsHost.innerHTML = '';
    working.fields.forEach((f, i) => {
      const labelInput = el('input', { type: 'text' });
      labelInput.value = f.label;
      labelInput.addEventListener('input', () => (f.label = labelInput.value));
      const selectorInput = el('input', { type: 'text' });
      selectorInput.value = f.selector;
      selectorInput.addEventListener('input', () => (f.selector = selectorInput.value));
      fieldsHost.appendChild(
        el('div', { class: 'field-row' }, [
          labelInput,
          selectorInput,
          el('button', {
            class: 'icon-btn',
            text: '×',
            onclick: () => {
              working.fields.splice(i, 1);
              renderFields();
              refreshKeyOptions();
            },
          }),
        ])
      );
    });
  }
  function refreshKeyOptions() {
    const prev = keySelect.value;
    keySelect.innerHTML = '';
    keySelect.appendChild(el('option', { value: '__url__', text: 'Listing page URL' }));
    working.fields.forEach((f) => keySelect.appendChild(el('option', { value: f.label, text: f.label })));
    keySelect.value = working.fields.some((f) => f.label === prev) || prev === '__url__' ? prev : '__url__';
  }
  renderFields();
  card.appendChild(fieldsHost);

  card.appendChild(
    el('div', { class: 'field-row' }, [
      el('span', { text: '' }),
      el('span', { text: '' }),
      el('span', { text: '' }),
    ])
  );
  const addFieldBtn = el('button', {
    class: 'btn secondary',
    text: '+ Add field manually',
    onclick: () => {
      working.fields.push({ key: `field_${working.fields.length + 1}`, label: 'New field', selector: '' });
      renderFields();
      refreshKeyOptions();
    },
  });
  card.appendChild(addFieldBtn);

  card.appendChild(el('h2', { text: 'Image gallery selector', style: 'margin-top:16px;font-size:14px;' }));
  const gallerySelectorInput = el('input', { type: 'text' });
  gallerySelectorInput.value = working.gallerySelector || '';
  gallerySelectorInput.addEventListener('input', () => (working.gallerySelector = gallerySelectorInput.value));
  card.appendChild(gallerySelectorInput);

  card.appendChild(el('h2', { text: 'Grant permission for an image CDN domain', style: 'margin-top:16px;font-size:14px;' }));
  card.appendChild(
    el('div', { class: 'hint', text: 'If photos live on a separate domain (e.g. a CDN), grant access to it so uploads work.' })
  );
  const cdnInput = el('input', { type: 'text', placeholder: 'images.example.com' });
  const cdnStatus = el('div');
  card.appendChild(el('div', { class: 'field-row', style: 'grid-template-columns:1fr auto;' }, [
    cdnInput,
    el('button', {
      class: 'btn secondary',
      text: 'Grant',
      onclick: async () => {
        const domainVal = cdnInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*/, '');
        if (!domainVal) return;
        const granted = await chrome.permissions.request({ origins: [`https://${domainVal}/*`] });
        setStatus(cdnStatus, granted ? `Permission granted for ${domainVal}` : 'Permission denied', granted ? 'ok' : 'err');
      },
    }),
  ]));
  card.appendChild(cdnStatus);

  const statusHost = el('div');
  card.appendChild(statusHost);

  card.appendChild(
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn',
        text: 'Save changes',
        onclick: async () => {
          working.sheetId = sheetIdInput.value.trim();
          working.sheetTab = sheetTabInput.value.trim() || 'Vehicles';
          working.driveFolderId = folderIdInput.value.trim();
          working.keyField = keySelect.value;
          const res = await send({ type: 'SAVE_PROFILE', domain, profile: working });
          setStatus(statusHost, res.ok ? 'Saved.' : res.error, res.ok ? 'ok' : 'err');
        },
      }),
      el('button', {
        class: 'btn danger',
        text: 'Delete profile',
        onclick: async () => {
          if (!confirm(`Delete the profile for ${domain}? This does not delete the Google Sheet or Drive folder.`)) return;
          await send({ type: 'DELETE_PROFILE', domain });
          load();
        },
      }),
    ])
  );

  return card;
}

async function load() {
  const container = document.getElementById('profiles');
  container.innerHTML = '';
  const res = await send({ type: 'GET_PROFILES' });
  if (!res.ok) {
    container.appendChild(el('div', { class: 'status err', text: res.error }));
    return;
  }
  const domains = Object.keys(res.profiles);
  if (domains.length === 0) {
    container.appendChild(
      el('div', { class: 'empty', text: 'No profiles yet. Browse to a dealer site and use the extension popup to set one up.' })
    );
    return;
  }
  domains.forEach((domain) => container.appendChild(renderProfileCard(domain, res.profiles[domain])));
}

load();
