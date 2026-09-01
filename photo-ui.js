// photo-ui.js — the trip-code prompt, and nothing else.
//
// There is no photos button and no photo mode. Tapping any tile on the dome puts a
// photo there; the first tap on a device raises this dialog, and once the code is
// accepted it is remembered in localStorage and never asked for again.
//
// Exposes window.chiPhotoUnlock(cb) -> cb(true) when the album is unlocked.
(function () {
  const ACCENT = '#ff7a3d';
  const Z = 960;   // over the day rail (950), which is the highest thing on screen

  const $ = (tag, css, txt) => {
    const el = document.createElement(tag);
    el.style.cssText = css;
    if (txt != null) el.textContent = txt;
    return el;
  };

  let open = false;

  function ask(cb) {
    const cp = window.chiPhotos;
    if (!cp) { cb(false); return; }
    if (cp.unlocked()) { cb(true); return; }
    if (open) { cb(false); return; }          // one dialog at a time
    open = true;

    const wrap = $('div',
      'position:fixed;inset:0;z-index:' + Z + ';background:rgba(3,5,9,.86);' +
      'display:flex;align-items:center;justify-content:center;padding:28px;backdrop-filter:blur(4px)');
    const box = $('div',
      'width:100%;max-width:320px;background:#05080c;border:1px solid rgba(226,238,255,.18);' +
      'border-radius:18px;padding:22px 20px;display:flex;flex-direction:column;gap:12px');
    box.appendChild($('div',
      'font:700 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.22em;color:' + ACCENT, 'TRIP PHOTOS'));
    box.appendChild($('div',
      'font:400 12.5px/1.5 "Helvetica Neue",Helvetica,sans-serif;color:rgba(238,244,255,.62)',
      cp.shared
        ? 'Enter the trip code to add, replace or remove photos. Asked once on this device.'
        : 'Enter the trip code. No shared album is configured, so photos stay on this device.'));

    const input = document.createElement('input');
    input.type = 'text';
    input.autocapitalize = 'none';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText =
      'width:100%;box-sizing:border-box;padding:12px 14px;border-radius:11px;' +
      'background:rgba(226,238,255,.07);border:1px solid rgba(226,238,255,.22);color:#eef4ff;' +
      'font:600 15px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;outline:none';
    box.appendChild(input);

    const err = $('div',
      'font:600 11px/1.4 "Helvetica Neue",Helvetica,sans-serif;color:#ff8a5c;display:none', 'Not that one.');
    box.appendChild(err);

    const row = $('div', 'display:flex;gap:9px;margin-top:2px');
    const cancel = $('div',
      'flex:1;text-align:center;padding:11px 0;border-radius:11px;cursor:pointer;' +
      'border:1px solid rgba(226,238,255,.2);font:700 10px/1 ui-monospace,Menlo,monospace;' +
      'letter-spacing:.16em;color:rgba(238,244,255,.7)', 'CANCEL');
    const ok = $('div',
      'flex:1;text-align:center;padding:11px 0;border-radius:11px;cursor:pointer;' +
      'background:' + ACCENT + ';font:700 10px/1 ui-monospace,Menlo,monospace;' +
      'letter-spacing:.16em;color:#2a1000', 'UNLOCK');
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    setTimeout(() => input.focus(), 50);

    const close = (result) => { open = false; wrap.remove(); cb(result); };
    const submit = () => {
      if (cp.unlock(input.value)) close(true);
      else { err.style.display = 'block'; input.value = ''; input.focus(); }
    };
    cancel.addEventListener('click', () => close(false));
    wrap.addEventListener('click', e => { if (e.target === wrap) close(false); });
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  window.chiPhotoUnlock = ask;
})();
