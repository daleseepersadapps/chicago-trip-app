// weather.js — live Chicago forecast, plus the <weather-icon> element that draws it.
//
// Open-Meteo: free, no API key, CORS-enabled. No key matters here — this is a static
// site with nowhere to hide a secret, the same constraint the photo passcode lives
// under. Data is cached in localStorage so a dead connection shows the last known
// forecast rather than nothing, and the authored string in itinerary.json remains the
// final fallback.
(function () {
  const LAT = 41.8781, LON = -87.6298;
  const KEY = 'chitown.wx';
  const TTL = 30 * 60 * 1000;            // half an hour is plenty for a daily forecast

  let data = null;

  // WMO weather codes → the eight shapes worth drawing at 16px.
  function bucket(code) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 61 && code <= 67) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 80 && code <= 82) return 'showers';
    if (code >= 95) return 'storm';
    return 'cloud';
  }

  const WORDS = {
    clear: 'CLEAR', partly: 'PARTLY CLOUDY', cloud: 'OVERCAST', fog: 'FOG',
    drizzle: 'DRIZZLE', rain: 'RAIN', snow: 'SNOW', showers: 'SHOWERS', storm: 'STORMS'
  };

  // Line art in the app's existing idiom: currentColor, 1.4 stroke, round caps.
  const SHAPES = {
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4"/>',
    partly: '<circle cx="8.6" cy="8.6" r="3"/><path d="M8.6 2.6v1.6M2.6 8.6h1.6M4.3 4.3l1.2 1.2M12.9 4.3l-1.2 1.2"/><path d="M8 18.5h8.6a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8-.6A3.3 3.3 0 0 0 8 18.5Z"/>',
    cloud: '<path d="M7.4 18.5h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/>',
    fog: '<path d="M7.4 14.6h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/><path d="M4.5 18h15M7 21h10"/>',
    drizzle: '<path d="M7.4 14.6h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/><path d="M9 18v1.6M12 18.6v1.6M15 18v1.6"/>',
    rain: '<path d="M7.4 14.6h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/><path d="M8.6 17.6 7.6 21M12.4 17.6 11.4 21M16.2 17.6 15.2 21"/>',
    showers: '<path d="M7.4 13.6h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/><path d="M8.4 16.4 7.2 20M12.2 16.4 11 20M16 16.4 14.8 20"/>',
    snow: '<path d="M7.4 14.6h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/><path d="M9 18.4v2.2M7.9 19.5h2.2M15 18.4v2.2M13.9 19.5h2.2M12 17.8v2.2"/>',
    storm: '<path d="M7.4 13.4h9.2a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-.6 3.5 3.5 0 0 0-.1 7Z"/><path d="M13 15.6 10 19.4h3.4L11 23"/>'
  };

  function svg(code, size) {
    const s = SHAPES[bucket(code)] || SHAPES.cloud;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" ' +
      'stroke-linejoin="round">' + s + '</svg>';
  }

  // A custom element, because the page's template interpolates text and cannot inject
  // markup — the same reason the dome and the star field are elements rather than
  // strings of HTML.
  class WeatherIcon extends HTMLElement {
    static get observedAttributes() { return ['code', 'size']; }
    // Shadow DOM, not innerHTML. React renders this element and believes it owns its
    // children, so writing light DOM here makes reconciliation try to removeChild a
    // node it never created — a NotFoundError that takes the whole render down with
    // it. A shadow root is invisible to React. Nothing here touches this.style
    // either, since the template drives that.
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { this._draw(); }
    attributeChangedCallback() { this._draw(); }
    _draw() {
      if (!this.shadowRoot) return;
      const size = parseInt(this.getAttribute('size') || '16', 10);
      const raw = this.getAttribute('code');
      const host = '<style>:host{display:inline-flex;align-items:center;line-height:0}</style>';
      // currentColor still resolves across the boundary — colour is inherited
      this.shadowRoot.innerHTML = host + (raw === null || raw === '' ? '' : svg(parseInt(raw, 10), size));
    }
  }
  if (!customElements.get('weather-icon')) customElements.define('weather-icon', WeatherIcon);

  const emit = () => window.dispatchEvent(new CustomEvent('chi-weather'));

  function cache(d) {
    try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), d: d })); } catch (e) {}
  }
  function cached() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      return j && j.d ? j : null;
    } catch (e) { return null; }
  }

  async function load(dates) {
    if (!dates || !dates.length) return;
    const c = cached();
    if (c) { data = c.d; emit(); if (Date.now() - c.at < TTL) return; }
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + LAT + '&longitude=' + LON
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&hourly=weather_code,temperature_2m,precipitation_probability'
      + '&temperature_unit=fahrenheit&timezone=America%2FChicago'
      + '&start_date=' + dates[0] + '&end_date=' + dates[dates.length - 1];
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      if (!j || !j.daily || !j.daily.time) throw new Error('shape');
      data = j;
      cache(j);
      emit();
    } catch (e) {
      // Beyond the forecast horizon, or offline. Whatever is cached stands; if
      // nothing is, the page keeps the authored string from itinerary.json.
      console.warn('weather: ' + e.message);
    }
  }

  const api = {
    load: load,
    get ready() { return !!data; },
    // Daily summary for a trip date, e.g. '2026-09-05'
    day(date) {
      if (!data || !data.daily) return null;
      const i = data.daily.time.indexOf(date);
      if (i < 0) return null;
      const code = data.daily.weather_code[i];
      return {
        code: code, kind: bucket(code), text: WORDS[bucket(code)] || 'CLOUD',
        hi: Math.round(data.daily.temperature_2m_max[i]),
        lo: Math.round(data.daily.temperature_2m_min[i]),
        rain: data.daily.precipitation_probability_max[i]
      };
    },
    // The hour a stop actually happens — what decides an outdoor plan
    at(date, hhmm) {
      if (!data || !data.hourly) return null;
      const h = String(parseInt(String(hhmm).split(':')[0], 10)).padStart(2, '0');
      const i = data.hourly.time.indexOf(date + 'T' + h + ':00');
      if (i < 0) return null;
      const code = data.hourly.weather_code[i];
      return {
        code: code, kind: bucket(code), text: WORDS[bucket(code)] || 'CLOUD',
        temp: Math.round(data.hourly.temperature_2m[i]),
        rain: data.hourly.precipitation_probability[i]
      };
    },
    svg: svg
  };
  window.chiWeather = api;
})();
