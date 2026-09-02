// photo-store.js — the shared photo album behind the dome tiles.
//
// Two backends, same API:
//   FIREBASE  when firebase-config.js carries a projectId. Photos are shared: every
//             visitor sees every upload, live, via a Firestore snapshot listener.
//   LOCAL     otherwise. Uploads persist in this browser via localStorage and are
//             shared with nobody. Keeps the whole UI exercisable with no backend,
//             and means a missing/broken config degrades instead of breaking.
//
// Exposes window.chiPhotos and fires a 'chi-photos' event on window whenever the
// album changes. <photo-dome> listens for that and rebuilds.
//
// Uploading is gated behind a passcode typed once per device. That gate is
// client-side only: a static site has nowhere to keep a secret, so it stops casual
// visitors, not a determined one. What IS enforced lives in firestore.rules /
// storage.rules — sign-in required, size and type caps, and delete-your-own-only.
(function () {
  // This file is evaluated twice on load — one <script> tag, two runs. Unguarded that
  // built the album twice: two Firestore snapshot listeners on the same collection,
  // so every change billed two reads and fired 'chi-photos' twice, rebuilding the
  // dome twice for one upload. The second api also replaced the first on window
  // while the first kept listening, so the orphan could never be torn down.
  // audio.js guards for the same reason.
  if (window.chiPhotos) return;

  const CFG = window.CHI_PHOTO_CONFIG || {};
  const FB = CFG.firebase || {};
  const SHARED = !!FB.projectId;
  const CODE_KEY = 'chi-photo-unlocked';
  const LOCAL_KEY = 'chi-photo-local';
  // Sized for the full-width viewer, not the 51px tile: a phone at 3x DPR wants well
  // over 1000px across before an enlarged photo stops looking soft.
  const MAX_DIM = 2000;

  let photos = [];            // [{ id, day, url, by, at, path }]
  let uid = null;
  let fb = null;              // { db, storage, mod:{...} }
  let ready = false;

  const emit = () => window.dispatchEvent(new CustomEvent('chi-photos'));

  // ── shared helpers ───────────────────────────────────────────────────────────
  const HEIC_RE = /\.(heic|heif)$/i;
  const isHeic = (f) => /^image\/hei[cf]/i.test(f.type || '') || HEIC_RE.test(f.name || '');
  // Some pickers hand over a file with an empty type, so fall back to the extension
  // rather than rejecting a perfectly good photo.
  const isImage = (f) => !!f && (/^image\//.test(f.type || '') ||
    /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i.test(f.name || ''));

  // Re-encode before upload: a modern phone photo is 4-15MB and the tiles render at
  // ~100px. Cap the long edge and ship WebP so the free tier lasts the trip.
  async function shrink(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch (e) {
      // Chrome and Firefox ship no HEIC decoder. iOS Safari does, and iOS usually
      // converts to JPEG when you pick from the library, so this mainly bites HEIC
      // files copied onto a desktop.
      if (isHeic(file)) throw new Error('HEIC needs Safari — save as JPEG first');
      throw new Error("couldn't read that image");
    }
    try {
      const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return await new Promise(res => cv.toBlob(res, 'image/webp', 0.85));
    } finally { bmp.close && bmp.close(); }
  }

  // only free-standing uploads count toward the cap; overrides replace a tile
  const countForDay = (day) =>
    photos.filter(p => p.day === day && (p.slot === null || p.slot === undefined)).length;

  // ── LOCAL backend ────────────────────────────────────────────────────────────
  const local = {
    load() {
      try { photos = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
      catch (e) { photos = []; }
      uid = 'local';
      ready = true;
      emit();
    },
    save() {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(photos)); }
      catch (e) { console.warn('photo-store: localStorage full', e); }
    },
    async add(day, blob, slot) {
      const url = await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      const rec = { id: 'l' + Date.now() + Math.random().toString(36).slice(2, 7), day, url, by: 'local', at: Date.now() };
      if (slot !== null && slot !== undefined) rec.slot = slot;
      photos.push(rec);
      local.save(); emit();
    },
    async remove(id) {
      photos = photos.filter(p => p.id !== id);
      local.save(); emit();
    }
  };

  // ── FIREBASE backend ─────────────────────────────────────────────────────────
  async function initFirebase() {
    const V = 'https://www.gstatic.com/firebasejs/10.12.0';
    const [app, auth, store, fsMod] = await Promise.all([
      import(`${V}/firebase-app.js`),
      import(`${V}/firebase-auth.js`),
      import(`${V}/firebase-storage.js`),
      import(`${V}/firebase-firestore.js`)
    ]);
    const a = app.initializeApp(FB);
    const authI = auth.getAuth(a);
    // Anonymous sign-in gives each device a stable uid, which is what the delete
    // rule keys on — you can remove what you added, not what anyone else did.
    await auth.signInAnonymously(authI);
    await new Promise(res => auth.onAuthStateChanged(authI, u => { if (u) { uid = u.uid; res(); } }));

    const db = fsMod.getFirestore(a, CFG.databaseId || '(default)');
    const st = store.getStorage(a);
    fb = { db, st, fs: fsMod, sto: store };

    const q = fsMod.query(fsMod.collection(db, 'photos'), fsMod.orderBy('at', 'asc'));
    fsMod.onSnapshot(q, snap => {
      photos = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      ready = true;
      emit();
    }, err => {
      console.warn('photo-store: snapshot failed, falling back to local', err);
      local.load();
    });
  }

  async function fbAdd(day, blob, slot) {
    const path = `photos/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const ref = fb.sto.ref(fb.st, path);
    await fb.sto.uploadBytes(ref, blob, { contentType: 'image/webp' });
    const url = await fb.sto.getDownloadURL(ref);
    const doc = { day, url, path, by: uid, at: Date.now() };
    if (slot !== null && slot !== undefined) doc.slot = slot;
    await fb.fs.addDoc(fb.fs.collection(fb.db, 'photos'), doc);
  }

  async function fbRemove(id) {
    const p = photos.find(x => x.id === id);
    if (!p) return;
    await fb.fs.deleteDoc(fb.fs.doc(fb.db, 'photos', id));
    // Storage object second: if this fails the doc is already gone, so the tile
    // clears and we've only leaked bytes, not left a ghost photo on screen.
    try { await fb.sto.deleteObject(fb.sto.ref(fb.st, p.path)); } catch (e) {}
  }

  // ── public API ───────────────────────────────────────────────────────────────
  // Firebase init is async, so every write has a window before `fb` exists where a
  // fast tap would hit "Cannot read properties of null". Say something true instead.
  function requireFb() {
    if (SHARED && !fb) throw new Error('still connecting — try again');
  }

  const api = {
    get shared() { return SHARED; },
    get ready() { return ready; },
    get uid() { return uid; },
    unlocked() { return localStorage.getItem(CODE_KEY) === '1'; },
    unlock(code) {
      const ok = String(code || '').trim().toLowerCase() === String(CFG.passcode || '').toLowerCase();
      if (ok) { localStorage.setItem(CODE_KEY, '1'); emit(); }
      return ok;
    },
    lock() { localStorage.removeItem(CODE_KEY); emit(); },
    // { dayIndex: [{ src, id, mine }] } — free-standing uploads only, which
    // <photo-dome> appends after the curated photos from itinerary.json
    byDay() {
      const out = {};
      photos.forEach(p => {
        if (p.slot !== null && p.slot !== undefined) return;   // overrides, see below
        (out[p.day] = out[p.day] || []).push({ src: p.url, id: p.id, mine: p.by === uid });
      });
      return out;
    },
    // { 'day:slot': { src, id, mine } } — replacements that render on top of a
    // curated photo. The original is never touched: it lives in itinerary.json, and
    // deleting the override brings it straight back.
    //
    // Two people can override the same slot; the newest wins and the older one waits
    // underneath. That keeps "delete only your own" intact — nobody's upload is
    // destroyed by someone else replacing a tile.
    overrides() {
      const out = {};
      photos.forEach(p => {
        if (p.slot === null || p.slot === undefined) return;
        const k = p.day + ':' + p.slot;
        const cur = out[k];
        if (!cur || (p.at || 0) >= cur.at) out[k] = { src: p.url, id: p.id, mine: p.by === uid, at: p.at || 0 };
      });
      return out;
    },
    async add(day, file, slot) {
      if (!api.unlocked()) throw new Error('locked');
      requireFb();
      if (!isImage(file)) throw new Error('not an image');
      // This guard is about the DECODE, not the upload — it only stops something
      // absurd (a video, a huge scan) being decoded into memory. The size that
      // matters is checked after re-encoding, below: a 12MP phone photo arrives at
      // 5-15MB and leaves at a few hundred KB, so capping the input would reject
      // exactly the photos people actually take.
      if (file.size > (CFG.maxInputBytes || 40 * 1024 * 1024)) throw new Error('file too large to open');
      // an override replaces a tile rather than adding one, so it doesn't count
      // against the per-day cap
      if ((slot === null || slot === undefined) && countForDay(day) >= (CFG.maxPerDay || 40)) {
        throw new Error('day is full');
      }
      const blob = await shrink(file);
      // the real cap, applied to the bytes about to be uploaded — mirrors the limit
      // in storage.rules, which enforces the same number server-side
      if (blob.size > (CFG.maxUploadBytes || 4e6)) throw new Error('still too big after resize');
      return SHARED ? fbAdd(day, blob, slot) : local.add(day, blob, slot);
    },
    // Anyone with the trip code can remove anything. The album is shared property
    // among four people, so ownership was friction rather than protection — and it
    // stranded photos whenever a uid changed (anonymous ids are per-browser, so
    // clearing site data used to make your own photos undeletable).
    // Removing a curated photo is an override carrying no image: same slot, empty url,
    // so the tile reads blank and anyone can put their own there. Nothing is destroyed
    // — the original still lives in itinerary.json, and deleting this record brings it
    // straight back. The path still sits under this uid so the existing rules pass
    // unchanged; no Storage object is ever written.
    async hide(day, slot) {
      if (!api.unlocked()) throw new Error('locked');
      requireFb();
      const rec = {
        day: day, url: '', path: 'photos/' + uid + '/blank',
        by: uid, at: Date.now(), slot: slot
      };
      if (SHARED) return fb.fs.addDoc(fb.fs.collection(fb.db, 'photos'), rec);
      photos.push(Object.assign({ id: 'l' + Date.now() + Math.random().toString(36).slice(2, 7) }, rec));
      local.save(); emit();
    },
    async remove(id) {
      if (!api.unlocked()) throw new Error('locked');
      requireFb();
      const p = photos.find(x => x.id === id);
      if (!p) throw new Error('already gone');
      return SHARED ? fbRemove(id) : local.remove(id);
    }
  };
  window.chiPhotos = api;

  if (SHARED) {
    initFirebase().catch(err => {
      console.warn('photo-store: firebase init failed, running local', err);
      local.load();
    });
  } else {
    local.load();
  }
})();
