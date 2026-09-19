// Generates a reasonably stable CSS selector for an element the user clicked on.
// Shared global (isolated world) used by content/content.js.
(function () {
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function generateSelector(el) {
    if (!(el instanceof Element)) return null;

    if (el.id) {
      const idSel = '#' + cssEscape(el.id);
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    }

    const parts = [];
    let node = el;

    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }

      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        const cls = Array.from(node.classList).slice(0, 2).map(cssEscape).join('.');
        if (cls) part += '.' + cls;
      }

      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }

      parts.unshift(part);

      const candidate = parts.join(' > ');
      const matches = document.querySelectorAll(candidate);
      if (matches.length === 1 && matches[0] === el) return candidate;

      node = parent;
    }

    return parts.join(' > ');
  }

  window.__autoScraperGenerateSelector = generateSelector;
})();
