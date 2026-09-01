// <star-field> — the three trip cities as a constellation, placed by real lat/lon,
// with sparks travelling from Port of Spain and New York into Chicago.
(function () {
  const CITIES = [
    { id: 'pos', name: 'PORT OF SPAIN', lat: 10.65, lon: -61.52, plotLat: 27 },
    { id: 'nyc', name: 'NEW YORK', lat: 40.71, lon: -74.01, plotLat: 44.8 },
    { id: 'chi', name: 'CHICAGO', lat: 41.88, lon: -87.63, plotLat: 46, dest: true }
  ];
  const LON0 = -92, LON1 = -57, LAT0 = 19, LAT1 = 47;

  class StarField extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      Object.assign(this.style, { display: 'block', position: 'absolute', inset: '0' });
      this._cv = document.createElement('canvas');
      this._cv.style.cssText = 'display:block;width:100%;height:100%';
      this.appendChild(this._cv);
      this._ctx = this._cv.getContext('2d');
      this._t = 0;
      this._sparks = [];
      this._flash = 0;

      const r = (s => () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)(7);
      this._dust = Array.from({ length: 46 }, () => ({
        x: r(), y: r() * 0.62, s: 0.4 + r() * 0.9, p: r() * 6.283, sp: 0.4 + r() * 1.1
      }));

      this._ro = new ResizeObserver(() => this._size());
      this._ro.observe(this);
      this._size();
      this._vis = true;
      this._io = new IntersectionObserver(es => { this._vis = es.some(x => x.isIntersecting); }, { rootMargin: '100px' });
      this._io.observe(this);
      this._loop();
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      this._ro && this._ro.disconnect();
      this._io && this._io.disconnect();
    }
    _size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const b = this.getBoundingClientRect();
      this._w = Math.max(1, b.width); this._h = Math.max(1, b.height);
      this._cv.width = Math.round(this._w * dpr);
      this._cv.height = Math.round(this._h * dpr);
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // biased to the right half so the CHITOWN wordmark never covers the stars
      const x0 = this._w * 0.52, x1 = this._w * 0.955;
      const padTop = this._h * 0.10, boxH = this._h * 0.42;
      this._pt = {};
      CITIES.forEach(c => {
        this._pt[c.id] = [
          x0 + ((c.lon - LON0) / (LON1 - LON0)) * (x1 - x0),
          padTop + ((LAT1 - (c.plotLat ?? c.lat)) / (LAT1 - LAT0)) * boxH
        ];
      });
    }
    _loop() {
      this._raf = requestAnimationFrame(() => this._loop());
      if (!this._vis || document.hidden) return;
      const now = performance.now();
      if (now - (this._last || 0) < 33) return;
      this._last = now;
      this._t += 0.033;
      this._draw();
    }
    _curve(a, b) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      return [mx - dy / len * len * 0.13, my + dx / len * len * 0.13];
    }
    _qp(a, c, b, t) {
      const u = 1 - t;
      return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
              u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
    }
    _draw() {
      const ctx = this._ctx, w = this._w, h = this._h, t = this._t;
      const accent = this.getAttribute('accent') || '#ff9a4a';
      ctx.clearRect(0, 0, w, h);

      // dust
      this._dust.forEach(d => {
        const a = 0.16 + 0.28 * (0.5 + 0.5 * Math.sin(t * d.sp + d.p));
        ctx.fillStyle = `rgba(226,236,255,${a})`;
        ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.s, 0, 6.283); ctx.fill();
      });

      const CHI = this._pt.chi;
      const legs = [this._pt.pos, this._pt.nyc].map(p => ({ a: p, c: this._curve(p, CHI) }));

      // faint lines of the constellation
      legs.forEach(({ a, c }) => {
        ctx.setLineDash([2, 6]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(226,236,255,0.17)';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(c[0], c[1], CHI[0], CHI[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // sparks
      if (this._t - (this._emit || 0) > 1.5) {
        this._emit = this._t;
        legs.forEach((leg, i) => this._sparks.push({ leg: i, t: -i * 0.22 }));
      }
      this._sparks = this._sparks.filter(s => s.t < 1.06);
      this._sparks.forEach(s => {
        s.t += 0.0055;
        if (s.t < 0) return;
        const leg = legs[s.leg];
        for (let k = 0; k < 12; k++) {
          const tt = s.t - k * 0.011;
          if (tt < 0) break;
          const p = this._qp(leg.a, leg.c, CHI, Math.min(1, tt));
          const a = (1 - k / 12) * 0.9 * (1 - Math.max(0, (s.t - 0.96) / 0.1));
          ctx.fillStyle = k < 3 ? `rgba(255,240,220,${a})` : this._rgba(accent, a * 0.7);
          ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.5, 1.9 * (1 - k / 16)), 0, 6.283); ctx.fill();
        }
        if (s.t >= 1 && !s.hit) { s.hit = true; this._flash = 1; }
      });
      this._flash = Math.max(0, this._flash - 0.02);

      // stars
      CITIES.forEach(c => {
        const p = this._pt[c.id];
        const tw = 0.72 + 0.28 * Math.sin(t * (c.dest ? 2.2 : 1.4) + (c.dest ? 0 : 2));
        const R = c.dest ? 3.1 + this._flash * 1.5 : 2.1;
        const glow = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], c.dest ? 26 + this._flash * 16 : 14);
        glow.addColorStop(0, this._rgba(accent, (c.dest ? 0.5 : 0.26) * tw + this._flash * 0.3));
        glow.addColorStop(1, this._rgba(accent, 0));
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p[0], p[1], c.dest ? 30 : 16, 0, 6.283); ctx.fill();

        ctx.fillStyle = `rgba(255,247,238,${0.85 * tw + this._flash * 0.15})`;
        ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 6.283); ctx.fill();

        const sp = (c.dest ? 11 : 6) + this._flash * (c.dest ? 6 : 0);
        ctx.strokeStyle = this._rgba(accent, (c.dest ? 0.55 : 0.3) * tw);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p[0] - sp, p[1]); ctx.lineTo(p[0] + sp, p[1]);
        ctx.moveTo(p[0], p[1] - sp); ctx.lineTo(p[0], p[1] + sp);
        ctx.stroke();

        ctx.font = '7.5px ui-monospace, Menlo, monospace';
        const left = c.id === 'pos';
        ctx.textAlign = left ? 'right' : 'left';
        ctx.fillStyle = `rgba(255,230,205,${c.dest ? 0.7 : 0.42})`;
        ctx.fillText(c.name, p[0] + (left ? -(sp + 5) : sp + 5), p[1] + 3);
      });
    }
    _rgba(hex, a) {
      const n = hex.replace('#', '');
      const f = n.length === 3 ? n.split('').map(x => x + x).join('') : n;
      return `rgba(${parseInt(f.slice(0, 2), 16)},${parseInt(f.slice(2, 4), 16)},${parseInt(f.slice(4, 6), 16)},${a})`;
    }
  }
  customElements.define('star-field', StarField);
})();
