// <photo-dome> — CSS-3D carousel of photo frames on a northern dome. Drop-in
// replacement for <globe-days>: same .days setter, lockDay/unlock/focusDay/unfocus,
// and daychange/dayopen/dayclose events.
//
// Camera matches the old WebGL globe exactly: 24° tilt, northern hemisphere only,
// pole landing at 45.2% of the host's height (was 47.4%, raised when the dome grew).
(function () {
  // Which way the dome turns, and therefore which way the calendar reads.
  //  -1  days run left to right, the globe drifting to match
  //  +1  the original, days running right to left
  // One constant drives both: the idle drift below, and the day-to-sector mapping in
  // _flip. They have to move together — reverse the drift alone and the dates start
  // arriving backwards, which is the bug the _flip comment was written to prevent.
  const SPIN = -1;
  const TILT = 24;
  const TILT_COS = Math.cos(TILT * Math.PI / 180);
  const LAT_MAX = 84 * Math.PI / 180;   // full sphere: -84° … +84°
  const AR = 1;         // square tiles
  // Tight enough that the tiles read as one skin stretched over the sphere rather
  // than framed pictures floating near it — the seams carry the curvature.
  const GAP = 0.07;
  const RADIUS = 2;     // near-square corners; rounding fights the grid
  const TINTS = ['#9ec8ff', '#ff7a3d', '#7ee8a2', '#c58bff'];

  class PhotoDome extends HTMLElement {
    set days(v) {
      this._days = v || [];
      if (this._ready) this._build();
    }
    get days() { return this._days || []; }

    _resume() {
      if (this._ro) this._ro.observe(this);
      if (this._io) this._io.observe(this);
      if (!this._bound) { this._bindDrag(); }   // disconnect unbound them
      if (!this._running) { this._running = true; this._run(); }
    }

    connectedCallback() {
      if (this._init) { this._resume(); return; }
      this._init = true;
      this._accent = this.getAttribute('accent') || '#ff7a3d';
      Object.assign(this.style, {
        display: 'block', position: 'absolute', inset: '0', overflow: 'hidden'
      });

      this._stage = document.createElement('div');
      this._stage.style.cssText = 'position:absolute;inset:0;cursor:grab;touch-action:none';
      this._group = document.createElement('div');
      this._group.style.cssText = 'position:absolute;left:50%;width:0;height:0;' +
        'transform-style:preserve-3d;transition:opacity .45s ease';
      this._stage.appendChild(this._group);
      this.appendChild(this._stage);

      this._yaw = Math.PI * 0.25;
      this._vel = 0;
      this._near = 0;
      this._lock = null;
      this._today = null;
      this._fade = 0;
      this._ready = true;
      this._bindDrag();

      this._ro = new ResizeObserver(() => this._build());
      this._ro.observe(this);
      this._io = new IntersectionObserver(
        es => { this._vis = es.some(x => x.isIntersecting); }, { rootMargin: '120px' });
      this._io.observe(this);
      this._vis = true;

      this._build();
      this._running = true;
      this._run();
    }

    disconnectedCallback() {
      this._running = false;
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._unbind) this._unbind();
      // _init stays true so a reconnect resumes rather than rebuilding, so rebind the
      // drag it just tore down
      this._bound = false;
    }

    _bindDrag() {
      // touch-action:none plus pointer capture, or Chrome on Android claims the
      // gesture after ~10px and the drag dies mid-swipe
      let down = false, lx = 0, moved = 0, pid = null, target = null;
      const end = () => {
        if (!down) return;
        down = false; pid = null;
        this._stage.style.cursor = 'grab';
        if (this._lock !== null) { this._lock = this.nearestDay(); this._idleAt = performance.now(); }
      };
      this._stage.addEventListener('pointerdown', e => {
        if (this._fade > 0.02) return;
        down = true; moved = 0; lx = e.clientX; pid = e.pointerId; target = e.currentTarget;
        this._vel = 0;
        this._stage.style.cursor = 'grabbing';
        try { target.setPointerCapture(pid); } catch (err) {}
      });
      const move = e => {
        if (!down || (pid !== null && e.pointerId !== pid)) return;
        const dx = e.clientX - lx; lx = e.clientX;
        moved += Math.abs(dx);
        this._yaw += dx * 0.0055;
        this._vel = this._vel * 0.72 + dx * 0.0055 * 60 * 0.28;
        this._detent(true);
        if (e.cancelable) e.preventDefault();
      };
      this._stage.addEventListener('pointermove', move);
      window.addEventListener('pointermove', move);
      const ENDS = ['pointerup', 'pointercancel', 'lostpointercapture'];
      ENDS.forEach(k => {
        this._stage.addEventListener(k, end);
        window.addEventListener(k, end);
      });
      // Keep the handles: these are on WINDOW, so without unbinding they outlive the
      // element and a remount would stack a second set driving a dead dome.
      this._unbind = () => {
        window.removeEventListener('pointermove', move);
        ENDS.forEach(k => window.removeEventListener(k, end));
      };
      this._wasDrag = () => moved > 6;
      this._bound = true;
    }

    // Uniform frame size, bands from south to north, fewer frames toward each pole.
    _plan(R, n) {
      let best = null;
      for (let rows = 3; rows <= 5; rows++) {
        const span = LAT_MAX / rows;
        const cellH = R * span, cellW = AR * cellH;
        const plan = []; let total = 0;
        for (let r = 0; r < rows; r++) {
          const lat = (r + 0.5) * span;      // equator → pole, northern half only
          const cells = Math.max(3, Math.round(2 * Math.PI * R * Math.cos(lat) / cellW));
          plan.push({ lat, cells }); total += cells;
        }
        const err = Math.abs(total - n);
        if (!best || err < best.err) best = { err, plan, cellH, cellW };
      }
      return best;
    }

    _build() {
      const w = this.clientWidth, h = this.clientHeight;
      if (!w || !h) return;
      // solve for R with the rim frame's own width included, then clamp by height
      // Deliberately the low estimate: it assumes wide rim tiles, so R comes out
      // conservative and the sphere can never overflow the host's width.
      const bandsGuess = 3, cellH0 = 1 / (LAT_MAX / bandsGuess);
      const fwOverR = AR * (LAT_MAX / bandsGuess) * (1 - GAP);   // frame width per unit R
      // The dome is meant to run off the sides. At 1.34 the sphere plus its rim tiles
      // comes to roughly 134% of the host width, so the widest tiles are cut by the
      // screen edge and the globe reads as larger than the phone holding it. The
      // height cap rises with it, or a short screen would just clamp it back down.
      const BLEED = 1.28;
      const R = Math.max(90, Math.min(
        (w * BLEED) / (2 + fwOverR),
        h * 0.46
      ));
      // the photo counts are part of the key: itinerary.json arrives after the first
      // build, and without this the day count is unchanged so the rebuild is skipped
      // and the photos never land
      // Identify the photos, don't just count them: a remove-then-add lands on the
      // same length and would otherwise skip the rebuild. Curated photos from
      // itinerary.json have no id, so they stand in as 'c'.
      const key = Math.round(R) + '|' + (this._days || []).length + '|' +
        (this._days || []).map(d => ((d || {}).photos || []).map(p => p.id || 'c').join('.')).join(',');
      if (this._key === key) return;
      this._key = key;
      this.R = R;
      // strong perspective + origin on the sphere's centre = real roundness
      this._stage.style.perspective = Math.round(R * 5.33) + 'px';
      this._stage.style.perspectiveOrigin = '50% calc(45.2% + ' + (R * TILT_COS).toFixed(1) + 'px)';

      const nDays = Math.max(1, (this._days || []).length || 4);
      // Square cells are narrower than the old 3:2, so each band fits more of them and
      // this target now lands on 3 bands of ~26 tiles. Smaller tiles are what lets the
      // gap close at all: big flat quads on a curved surface intersect their
      // neighbours once they nearly touch.
      const best = this._plan(R, 47);
      const fh = best.cellH * (1 - GAP), fw = best.cellW * (1 - GAP);
      const d = Math.sqrt(fw * fw + fh * fh) / 2;
      const zr = Math.sqrt(Math.max(1, R * R - d * d));

      // the pole tile's top edge is the highest thing the dome draws
      this.overshoot = R * (1 - TILT_COS) + fh / 2;
      this._group.style.top = 'calc(45.2% + ' + (R * TILT_COS).toFixed(1) + 'px)';

      this._group.innerHTML = '';
      this._vecs = [];
      this._els = [];
      const sector = (Math.PI * 2) / nDays;
      // how many of this day's cells have been filled so far — a day's photos fill its
      // cells in build order, and any cell past the end of the list stays a blank frame
      const filled = {};

      best.plan.forEach((band, r) => {
        const step = (Math.PI * 2) / band.cells;
        for (let c = 0; c < band.cells; c++) {
          const lon = c * step + (r % 2 ? step / 2 : 0);
          // longitude gives the sector; the day living there is the flipped index
          const day = this._flip(Math.min(nDays - 1, Math.floor(lon / sector)));
          const tint = TINTS[day % TINTS.length];
          const label = ((this._days || [])[day] || {}).label || '';
          const tf = 'rotateY(' + (lon * 180 / Math.PI).toFixed(2) + 'deg) rotateX(' +
            (band.lat * 180 / Math.PI).toFixed(2) + 'deg) translateZ(' + zr.toFixed(1) + 'px)';
          this._vecs.push(new DOMMatrix(tf));

          const cell = document.createElement('div');
          cell.style.cssText = 'position:absolute;left:0;top:0;width:' + fw.toFixed(1) +
            'px;height:' + fh.toFixed(1) + 'px;margin-left:' + (-fw / 2).toFixed(1) +
            'px;margin-top:' + (-fh / 2).toFixed(1) + 'px;transform-style:preserve-3d;' +
            'transform:' + tf;
          cell.dataset.day = String(day);

          // Flat and frameless: no card gradient, no tinted ring, no lifted shadow.
          // A grid skin wants the photo to reach its own edge, with only a hairline
          // between neighbours to keep the seams legible against the curve.
          // An empty tile is a panel of the sphere, not a hole in it — the photo covers
          // this entirely when there is one, so the tone and hairline only ever show
          // through on the blanks, and they are what keeps the silhouette readable.
          const card = document.createElement('div');
          card.style.cssText = 'position:absolute;inset:0;border-radius:' + RADIUS + 'px;' +
            'overflow:hidden;cursor:pointer;background:#141c27;' +
            'box-shadow:inset 0 0 0 1px rgba(226,238,255,.07)';

          const sid = 'chi-photo-' + day + '-' + r + '-' + c;
          const slot = document.createElement('image-slot');
          slot.setAttribute('id', sid);
          slot.setAttribute('shape', 'rounded');
          slot.setAttribute('radius', String(RADIUS));
          slot.setAttribute('fit', 'cover');
          slot.setAttribute('placeholder', '');
          // Advance the cursor for ANY entry, not just ones carrying an image. A
          // removed curated photo leaves a blank entry behind, and if that failed to
          // consume its tile the cursor stuck there — every later tile in the day
          // re-read the same blank and emptied too. Deleting one photo wiped the rest.
          const pic = (((this._days || [])[day] || {}).photos || [])[filled[day] = (filled[day] || 0)];
          if (pic) filled[day]++;
          if (pic && pic.src) {
            // No credit attribute: the tiles are ~100px and a caption on each one is
            // noise at that size. Attribution for these lives in PHOTO-CREDITS.md
            // instead. Note that an Unsplash-hosted src is the one exception —
            // <image-slot> renders an error tile rather than show one uncredited — so
            // a photo swapped in from there does need credit/credit-href set here.
            slot.setAttribute('src', pic.src);
          }
          card.appendChild(slot);
          this._hideEmpty(slot);

          // The old top light-wash read as a seam once the tiles touch. Only a faint
          // bottom weight survives, to keep the sphere feeling lit from above.
          const shade = document.createElement('div');
          shade.style.cssText = 'position:absolute;inset:0;pointer-events:none;border-radius:' +
            RADIUS + 'px;background:linear-gradient(180deg,rgba(0,0,0,0) 58%,rgba(0,0,0,.28) 100%)';
          card.appendChild(shade);

          // Kept, because which day a tile belongs to is real information — but pulled
          // right back. In a tight grid a bright label per tile is the loudest thing
          // on the sphere, and the photographs should be.
          const tag = document.createElement('div');
          tag.textContent = label;
          tag.style.cssText = 'position:absolute;left:5px;bottom:4px;pointer-events:none;' +
            'font:700 6px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;opacity:.55;color:' +
            tint + ';text-shadow:0 1px 5px rgba(0,0,0,.9)';
          card.appendChild(tag);


          // <image-slot> binds its own dragover/drop on the host and ingests the file
          // straight into memory, skipping both the trip code and Firebase. Capture on
          // the card runs before the host's own listeners, so the drop never reaches
          // it — then route the file through the same gated path as a tap.
          ['dragenter', 'dragover'].forEach(k => card.addEventListener(k, e => {
            e.preventDefault(); e.stopPropagation();
          }, true));
          card.addEventListener('drop', e => {
            e.preventDefault(); e.stopPropagation();
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!f) return;
            this._unlockThen(() => this._send(day, f, pic ? pic.slot : undefined,
              pic && pic.id ? pic.id : null));
          }, true);

          // Capture, not bubble: this fires on the way DOWN, before the click can
          // reach <image-slot>'s shadow DOM, and stopPropagation keeps it from ever
          // getting there. That is what closes the passcode bypass — the component's
          // own empty-state picker never sees a click at all.
          card.addEventListener('click', e => {
            e.stopPropagation();
            if (this._wasDrag && this._wasDrag()) return;
            // A tile with a photo opens it full width — 51px is too small to judge,
            // and replace/remove belong in front of the photo they act on. A blank
            // one has nothing to show, so it goes straight to the picker.
            if (pic && pic.src) { this._openPhoto(day, pic); return; }
            // Empty: straight to the picker. A cleared curated tile still knows its
            // slot, so what you add lands back in that position rather than the end.
            this._unlockThen(() => this._pick(day, pic ? pic.slot : undefined, null));
          }, true);

          cell.appendChild(card);
          this._group.appendChild(cell);
          this._els.push(cell);
        }
      });
      const rim = document.createElement('div');
      rim.className = 'equator-rim';
      rim.style.cssText = 'position:absolute;left:50%;top:50%;width:' + (R * 2).toFixed(0) +
        'px;height:' + (R * 2).toFixed(0) + 'px;margin-left:' + (-R).toFixed(0) + 'px;margin-top:' +
        (-R).toFixed(0) + 'px;border-radius:50%;pointer-events:none;transform:rotateX(90deg);' +
        // Pulled back: with the tiles touching, the sphere draws its own silhouette
        // and a bright equator glow only competes with the photographs.
        'background:radial-gradient(circle,rgba(255,170,95,.07) 0%,rgba(255,140,60,.02) 62%,rgba(255,140,60,0) 100%);' +
        'box-shadow:0 0 44px rgba(255,150,70,.09)';
      this._group.appendChild(rim);
      this.dispatchEvent(new CustomEvent('domebuilt', { detail: { overshoot: this.overshoot } }));
    }

    // dark frames, per the chosen empty-state: kill the upload chrome but keep the
    // click target, so a drop still works
    _hideEmpty(slot, n) {
      const root = slot.shadowRoot;
      if (!root) { if ((n || 0) < 40) setTimeout(() => this._hideEmpty(slot, (n || 0) + 1), 60); return; }
      if (root.querySelector('style[data-dome]')) return;
      const st = document.createElement('style');
      st.setAttribute('data-dome', '1');
      // <image-slot> ships its own ungated file picker: a click on its empty-state
      // placeholder calls this._input.click() directly, with no editable check and no
      // knowledge of the trip code. On the dome that was a passcode bypass — and a
      // silent one, because that path fills the slot in memory via the component's own
      // _ingest and never reaches Firebase, so the photo looked uploaded and vanished
      // on reload. Make every part of the slot's shadow DOM inert; the host still takes
      // the click and bubbles it to the card, which is the one gated route in.
      st.textContent = ':host{cursor:pointer;pointer-events:auto}' +
        '.empty,.ctl,.ring,.credit,.spill,.frame,.empty *,.ctl *{pointer-events:none!important}' +
        '.empty{opacity:.22!important}' +
        '.ring{opacity:.3!important}.frame{background:transparent!important}';
      root.appendChild(st);
    }
    // Tiles are served at ~51px, so their src is sized for that. Wikimedia carries the
    // width in the thumbnail path, so a bigger one can simply be asked for; anything
    // else (a Firebase upload) is already stored at full size and passes through.
    //
    // 1280 specifically: Wikimedia only serves certain widths and refuses the rest
    // with a 400 — 1024, 1500, 1600 and 2000 all fail where 960, 1280 and 1920 work.
    // 1280 clears the ~1170 device pixels a 3x phone needs at full width without
    // pulling twice the bytes for a screen that cannot show them.
    _hiRes(src) {
      return String(src || '').replace(/\/\d+px-/, '/1280px-');
    }

    // Full-width viewer. Looking is free; replace and remove sit behind the trip code,
    // which is the same rule the tiles had — it just now asks at the moment you act
    // rather than the moment you tap.
    _openPhoto(day, pic) {
      if (this._viewer) return;
      const wrap = document.createElement('div');
      // touch-action:none is what makes the pinch work at all — without it the browser
      // claims a two-finger gesture after a few pixels, fires pointercancel, and the
      // zoom springs back before it has really started. Same reason the dome's drag
      // stage sets it.
      wrap.style.cssText = 'position:fixed;inset:0;z-index:980;background:rgba(4,7,12,0);' +
        'transition:background .22s ease;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:18px;padding:22px;' +
        'touch-action:none;overscroll-behavior:contain';

      const img = document.createElement('img');
      // the tile's own src is already decoded, so it paints instantly; the high-res
      // version swaps in underneath the moment it arrives
      img.src = pic.src;
      // position/z-index so a zoomed photo rises ABOVE the buttons below it — they are
      // later siblings, so by default they would paint on top of the enlarged image
      img.style.cssText = 'width:100%;max-width:560px;max-height:66vh;object-fit:contain;' +
        'border-radius:10px;box-shadow:0 30px 90px rgba(0,0,0,.8);opacity:0;' +
        'position:relative;z-index:1;touch-action:none;' +
        'transform:scale(.92);transition:opacity .24s ease,transform .28s cubic-bezier(.22,1,.36,1)';
      const hi = this._hiRes(pic.src);
      if (hi !== pic.src) {
        const pre = new Image();
        pre.onload = () => { img.src = hi; };
        pre.src = hi;
      }

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:9px;width:100%;max-width:560px';
      const mk = (label, tone, fn) => {
        const b = document.createElement('div');
        b.textContent = label;
        b.style.cssText = 'flex:1;text-align:center;padding:13px 0;border-radius:12px;' +
          'cursor:pointer;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;' +
          tone;
        b.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
        return b;
      };
      // One action, whatever the photo is. A tile either holds a picture you can take
      // down, or it is empty and you add one — no third state to explain. What REMOVE
      // does underneath differs: an upload is deleted, an override drops back to the
      // curated photo beneath it, and a curated photo is blanked so the slot frees up.
      row.appendChild(mk('REMOVE PHOTO', 'background:rgba(220,60,40,.92);color:#fff', () => {
        close();
        this._unlockThen(() => (pic.id
          ? this._remove(pic.id)
          : this._hide(day, pic.slot)));
      }));
      row.appendChild(mk('CLOSE',
        'border:1px solid rgba(226,238,255,.24);color:rgba(238,244,255,.75)', () => close()));

      wrap.appendChild(img);
      wrap.appendChild(row);
      document.body.appendChild(wrap);
      this._viewer = wrap;
      requestAnimationFrame(() => {
        wrap.style.background = 'rgba(4,7,12,.94)';
        img.style.opacity = '1';
        img.style.transform = 'scale(1)';
      });

      const close = () => {
        if (!this._viewer) return;
        this._viewer = null;
        wrap.style.background = 'rgba(4,7,12,0)';
        img.style.opacity = '0';
        img.style.transform = 'scale(.94)';
        setTimeout(() => wrap.remove(), 240);
        window.removeEventListener('keydown', esc);
      };
      const esc = (e) => { if (e.key === 'Escape') close(); };
      window.addEventListener('keydown', esc);
      wrap.addEventListener('click', e => {
        // a pinch ends with a click on the backdrop; that is a released gesture, not a
        // request to shut the photo
        if (Date.now() - (this._zoomedAt || 0) < 420) return;
        if (e.target === wrap) close();
      });

      // Pinch the open photo. It scales past its own box and over the whole screen,
      // then springs back on release — the transform is applied to the flat overlay,
      // so nothing here has to fight the dome's 3D group.
      const pts = new Map();
      const two = () => [...pts.values()].slice(0, 2);
      const gap = () => { const [a, b] = two(); return Math.hypot(a.x - b.x, a.y - b.y); };
      const mid = () => { const [a, b] = two(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
      let z = null;
      wrap.addEventListener('pointerdown', e => {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // capture, so the fingers can wander off the image — or off the screen edge —
        // without the browser quietly ending the gesture
        try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
        if (pts.size === 2 && !z) {
          const m = mid();
          const r = img.getBoundingClientRect();
          // Grow from BETWEEN the fingers rather than the middle of the picture: pinch
          // a corner and that corner is what opens up, which is what makes it feel
          // like Instagram rather than a slide that happens to get bigger.
          const ox = r.width ? ((m.x - r.left) / r.width) * 100 : 50;
          const oy = r.height ? ((m.y - r.top) / r.height) * 100 : 50;
          img.style.transformOrigin = ox.toFixed(1) + '% ' + oy.toFixed(1) + '%';
          img.style.transition = 'none';     // follow the fingers, don't chase them
          img.style.zIndex = '3';            // over the buttons while it is large
          row.style.transition = 'opacity .18s ease';
          row.style.opacity = '0';           // nothing but the photo while zooming
          z = { d0: gap() || 1, m0: m };
        }
      });
      wrap.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!z || pts.size < 2) return;
        // 8x: the photo is laid out at 66vh, so this takes it well past the screen on
        // every side, which is the point — it should feel oversized, not merely bigger
        const s = Math.max(1, Math.min(8, gap() / z.d0));
        const m = mid();
        img.style.transform = 'translate(' + (m.x - z.m0.x).toFixed(1) + 'px,' +
          (m.y - z.m0.y).toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
      const release = e => {
        pts.delete(e.pointerId);
        if (!z || pts.size >= 2) return;
        z = null;
        this._zoomedAt = Date.now();
        img.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)';
        img.style.transform = 'translate(0px,0px) scale(1)';
        row.style.opacity = '1';
        setTimeout(() => { img.style.zIndex = '1'; img.style.transformOrigin = '50% 50%'; }, 340);
      };
      ['pointerup', 'pointercancel'].forEach(k => wrap.addEventListener(k, release));
    }

    _hide(day, slot) {
      if (!window.chiPhotos || !window.chiPhotos.hide) return;
      return window.chiPhotos.hide(day, slot)
        .catch(err => this._toast(String(err.message || err)));
    }

    // One reused file input: a fresh one per tap leaks a node per cancel, and iOS
    // will not open the picker for an input that is not in the document.
    // Ask for the trip code the first time only; unlocked() is remembered per device.
    _unlockThen(fn) {
      const cp = window.chiPhotos;
      if (!cp) return;
      if (cp.unlocked()) { fn(); return; }
      if (window.chiPhotoUnlock) window.chiPhotoUnlock(ok => { if (ok) fn(); });
    }

    _pick(day, slot, replaceId) {
      if (!window.chiPhotos) return;
      let inp = this._input;
      if (!inp) {
        inp = this._input = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        this.appendChild(inp);
      }
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        inp.value = '';
        if (f) this._send(day, f, slot, replaceId);
      };
      inp.click();
    }

    // The single write path: everything that puts a photo on a tile goes through here.
    _send(day, file, slot, replaceId) {
      if (!window.chiPhotos) return;
      return window.chiPhotos.add(day, file, slot)
        // drop the photo being replaced only once the new one is safely stored, so a
        // failed upload never leaves the tile emptier than it started
        .then(() => { if (replaceId) return window.chiPhotos.remove(replaceId).catch(() => {}); })
        .catch(err => this._toast(String(err.message || err)));
    }

    _remove(id) {
      if (!window.chiPhotos) return;
      window.chiPhotos.remove(id).catch(err => this._toast(String(err.message || err)));
    }

    _toast(msg) {
      const t = document.createElement('div');
      t.textContent = msg;
      // clear of both the day rail and the PHOTOS button that now sits above it
      t.style.cssText = 'position:fixed;left:50%;bottom:calc(150px + env(safe-area-inset-bottom));' +
        'transform:translateX(-50%);z-index:999;max-width:78vw;text-align:center;' +
        'padding:9px 15px;border-radius:16px;background:rgba(6,10,16,.92);color:#ffb08a;' +
        'border:1px solid rgba(255,140,90,.4);font:600 11px/1 ui-monospace,Menlo,monospace;' +
        'letter-spacing:.08em;pointer-events:none';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }

    _n() { return Math.max(1, (this._days || []).length || 4); }
    // The globe turns one way and the calendar has to advance the other, so the day
    // and the sector it lives in are not the same number. Which way round depends on
    // SPIN: turning right to left, day i sits in sector (n - i); turning left to
    // right, it sits in sector i. Both mappings are their own inverse, which is why
    // one function converts both ways — and why this is the only place it happens.
    _flip(x) { const n = this._n(); const k = SPIN > 0 ? n - x : x; return ((k % n) + n) % n; }

    nearestDay() {
      const n = this._n();
      const sector = (Math.PI * 2) / n;
      // the sector facing the camera is the one whose centre lands at yaw ≈ 0
      let k = Math.round(-this._yaw / sector) % n;
      if (k < 0) k += n;
      return this._flip(k);
    }

    _detent(fromDrag) {
      const k = this.nearestDay();
      if (k === this._near) return;
      this._near = k;
      if (fromDrag && navigator.vibrate) navigator.vibrate(14);
      this.dispatchEvent(new CustomEvent('daychange', { detail: k }));
    }

    lockDay(i) {
      this._today = i;
      this._lock = i;
      this._idleAt = performance.now();
      const n = this._n();
      const sector = (Math.PI * 2) / n;
      this._yaw = -this._flip(i) * sector;
      this._near = i;
    }
    unlock() { this._lock = null; this._today = null; }

    // Snap to a day with no spin and no fade animation — used when switching days
    // from the rail, where the transition is just noise between two maps.
    jumpDay(i) {
      const n = this._n();
      this._yaw = -this._flip(i) * ((Math.PI * 2) / n);
      this._aim = this._yaw;
      this._vel = 0;
      this._focus = i;
      this._opened = true;
      this._fade = 1;
      this._near = i;
      this._paint();
    }

    focusDay(i) {
      const n = this._n();
      const sector = (Math.PI * 2) / n;
      const target = -this._flip(i) * sector;
      // shortest way round, then fade the dome out and hand over to the day view
      this._aim = target + Math.round((this._yaw - target) / (Math.PI * 2)) * Math.PI * 2;
      this._focus = i;
      this._opened = false;
    }
    unfocus() {
      this._focus = null;
      this._aim = null;
      this._opened = false;
      this.dispatchEvent(new CustomEvent('dayclose'));
    }

    _run() {
      let last = 0;
      const step = (now) => {
        if (!this._running) return;
        this._raf = requestAnimationFrame(step);
        if (!this._vis || document.hidden) return;
        if (now - last < 32) return;           // 30fps is plenty for a slow dome
        const dt = last ? Math.min(0.08, (now - last) / 1000) : 0;
        last = now;

        if (this._focus !== null && this._focus !== undefined) {
          this._yaw += (this._aim - this._yaw) * Math.min(1, dt * 6);
          if (Math.abs(this._aim - this._yaw) < 0.06) {
            this._fade = Math.min(1, this._fade + dt * 3);
            if (this._fade > 0.98 && !this._opened) {
              this._opened = true;
              this.dispatchEvent(new CustomEvent('dayopen', { detail: this._focus }));
            }
          }
        } else {
          this._fade = Math.max(0, this._fade - dt * 3);
          if (this._lock === null) {
            // Idle drift. Only the constant takes SPIN — _vel is the user's own fling
            // and must stay in the direction they threw it. Days still arrive in order
            // either way because the day-to-sector mapping turns with it; see _flip.
            this._yaw += (0.075 * SPIN + this._vel) * dt;
          } else if (performance.now() - (this._idleAt || 0) > 7000) {
            const n = this._n();
            const sector = (Math.PI * 2) / n;
            const t = -this._flip(this._today ?? this._lock) * sector;
            const aim = t + Math.round((this._yaw - t) / (Math.PI * 2)) * Math.PI * 2;
            this._yaw += (aim - this._yaw) * Math.min(1, dt * 2.4);
          } else {
            this._yaw += this._vel * dt;
          }
          this._vel *= Math.pow(0.015, dt);
          if (Math.abs(this._vel) < 0.002) this._vel = 0;
          this._detent(false);
        }

        this._paint();
      };
      this._raf = requestAnimationFrame(step);
    }

    _paint() {
      if (!this._els || !this._els.length) return;
      const rot = 'rotateX(' + (-TILT) + 'deg) rotateY(' +
        (this._yaw * 180 / Math.PI).toFixed(2) + 'deg)';
      this._group.style.transform = rot;
      this._group.style.opacity = (1 - this._fade).toFixed(3);
      this._group.style.pointerEvents = this._fade > 0.1 ? 'none' : 'auto';
      const C = new DOMMatrix(rot);
      const active = this._near;
      for (let i = 0; i < this._els.length; i++) {
        const m = this._vecs[i], el = this._els[i];
        if (!m || !el) continue;
        // z of the frame's face normal in view space: > 0 means it faces the camera
        const V = C.multiply(m);
        const depth = V.m43 / this.R;             // +1 nearest the camera, -1 farthest
        let o = (depth + 0.62) / 0.5;             // hold the rim: it draws the silhouette
        o = o < 0 ? 0 : o > 1 ? 1 : o;
        o = o * o * (3 - 2 * o);
        if (el.dataset.day !== String(active)) o *= 0.78;
        // depth shading via opacity only — a filter per cell inside preserve-3d forces
        // an offscreen buffer and re-raster every frame
        o *= 0.72 + 0.28 * Math.max(0, depth);
        const val = (Math.round(o * 8) / 8).toFixed(3);
        if (el._o !== val) { el._o = val; el.style.opacity = val; }

      }
    }
  }
  if (!customElements.get('photo-dome')) customElements.define('photo-dome', PhotoDome);
})();
