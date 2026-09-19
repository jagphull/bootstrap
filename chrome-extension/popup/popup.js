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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureInjected(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res && res.ok) return;
  } catch (e) {
    // no content script listening yet; inject it below
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/selector.js', 'content/content.js'] });
}

async function requestOrigin(url) {
  const u = new URL(url);
  const origin = `${u.protocol}//${u.hostname}/*`;
  return chrome.permissions.request({ origins: [origin] });
}

async function main() {
  const content = document.getElementById('content');
  document.getElementById('manage').addEventListener('click', () => chrome.runtime.openOptionsPage());

  const tab = await getActiveTab();
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    content.textContent = '';
    content.appendChild(el('div', { class: 'status info', text: 'Open a dealership website page to use this extension.' }));
    return;
  }

  const hostname = new URL(tab.url).hostname;
  document.getElementById('domain').textContent = hostname;

  const res = await send({ type: 'GET_PROFILES' });
  const profile = res.ok ? res.profiles[hostname] : null;

  content.textContent = '';

  if (profile) {
    content.appendChild(
      el('div', { class: 'profile-summary' }, [
        el('strong', { text: profile.name }),
        el('span', { text: `${profile.fields.length} field(s) configured` }),
      ])
    );
    content.appendChild(
      el('button', {
        class: 'btn',
        text: 'Save vehicle from this page',
        onclick: async (e) => {
          e.target.disabled = true;
          const granted = await requestOrigin(tab.url);
          if (!granted) {
            e.target.disabled = false;
            return showStatus('Permission to read this page was denied.', 'err');
          }
          await ensureInjected(tab.id);
          await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SAVE', domain: hostname });
          window.close();
        },
      })
    );
    content.appendChild(
      el('button', {
        class: 'btn secondary',
        text: 'Edit this profile',
        onclick: async (e) => {
          e.target.disabled = true;
          const granted = await requestOrigin(tab.url);
          if (!granted) {
            e.target.disabled = false;
            return showStatus('Permission to read this page was denied.', 'err');
          }
          await ensureInjected(tab.id);
          await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SETUP', domain: hostname });
          window.close();
        },
      })
    );
  } else {
    content.appendChild(el('div', { class: 'status info', text: 'No profile set up for this site yet.' }));
    content.appendChild(
      el('button', {
        class: 'btn',
        text: 'Set up this site',
        onclick: async (e) => {
          e.target.disabled = true;
          const granted = await requestOrigin(tab.url);
          if (!granted) {
            e.target.disabled = false;
            return showStatus('Permission to read this page was denied.', 'err');
          }
          await ensureInjected(tab.id);
          await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_SETUP', domain: hostname });
          window.close();
        },
      })
    );
  }
}

function showStatus(text, kind) {
  const content = document.getElementById('content');
  const existing = content.querySelector('.status');
  if (existing) existing.remove();
  content.appendChild(el('div', { class: `status ${kind}`, text }));
}

main();
