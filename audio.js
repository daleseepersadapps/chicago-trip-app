// audio.js — the trip's theme, looping quietly under the globe.
//
// Autoplay with sound is blocked by every current browser until the user has
// interacted with the page, so this arms on the first tap instead. In practice you
// touch something within a second of opening the app, which is close enough to
// automatic — but it is a real constraint, not a preference.
//
// The track ducks away when a day's map opens: the schedule is the working part of
// the app and music competing with it while you navigate is noise. It returns when
// you come back to the globe.
(function () {
  const SRC = './theme.mp3';
  const KEY = 'chitown.muted';
  const VOL = 0.32;              // sits under the app rather than over it
  const FADE = 420;              // ms

  let el = null, armed = false, ducked = false, fadeTimer = null;

  const isMuted = () => {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  };
  const setMuted = (v) => {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
  };

  function make() {
    if (el) return el;
    el = new Audio(SRC);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    // a missing or unplayable file must not take anything else down
    el.addEventListener('error', () => { paint(); });
    return el;
  }

  // Ramp rather than jump — a hard cut to silence sounds like a bug.
  function fadeTo(target, ms) {
    if (!el) return;
    clearInterval(fadeTimer);
    const from = el.volume, steps = Math.max(1, Math.round((ms || FADE) / 40));
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
      if (i >= steps) {
        clearInterval(fadeTimer);
        if (target === 0 && !el.paused) el.pause();
      }
    }, 40);
  }

  function want() {
    // should it be audible right now?
    return armed && !isMuted() && !ducked && !document.hidden;
  }

  function apply() {
    if (!el) return;
    if (want()) {
      const p = el.play();
      if (p && p.catch) p.catch(() => {});   // still blocked; the next tap will do it
      fadeTo(VOL);
    } else {
      fadeTo(0, 260);
    }
    paint();
  }

  // First gesture anywhere is what unlocks audio. Once only.
  function arm() {
    if (armed) return;
    armed = true;
    make();
    apply();
  }

  // ── the mute control ─────────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'chi-audio-btn';
  btn.style.cssText = 'position:fixed;z-index:940;left:14px;' +
    'bottom:calc(92px + env(safe-area-inset-bottom));width:34px;height:34px;' +
    'display:none;align-items:center;justify-content:center;border-radius:50%;' +
    'cursor:pointer;background:rgba(6,10,16,.82);border:1px solid rgba(226,238,255,.24);' +
    'backdrop-filter:blur(6px);box-shadow:0 6px 18px -6px rgba(0,0,0,.8);' +
    '-webkit-user-select:none;user-select:none;transition:opacity .3s ease';

  const ICON = (on) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5Z"/>' +
    (on ? '<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4"/>'
        : '<path d="M16 10l4 4M20 10l-4 4"/>') + '</svg>';

  function paint() {
    const on = armed && !isMuted() && el && !el.error;
    btn.innerHTML = ICON(on);
    btn.style.color = on ? '#ff9a5c' : 'rgba(238,244,255,.5)';
    btn.title = on ? 'Mute the music' : 'Play the music';
    // hidden until there is something to control, and while a day map is open
    btn.style.display = (el && el.error) ? 'none' : 'flex';
    btn.style.opacity = ducked ? '0' : '1';
    btn.style.pointerEvents = ducked ? 'none' : 'auto';
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) { setMuted(false); arm(); return; }
    setMuted(!isMuted());
    apply();
  });

  // ── duck while a day's map is open ───────────────────────────────────────────
  // The day layer is the z-index:900 overlay; its opacity is the app's own signal for
  // whether a day is showing, and it covers every route in — rail chip or otherwise.
  function watchDayLayer() {
    const layer = [...document.querySelectorAll('div')]
      .find(d => d.style && d.style.zIndex === '900');
    if (!layer) return false;
    const read = () => {
      const open = parseFloat(layer.style.opacity || '0') > 0.5;
      if (open !== ducked) { ducked = open; apply(); }
    };
    new MutationObserver(read).observe(layer, { attributes: true, attributeFilter: ['style'] });
    read();
    return true;
  }

  function boot() {
    if (!document.body) return setTimeout(boot, 60);
    document.body.appendChild(btn);
    paint();
    ['pointerdown', 'keydown'].forEach(k =>
      window.addEventListener(k, arm, { once: true, capture: true }));
    document.addEventListener('visibilitychange', () => { if (armed) apply(); });
    let n = 0;
    const t = setInterval(() => { if (watchDayLayer() || ++n > 80) clearInterval(t); }, 150);
  }
  boot();

  window.chiAudio = {
    get playing() { return !!(el && !el.paused && el.volume > 0); },
    get muted() { return isMuted(); },
    get armed() { return armed; },
    get ducked() { return ducked; },
    mute(v) { setMuted(v); apply(); }
  };
})();
