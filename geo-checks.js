// geo-checks.js — ticks a stop off once you have actually left it.
//
// The rule is DEPARTURE, not arrival: a stop is done because you were there and now
// you are not. Requiring two observations instead of one is what makes this safe
// enough to run unattended. Standing in a place and being finished with it are
// different things, and conflating them would quietly disable the late warning —
// drift() measures how overdue the first un-ticked stop is, so ticking a stop the
// moment you arrive tells it you are on time by definition.
//
// Everything here fails CLOSED. No permission, no fix, a stale fix, a sloppy fix, no
// flags, indoors all day: the app behaves exactly as it does with this file absent,
// and the circles still work by hand. The cost of every failure is a missed tick,
// never a wrong one, because a missed tick is already fixed by someone tapping.
//
// Breadcrumbs never leave the phone. Only the resulting tick is shared, in the shape
// checks-store.js already writes — so this needs no schema change and no rules
// republish. The Firestore rules are world-readable, and four people's movement
// traces have no business in there.
(function () {
  if (window.chiGeo) return;            // evaluated twice on load; see audio.js

  const CRUMBS = 'chitown.crumbs';      // local only, never synced
  const FIRED = 'chitown.autoticked';   // stops this DEVICE has already auto-ticked
  const OFF = 'chitown.autotick.off';   // per-device override, last resort

  // Every threshold below is deliberately conservative. Tuned toward missing ticks.
  const MAX_CRUMBS = 240;
  const MAX_ACC = 100;         // m   — a fix sloppier than this tells us nothing
  const FRESH_MS = 120000;     // ms  — and one older than this is about the past
  const NEAR = 60;             // m   — "at" the stop, widened by the fix's own error
  const AWAY = 150;            // m   — "gone from" the stop
  const FAR = 500;             // m   — gone far enough that the clock stops mattering
  const SLACK = 45;            // min — tolerance either side of the scheduled window
  const RECENT = 90;           // min — after this a stop is the humans' business
  const POLL_MS = 90000;       // ms  — one fix a minute and a half, visible only

  let timer = null, lastFixAt = 0, armed = false;

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // Chicago wall clock, wherever the phone thinks it is — and the same "before 4am
  // belongs to the night before" normalisation the page uses, so a 00:02 stop
  // compares against the evening it belongs to rather than that morning.
  function chiMin(ms) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {});
    const m = (+p.hour % 24) * 60 + +p.minute;
    return m < 240 ? m + 1440 : m;
  }
  const DMIN = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    const v = h * 60 + (m || 0);
    return v < 240 ? v + 1440 : v;
  };

  function metres(aLat, aLon, bLat, bLon) {
    const R = 6371000, p = Math.PI / 180;
    const dLat = (bLat - aLat) * p, dLon = (bLon - aLon) * p;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function enabled() {
    if (read(OFF, false) === true) return false;          // this device, last resort
    // The switches at the top of index.html. HTML is served network-first, so those
    // reach a phone without a ?v= bump — which is why the kill switch lives there and
    // not in this file. Absent means off: if the block were ever removed, location
    // use stops rather than silently continuing.
    const sw = window.CHI_SWITCHES;
    if (!sw || sw.geo !== true || sw.autoTick !== true) return false;
    const app = window.CHI_APP;
    // flags is null until itinerary.json lands. Staying off until then means a failed
    // fetch can never tick against whatever schedule happens to be in memory. Both
    // sources must agree, so turning either one off is enough to stop this.
    return !!(app && app.flags && app.flags.autoTick);
  }

  // ── breadcrumbs ──────────────────────────────────────────────────────────────
  function keep(pos) {
    const acc = pos.coords.accuracy;
    // Both tests, not just accuracy. getCurrentPosition will hand back a cached fix
    // with a confident accuracy and an old timestamp, and because ticks are shared,
    // acting on where you were twenty minutes ago lands on all four phones at once.
    if (!(acc <= MAX_ACC)) return null;
    if (Date.now() - pos.timestamp > FRESH_MS) return null;
    const c = { t: pos.timestamp, lat: pos.coords.latitude, lng: pos.coords.longitude, acc: acc };
    const all = read(CRUMBS, []).filter(x => Date.now() - x.t < 864e5);   // today only
    all.push(c);
    write(CRUMBS, all.slice(-MAX_CRUMBS));
    lastFixAt = c.t;
    return c;
  }

  // ── the departure test ───────────────────────────────────────────────────────
  function evaluate() {
    if (!enabled()) return;
    const app = window.CHI_APP, checks = window.chiChecks;
    if (!app || !checks || !checks.ready) return;
    const di = app.liveDay();
    if (di === null || di === undefined) return;       // not a trip day: nothing to do
    const day = (app.days || [])[di];
    if (!day || !day.items) return;

    const crumbs = read(CRUMBS, []);
    if (!crumbs.length) return;
    const last = crumbs[crumbs.length - 1];
    if (Date.now() - last.t > FRESH_MS) return;        // no current fix: say nothing

    const now = chiMin(Date.now());
    const fired = read(FIRED, {});

    day.items.forEach((it, i) => {
      if (!it.ll || !it.time) return;
      const key = di + ':' + i;
      if (fired[key]) return;                          // fire once per device, ever
      if (checks.has(di, i)) return;                   // already ticked, by anyone

      const start = DMIN(it.time);
      const end = it.leave ? DMIN(it.leave) : start + 30;
      if (now < start) return;                         // hasn't begun
      // Past this, an un-ticked stop is a human's call. Bounding it here is also what
      // stops the algorithm arguing: untick something at 4pm and noon is out of scope,
      // so nothing puts it back.
      if (now > end + RECENT) return;

      const there = crumbs.some(c => {
        const cm = chiMin(c.t);
        if (cm < start - SLACK || cm > end + SLACK) return false;
        // Trust the fix's own error estimate rather than a fixed radius: a vague
        // indoor fix needs to be closer to count, a crisp one is allowed to be further.
        return metres(c.lat, c.lng, it.ll[0], it.ll[1]) <= Math.max(NEAR, c.acc);
      });
      if (!there) return;

      const gone = metres(last.lat, last.lng, it.ll[0], it.ll[1]);
      if (gone < AWAY) return;                         // still here
      // Stepping outside for air is not leaving. Either it is about time to go, or you
      // are far enough away that the schedule no longer needs to agree.
      if (now < end - 20 && gone < FAR) return;

      fired[key] = 1;
      write(FIRED, fired);
      checks.toggle(di, i);
    });
  }

  // ── sampling ─────────────────────────────────────────────────────────────────
  function fix() {
    if (!enabled() || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      p => { if (keep(p)) evaluate(); },
      () => {},                                        // denied or unavailable: silence
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // Polling while visible, never a watch and never in the background. watchPosition
  // is the battery cost people notice, and Friday is a fourteen-hour day that ends at
  // a stadium where the phone is the ticket.
  function start() {
    if (timer || document.hidden) return;
    fix();
    timer = setInterval(fix, POLL_MS);
  }
  function stop() { clearInterval(timer); timer = null; }

  function arm() {
    if (armed) return;
    armed = true;
    start();
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : armed && start()));
  window.addEventListener('chi-trip', () => { if (enabled()) arm(); });
  window.addEventListener('chi-checks', evaluate);
  // Safari will not raise the permission prompt without a gesture, so try immediately
  // and again on the first tap, whichever the browser is willing to honour.
  setTimeout(() => { if (enabled()) arm(); }, 3000);
  window.addEventListener('pointerdown', () => { if (enabled()) arm(); }, { once: true, capture: true });

  window.chiGeo = {
    get enabled() { return enabled(); },
    get crumbs() { return read(CRUMBS, []).length; },
    get lastFixAt() { return lastFixAt; },
    get fired() { return read(FIRED, {}); },
    // The per-device escape hatch, for when the shared flag is not reachable.
    off(v) { write(OFF, v !== false); if (v !== false) stop(); },
    evaluate: evaluate,
    _fix: fix
  };
})();
