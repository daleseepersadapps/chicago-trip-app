// checks-store.js — the shared tick-list. Which stops the group has done.
//
// Two backends, same API, mirroring photo-store.js:
//   FIREBASE  when firebase-config.js carries a projectId. Ticks are shared: tick a
//             stop on one phone and it appears on all four within a second, via a
//             Firestore snapshot listener.
//   LOCAL     otherwise. Ticks persist in this browser via localStorage and are
//             shared with nobody. Keeps the whole UI exercisable with no backend.
//
// Exposes window.chiChecks and fires a 'chi-checks' event on window whenever the
// list changes. The page listens for that and re-renders.
//
// Why this matters beyond a tidy checklist: drift() in index.html reads the tick
// list to decide how far behind the day is running. Ticks confined to one phone
// meant the warning only ever reflected whoever happened to be tapping. Shared,
// it reflects the group.
(function () {
  if (window.chiChecks) return;   // evaluated twice on load; see audio.js

  const CFG = window.CHI_PHOTO_CONFIG || {};
  const FB = CFG.firebase || {};
  const SHARED = !!FB.projectId;
  const LOCAL_KEY = 'chitown.done';   // the key the local-only version already used
  const COL = 'checks';

  // In memory the set holds "day:idx", the shape index.html has always used. In
  // Firestore the same pair is the DOCUMENT ID, "day_idx" — deterministic on
  // purpose: two people ticking the same stop at once write the same id, so the
  // second is a harmless overwrite instead of a duplicate row.
  const K = (day, idx) => day + ':' + idx;
  const DOC = (day, idx) => day + '_' + idx;
  const fromDoc = (id) => { const p = String(id).split('_'); return p[0] + ':' + p[1]; };

  let set = new Set();
  let ready = false;
  let uid = null;
  let fb = null;

  const emit = () => window.dispatchEvent(new CustomEvent('chi-checks'));

  // The local copy is written in BOTH modes. On the shared backend it is not the
  // source of truth, only what the next cold start shows while the first snapshot
  // is still in flight — without it the list flashes empty on every launch.
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...set])); } catch (e) {}
  }
  function loadLocal() {
    try { set = new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')); }
    catch (e) { set = new Set(); }
  }

  // ── FIREBASE backend ─────────────────────────────────────────────────────────
  async function initFirebase() {
    const V = 'https://www.gstatic.com/firebasejs/10.12.0';
    const [app, auth, fsMod] = await Promise.all([
      import(`${V}/firebase-app.js`),
      import(`${V}/firebase-auth.js`),
      import(`${V}/firebase-firestore.js`)
    ]);
    // photo-store.js almost certainly booted the app already. initializeApp throws
    // on a second call with the same name, so join the existing one when it is
    // there — whichever of the two files happens to load first wins the init.
    const a = app.getApps().length ? app.getApp() : app.initializeApp(FB);
    const authI = auth.getAuth(a);
    if (!authI.currentUser) await auth.signInAnonymously(authI);
    await new Promise(res => auth.onAuthStateChanged(authI, u => { if (u) { uid = u.uid; res(); } }));

    const db = fsMod.getFirestore(a, CFG.databaseId || '(default)');
    fb = { db, fs: fsMod };

    fsMod.onSnapshot(fsMod.collection(db, COL), snap => {
      // The snapshot is the whole truth, so rebuild rather than patch: an unticked
      // stop is an absent document, and diffing would have to invent that.
      set = new Set(snap.docs.map(d => fromDoc(d.id)));
      ready = true;
      saveLocal();
      emit();
    }, err => {
      console.warn('checks-store: snapshot failed, falling back to local', err);
      loadLocal();
      ready = true;
      emit();
    });
  }

  // ── the API ──────────────────────────────────────────────────────────────────
  const api = {
    get shared() { return SHARED; },
    get ready() { return ready; },
    get uid() { return uid; },

    all() { return set; },
    has(day, idx) { return set.has(K(day, idx)); },
    count(day) { let n = 0; set.forEach(k => { if (+k.split(':')[0] === day) n++; }); return n; },

    // Anyone may tick, and anyone may untick — including a stop someone else
    // ticked. The album takes the same line: this is shared property among four
    // people standing in the same place, and arguing about ownership of a
    // checkbox helps nobody.
    toggle(day, idx) {
      const k = K(day, idx), on = !set.has(k);
      // Apply locally first so the tap feels instant. The snapshot will confirm it
      // a moment later, and on the shared backend it is the snapshot that wins:
      // if the write fails, the next snapshot quietly puts the row back.
      on ? set.add(k) : set.delete(k);
      saveLocal();
      emit();
      if (!SHARED || !fb) return Promise.resolve(on);
      const ref = fb.fs.doc(fb.db, COL, DOC(day, idx));
      const p = on
        ? fb.fs.setDoc(ref, { day: day, idx: idx, by: uid, at: Date.now() })
        : fb.fs.deleteDoc(ref);
      return p.then(() => on).catch(err => {
        console.warn('checks-store: write failed', err);
        return on;
      });
    }
  };

  window.chiChecks = api;

  // Show the last known list immediately in both modes; the snapshot replaces it.
  loadLocal();
  if (SHARED) {
    initFirebase().catch(err => {
      console.warn('checks-store: firebase init failed, running local', err);
      ready = true;
      emit();
    });
  } else {
    ready = true;
    emit();
  }
})();
