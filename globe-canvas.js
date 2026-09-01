// <globe-canvas> — 2D-canvas projected sphere. No deps, mobile-cheap.
// attrs: mode="dots|rings|hybrid" color accent density speed figure="on|off"
//        beams="on|off" grid="on|off"
// props: .zoom (1 = rest, >1 pushes toward camera), .spin
(function () {
  const TAU = Math.PI * 2;

  function fib(n) {
    const pts = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), t = ga * i;
      pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
    }
    return pts;
  }

  class GlobeCanvas extends HTMLElement {
    constructor() {
      super();
      this.zoom = 1;
      this._t = 0;
      this._raf = null;
    }
    connectedCallback() {
      this.style.display = 'block';
      this.style.position = 'absolute';
      this.style.inset = '0';
      this.style.width = '100%';
      this.style.height = '100%';
      if (!this._cv) {
        this._cv = document.createElement('canvas');
        this._cv.style.cssText = 'display:block;width:100%;height:100%';
        this.appendChild(this._cv);
        this._ctx = this._cv.getContext('2d');
      }
      this._pts = fib(parseInt(this.getAttribute('density') || '1100', 10));
      this._ro = new ResizeObserver(() => this._size());
      this._ro.observe(this);
      this._size();
      this._vis = false;
      this._io = new IntersectionObserver(es => { this._vis = es.some(e => e.isIntersecting); }, { rootMargin: '80px' });
      this._io.observe(this);
      this._loop();
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      this._ro && this._ro.disconnect();
      this._io && this._io.disconnect();
    }
    _size() {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const r = this.getBoundingClientRect();
      this._w = Math.max(1, r.width); this._h = Math.max(1, r.height);
      this._cv.width = Math.round(this._w * dpr);
      this._cv.height = Math.round(this._h * dpr);
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    _loop() {
      this._raf = requestAnimationFrame(() => this._loop());
      if (!this._vis || document.hidden) return;
      const now = performance.now();
      if (now - (this._last || 0) < 33) return;
      this._last = now;
      this._t += (parseFloat(this.getAttribute('speed') || '1')) * 0.0022;
      this._draw();
    }
    _attr(n) {
      return this.getAttribute(n) ?? this.getAttribute(n.replace(/-/g, ''));
    }
    _draw() {
      const ctx = this._ctx, w = this._w, h = this._h;
      if (!ctx) return;
      const mode = this.getAttribute('mode') || 'hybrid';
      const color = this.getAttribute('color') || '#e8e6e1';
      const accent = this.getAttribute('accent') || '#ff5c1a';
      const cx = w / 2, cy = h * (parseFloat(this.getAttribute('cy') || '0.56'));
      const R = Math.min(w, h) * 0.40 * this.zoom;
      const f = 3.2, tilt = 0.44;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const fl = this._attr('focus-lon');
      const ry = fl === null ? this._t
        : (parseFloat(fl) * Math.PI / 180) - Math.PI / 2 + 0.16 * Math.sin(this._t * 0.42);
      const cr = Math.cos(ry), sr = Math.sin(ry);
      const lx = -0.55, ly = 0.42, lz = 0.72;

      ctx.clearRect(0, 0, w, h);

      if (this.getAttribute('smoke') === 'on') {
        if (!this._smoke) {
          this._smoke = [];
          for (let i = 0; i < 6; i++) {
            this._smoke.push({
              x: Math.random(), y: 0.35 + Math.random() * 0.6,
              r: 0.28 + Math.random() * 0.4,
              sp: 0.006 + Math.random() * 0.014,
              ph: Math.random() * TAU,
              a: 0.05 + Math.random() * 0.07
            });
          }
        }
        const sc = this._attr('smoke-color') || accent;
        const SS = 0.28;
        if (!this._sbuf) { this._sbuf = document.createElement('canvas'); this._sctx = this._sbuf.getContext('2d'); }
        const bw = Math.max(1, Math.round(w * SS)), bh = Math.max(1, Math.round(h * SS));
        if (this._sbuf.width !== bw || this._sbuf.height !== bh) { this._sbuf.width = bw; this._sbuf.height = bh; this._sframe = 99; }
        this._sframe = (this._sframe || 0) + 1;
        if (this._sframe >= 4) {
          this._sframe = 0;
          const sx = this._sctx;
          sx.clearRect(0, 0, bw, bh);
          sx.globalCompositeOperation = 'lighter';
          for (const s of this._smoke) {
            const t = this._t;
            const px = (s.x + Math.sin(t * 0.35 + s.ph) * 0.06 + t * s.sp * 0.5) % 1.25 - 0.12;
            const py = s.y + Math.cos(t * 0.28 + s.ph) * 0.05 - ((t * s.sp) % 1) * 0.55;
            const rr = Math.min(bw, bh) * s.r * (1 + 0.12 * Math.sin(t * 0.5 + s.ph));
            const g = sx.createRadialGradient(px * bw, py * bh, 0, px * bw, py * bh, rr);
            g.addColorStop(0, this._rgba(sc, s.a));
            g.addColorStop(0.55, this._rgba(sc, s.a * 0.28));
            g.addColorStop(1, 'rgba(0,0,0,0)');
            sx.fillStyle = g;
            sx.beginPath(); sx.arc(px * bw, py * bh, rr, 0, TAU); sx.fill();
          }
        }
        ctx.drawImage(this._sbuf, 0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const s of []) {
          const t = this._t;
          const px = (s.x + Math.sin(t * 0.35 + s.ph) * 0.06 + t * s.sp * 0.5) % 1.25 - 0.12;
          const py = s.y + Math.cos(t * 0.28 + s.ph) * 0.05 - ((t * s.sp) % 1) * 0.55;
          const rr = Math.min(w, h) * s.r * (1 + 0.12 * Math.sin(t * 0.5 + s.ph));
          const g = ctx.createRadialGradient(px * w, py * h, 0, px * w, py * h, rr);
          g.addColorStop(0, this._rgba(sc, s.a));
          g.addColorStop(0.55, this._rgba(sc, s.a * 0.28));
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(px * w, py * h, rr, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
      if (this._attr('only-smoke') === 'on') return;

      const proj = (p) => {
        let x = p[0] * cr + p[2] * sr, z = -p[0] * sr + p[2] * cr, y = p[1];
        const y2 = y * ct - z * st, z2 = y * st + z * ct;
        const per = f / (f - z2);
        return [cx + x * R * per, cy - y2 * R * per, z2, per, (x * lx + y2 * ly + z2 * lz)];
      };

      if (this.getAttribute('beams') === 'on') {
        const g = ctx.createRadialGradient(cx, cy - R * 1.05, 0, cx, cy - R * 1.05, R * 3.1);
        g.addColorStop(0, 'rgba(255,196,120,0.20)');
        g.addColorStop(0.45, 'rgba(255,150,70,0.055)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }

      // atmosphere
      const ag = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 1.6);
      ag.addColorStop(0, 'rgba(255,255,255,0.055)');
      ag.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(cx, cy, R * 1.6, 0, TAU); ctx.fill();

      // body
      const isHemi = this.getAttribute('hemi') === 'on';
      const domePath = () => {
        ctx.beginPath();
        if (isHemi) {
          ctx.ellipse(cx, cy, R, R, 0, Math.PI, 0);
          ctx.ellipse(cx, cy, R, R * Math.abs(st) * 1.02, 0, 0, Math.PI);
          ctx.closePath();
        } else ctx.arc(cx, cy, R, 0, TAU);
      };
      const bg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      bg.addColorStop(0, 'rgba(255,255,255,0.075)');
      bg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = bg; domePath(); ctx.fill();

      if (mode === 'rings' || mode === 'hybrid') {
        ctx.lineWidth = 1;
        const hemiR = this.getAttribute('hemi') === 'on';
        for (let i = hemiR ? 6 : 1; i < 12; i++) {
          const lat = -Math.PI / 2 + (Math.PI * i) / 12;
          ctx.beginPath();
          let started = false;
          for (let j = 0; j <= 96; j++) {
            const lon = (j / 96) * TAU;
            const p = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
            const q = proj(p);
            if (q[2] < -0.1) { started = false; continue; }
            if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
          }
          const em = i === 6 ? 0.5 : 0.16;
          ctx.strokeStyle = this._rgba(i === 6 ? accent : color, em);
          ctx.stroke();
        }
        for (let m = 0; m < 24; m++) {
          ctx.beginPath();
          let started = false;
          for (let j = hemiR ? 32 : 0; j <= 64; j++) {
            const lat = -Math.PI / 2 + (Math.PI * j) / 64, lon = (m / 24) * TAU;
            const q = proj([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
            if (q[2] < -0.1) { started = false; continue; }
            if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
          }
          ctx.strokeStyle = this._rgba(color, 0.1); ctx.stroke();
        }
      }

      if (mode === 'dots' || mode === 'hybrid') {
        const hemi = this.getAttribute('hemi') === 'on';
        for (const p of this._pts) {
          if (hemi && p[1] < -0.005) continue;
          const q = proj(p);
          if (q[2] < 0) continue;
          const lit = Math.max(0, q[4]);
          const a = (0.14 + 0.9 * Math.pow(lit, 0.9)) * (0.16 + 0.84 * Math.pow(q[2], 1.4));
          const s = (mode === 'dots' ? 1.9 : 1.2) * q[3] * (R / 150);
          ctx.fillStyle = this._rgba(lit > 0.86 ? accent : color, a * 0.9);
          ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
        }
      }

      // rim
      domePath();
      ctx.strokeStyle = this._rgba(color, 0.3); ctx.lineWidth = 1; ctx.stroke();
      if (isHemi) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, R, R * Math.abs(st) * 1.02, 0, 0, TAU);
        ctx.strokeStyle = this._rgba(accent, 0.55); ctx.lineWidth = 1.4; ctx.stroke();
      }

      const arcsAttr = this.getAttribute('arcs');
      if (arcsAttr) {
        let arcs = [];
        try { arcs = JSON.parse(arcsAttr); } catch (e) { arcs = []; }
        const ll = (lat, lon) => {
          const a = lat * Math.PI / 180, o = lon * Math.PI / 180;
          return [Math.cos(a) * Math.cos(o), Math.sin(a), Math.cos(a) * Math.sin(o)];
        };
        const now = this._t;
        const labels = [];
        arcs.forEach((arc, ai) => {
          const A = ll(arc.from[0], arc.from[1]), B = ll(arc.to[0], arc.to[1]);
          const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
          const om = Math.acos(dot), so = Math.sin(om) || 1e-6;
          const N = 72, path = [];
          for (let i = 0; i <= N; i++) {
            const t = i / N;
            const s1 = Math.sin((1 - t) * om) / so, s2 = Math.sin(t * om) / so;
            const lift = 1 + 0.26 * Math.sin(Math.PI * t);
            path.push(proj([
              (A[0] * s1 + B[0] * s2) * lift,
              (A[1] * s1 + B[1] * s2) * lift,
              (A[2] * s1 + B[2] * s2) * lift
            ]));
          }
          const col = arc.color || accent;
          ctx.lineWidth = 1.4;
          for (let i = 0; i < N; i++) {
            const p = path[i], q = path[i + 1];
            if (p[2] < -0.35 || q[2] < -0.35) continue;
            ctx.strokeStyle = this._rgba(col, 0.14 + 0.2 * Math.max(0, p[2]));
            ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
          }
          // travelling head with trail
          const head = ((now * 0.13) + ai * 0.42) % 1.28;
          if (head <= 1) {
            for (let k = 0; k < 16; k++) {
              const t = head - k * 0.012;
              if (t < 0) break;
              const p = path[Math.round(t * N)];
              if (!p || p[2] < -0.2) continue;
              ctx.fillStyle = this._rgba(col, (1 - k / 16) * 0.85);
              const s = 2.6 * (1 - k / 22) * p[3] * (R / 150);
              ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.4, s), 0, TAU); ctx.fill();
            }
          }
          // endpoints
          [[A, arc.fromLabel], [B, arc.toLabel]].forEach(([P, label], ei) => {
            const q = proj(P);
            if (q[2] < -0.05) return;
            const dest = ei === 1;
            const pr = (dest ? 3.4 : 2.6) * q[3] * (R / 150);
            ctx.fillStyle = this._rgba(dest ? col : color, 0.95);
            ctx.beginPath(); ctx.arc(q[0], q[1], pr, 0, TAU); ctx.fill();
            if (dest) {
              const pulse = (now * 0.5) % 1;
              ctx.strokeStyle = this._rgba(col, 0.5 * (1 - pulse));
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.arc(q[0], q[1], pr + pulse * 26 * (R / 150), 0, TAU); ctx.stroke();
            }
            if (label && !labels.some(l => l.text === label)) {
              labels.push({ text: label, x: q[0], y: q[1], r: pr, dest, col: dest ? col : color });
            }
          });
        });

        ctx.font = '9px ui-monospace, Menlo, monospace';
        const used = [];
        const figBox = this.getAttribute('figure') === 'on'
          ? { x: cx - R * 0.09, y: cy - R - R * 0.16, w: R * 0.18, h: R * 0.2 }
          : null;
        if (figBox) used.push(figBox);
        const hits = (b) => used.some(u => b.x < u.x + u.w && b.x + b.w > u.x && b.y < u.y + u.h && b.y + b.h > u.y);
        labels.forEach(l => {
          const tw = ctx.measureText(l.text).width;
          const gap = l.r + 8;
          const cands = [];
          [1, -1].forEach(side => {
            [0, -13, 13, -26, 26, -39, 39].forEach(dy => {
              const x = side === 1 ? l.x + gap : l.x - gap - tw;
              cands.push({ x, y: l.y + dy - 6, w: tw + 4, h: 12, align: side });
            });
          });
          const box = cands.find(c => !hits(c)) || cands[0];
          used.push(box);
          ctx.textAlign = 'left';
          ctx.fillStyle = this._rgba(l.col, 0.8);
          ctx.fillText(l.text, box.x, box.y + 9);
          ctx.strokeStyle = this._rgba(l.col, 0.35);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(l.x + (box.align === 1 ? l.r + 1 : -l.r - 1), l.y);
          ctx.lineTo(box.align === 1 ? box.x - 3 : box.x + box.w + 1, box.y + 6);
          ctx.stroke();
        });
      }

      if (this.getAttribute('figure') === 'on') {
        const top = cy - R;
        const fh = Math.max(9, R * 0.115), fw = Math.max(2, fh * 0.2);
        const bob = Math.sin(this._t * 5) * fh * 0.03;
        const base = top + bob;
        ctx.save();
        ctx.shadowColor = accent; ctx.shadowBlur = fh * 1.1;
        ctx.fillStyle = this._rgba(color, 0.96);
        ctx.fillRect(cx - fw / 2, base - fh * 0.62, fw, fh * 0.62);          // torso + legs
        ctx.fillRect(cx - fw * 1.5, base - fh * 0.58, fw * 3, fw * 0.7);      // arms out
        ctx.beginPath(); ctx.arc(cx, base - fh * 0.72, fw * 0.62, 0, TAU); ctx.fill();
        ctx.restore();
        ctx.fillStyle = this._rgba(accent, 0.85);
        ctx.fillRect(cx - fw * 1.6, base, fw * 3.2, 1.2);
      }
    }
    _rgba(hex, a) {
      if (hex.startsWith('rgb')) return hex;
      const h = hex.replace('#', '');
      const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
  }
  customElements.define('globe-canvas', GlobeCanvas);
})();
