// Stillwave Trace 1.3.6: FM towers on the Map page (rose "Towers" pill, off by default, remembered).
//  - /api/fm/towers?bbox= : FCC FM sites from the station bank, stations within 2.5 km merged ("MT WILSON · 19 FM")
//  - tap a tower: card with the site's frequencies (+N more), city, kW, m, NM + bearing from the receiver, Tune ▸
//  - 2 SDRs: tunes SDR 2 live, SDR 1 keeps tracking. 1 SDR: asks first, then switches to FM, tunes and opens /listen.
//  - the tower card and the plane / boat cards never show together.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), TC = '#fb7185', KEY = 'traceMapTowers';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let on = false, M = null, T = [], card = null, site = null, sel = null, more = false, seq = 0, mvT = null, R = null, busy = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const fc = f => ({ type: 'FeatureCollection', features: f || [] });

  function icon(sz) {
    const c = document.createElement('canvas'); c.width = c.height = sz; const g = c.getContext('2d'), s = sz / 32;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.fillStyle = 'rgba(11,15,12,.85)'; g.strokeStyle = TC; g.lineWidth = 1.6 * s; g.beginPath(); g.arc(16 * s, 16 * s, 15 * s, 0, 7); g.fill(); g.stroke();
    g.lineWidth = 2.4 * s; g.beginPath(); g.moveTo(16 * s, 11 * s); g.lineTo(11 * s, 26 * s); g.moveTo(16 * s, 11 * s); g.lineTo(21 * s, 26 * s); g.moveTo(12.6 * s, 21 * s); g.lineTo(19.4 * s, 21 * s); g.stroke();
    g.fillStyle = TC; g.beginPath(); g.arc(16 * s, 10 * s, 2.2 * s, 0, 7); g.fill();
    g.lineWidth = 1.8 * s; g.beginPath(); g.arc(16 * s, 10 * s, 5.5 * s, -2.4, -0.74); g.stroke(); g.beginPath(); g.arc(16 * s, 10 * s, 5.5 * s, 0.74 - Math.PI, 2.4 - Math.PI); g.stroke();
    return g.getImageData(0, 0, sz, sz);
  }
  const nm = (a, b) => { const R = 3440.065, t = x => x * Math.PI / 180, dl = t(b.lat - a.lat), dn = t(b.lon - a.lon);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const brg = (a, b) => { const t = x => x * Math.PI / 180, y = Math.sin(t(b.lon - a.lon)) * Math.cos(t(b.lat)),
    x = Math.cos(t(a.lat)) * Math.sin(t(b.lat)) - Math.sin(t(a.lat)) * Math.cos(t(b.lat)) * Math.cos(t(b.lon - a.lon)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  function setup() {
    const m = M.map;
    if (!m.hasImage('tower')) m.addImage('tower', icon(64), { pixelRatio: 2 });
    if (!m.getSource('towers')) m.addSource('towers', { type: 'geojson', data: fc() });
    const before = m.getLayer('ac') ? 'ac' : undefined;
    const font = (m.getLayer('ac-label') && m.getLayoutProperty('ac-label', 'text-font')) || ['Noto Sans Regular'];
    if (!m.getLayer('tower-sel')) m.addLayer({ id: 'tower-sel', type: 'circle', source: 'towers', filter: ['==', ['get', 'i'], -1],
      paint: { 'circle-radius': 22, 'circle-color': 'rgba(251,113,133,.12)', 'circle-stroke-color': TC, 'circle-stroke-width': 2 } }, before);
    if (!m.getLayer('tower')) m.addLayer({ id: 'tower', type: 'symbol', source: 'towers',
      layout: { 'icon-image': 'tower', 'icon-size': ['case', ['>=', ['get', 'n'], 5], 1.25, 0.9], 'icon-allow-overlap': true,
        'text-field': ['get', 'lab'], 'text-font': font, 'text-size': ['case', ['>=', ['get', 'n'], 5], 13, 11], 'text-offset': [0, 1.55],
        'text-anchor': 'top', 'text-optional': true, 'text-letter-spacing': 0.06, 'visibility': on ? 'visible' : 'none' },
      paint: { 'text-color': '#fecdd3', 'text-halo-color': '#0b0f0c', 'text-halo-width': 1.6 } }, before);
    m.on('click', e => {
      if (!on) return;
      const r = 22, hits = m.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['tower'] });
      if (hits.length) { open(+hits[0].properties.i); return; }
      close();
    });
    m.on('moveend', () => { clearTimeout(mvT); mvT = setTimeout(load, 300); });
    m.on('mouseenter', 'tower', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'tower', () => { m.getCanvas().style.cursor = ''; });
    // plane / boat card opens -> tower card closes
    for (const k of ['select', 'selectBoat']) {
      const f = M[k]; if (typeof f !== 'function') continue;
      M[k] = function (x) { if (x != null) close(); return f.apply(this, arguments); };
    }
    if (on) load();
  }

  async function load() {
    if (!on || !M) return;
    const b = M.map.getBounds(), s = ++seq;
    const q = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Math.max(-180, Math.min(180, v)).toFixed(4)).join(',');
    let d; try { d = await (await fetch('/api/fm/towers?bbox=' + q, { cache: 'no-store' })).json(); } catch (e) { return; }
    if (s !== seq || !d || !Array.isArray(d.towers)) return;
    const keep = site && site.label;
    T = d.towers;
    M.map.getSource('towers').setData(fc(T.map((t, i) => ({ type: 'Feature', properties: { i, n: t.n, lab: t.label }, geometry: { type: 'Point', coordinates: [t.lon, t.lat] } }))));
    if (keep) { const i = T.findIndex(t => t.label === keep); if (i >= 0) { site = T[i]; mark(i); } }
  }
  function mark(i) { try { M.map.setFilter('tower-sel', ['==', ['get', 'i'], i]); } catch (e) {} }

  function open(i) {
    const t = T[i]; if (!t) return;
    site = t; sel = t.stations.reduce((a, b) => ((b.erp_kw || 0) > (a.erp_kw || 0) ? b : a), t.stations[0]); more = false;
    if (M.selected) M.select(null); if (M.boatSel) M.selectBoat(null);
    mark(i); paint();
  }
  function close() { if (!card) return; card.remove(); card = null; site = null; sel = null; mark(-1); document.documentElement.classList.remove('tcardopen'); }

  function paint() {
    if (!site || !sel) return;
    if (!card) { card = document.createElement('div'); card.className = 'tcard'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'FM tower'); $('mapwrap').appendChild(card); document.documentElement.classList.add('tcardopen'); }   // 1.3.8: hides the gain control while the card is open
    const st = site.stations, n = st.length, rc = (M && M.receiver) || { lat: 33.9425, lon: -118.4081 };
    const d = nm(rc, site), b = brg(rc, site), i0 = st.indexOf(sel);
    const lo = Math.max(0, Math.min(i0 - 2, n - 6)), show = more ? st : st.slice(lo, lo + 6), rest = n - show.length;
    const where = site.name ? site.name.replace(/\w\S*/g, w => w[0] + w.slice(1).toLowerCase()).replace(/^Mt /, 'Mt ') : (sel.city || 'FM site');
    card.innerHTML = '<div class="th"><b>' + esc(sel.call) + ' <em>· ' + sel.mhz.toFixed(1) + ' MHz</em></b><button type="button" class="tx" aria-label="Close">✕</button></div>' +
      '<div class="ts">FM tower · ' + esc(where) + (n > 1 ? ' · ' + n + ' stations share this site' : '') + '</div>' +
      '<div class="tco' + (more ? ' all' : '') + '">' + show.map(x => '<button type="button" data-c="' + esc(x.call) + '" data-f="' + x.mhz + '"' + (x === sel ? ' class="on"' : '') + '>' + x.mhz.toFixed(1) + '<small>' + esc(x.call) + '</small></button>').join('') +
        (rest > 0 ? '<button type="button" class="more">+' + rest + '<small>more ›</small></button>' : more && n > 6 ? '<button type="button" class="more">‹<small>less</small></button>' : '') + '</div>' +
      '<dl class="agrid"><div><dt>City</dt><dd>' + esc(sel.city || '—') + '</dd></div><div><dt>Power</dt><dd>' + (sel.erp_kw != null ? +(+sel.erp_kw).toFixed(2) + ' kW' : '—') + '</dd></div>' +
        '<div><dt>Above terrain</dt><dd>' + (sel.haat_m != null ? Math.round(sel.haat_m) + ' m' : '—') + '</dd></div><div><dt>From you</dt><dd>' + d.toFixed(0) + ' NM ' + CARD[Math.round(b / 45) % 8] + '</dd></div></dl>' +
      '<div class="tgo"><button type="button" class="tune">Tune ' + sel.mhz.toFixed(1) + ' FM ▸</button></div><p class="tnote" id="twN"></p>';
    card.querySelector('.tx').onclick = close;
    card.querySelectorAll('.tco button').forEach(bt => bt.onclick = () => {
      if (bt.classList.contains('more')) { more = !more; paint(); return; }
      sel = st.find(x => x.call === bt.dataset.c && String(x.mhz) === bt.dataset.f) || sel; paint();
    });
    card.querySelector('.tune').onclick = tune;
  }

  async function radios() { try { const d = await (await fetch('/api/strip', { cache: 'no-store' })).json(); R = d.radios || null; } catch (e) {} return R; }
  async function tuneNow() {
    const r = await fetch('/api/listen/tune', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mhz: sel.mhz, demod: 'wfm', squelch: 0, name: sel.call, band: 'fm' }) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
  }
  async function tune() {
    if (busy || !sel) return; const n = $('twN');
    await radios();
    if (R && R.dual && !R.degraded) {
      busy = true; n.textContent = 'Tuning ' + sel.mhz.toFixed(1) + ' on SDR 2…';
      try { await tuneNow(); n.innerHTML = '<b>Playing on SDR 2.</b> SDR 1 keeps tracking aircraft.'; } catch (e) { n.textContent = 'Could not tune: ' + e.message; }
      busy = false; return;
    }
    // one SDR: ask first
    const g = card.querySelector('.tgo');
    g.innerHTML = '<button type="button" class="sw">Switch &amp; Listen ▸</button><button type="button" class="cn">Cancel</button>';
    n.textContent = 'Listening to FM pauses aircraft tracking on 1 SDR';
    g.querySelector('.cn').onclick = () => paint();
    g.querySelector('.sw').onclick = async () => {
      if (busy) return; busy = true; n.textContent = 'Switching to FM…';
      try {
        if (window.sdrMode) await window.sdrMode.set('fm'); else await fetch('/api/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'fm' }) });
        await tuneNow();
        location.href = '/listen';
      } catch (e) { n.textContent = 'Could not switch: ' + e.message; busy = false; }
    };
  }

  function pill() {
    const r = document.querySelector('.m-r'); if (!r || $('mTowers')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'mTowers'; b.className = 'm-pill tw' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = '<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 8 8 21M12 8l4 13M9.3 16.5h5.4"/><circle cx="12" cy="7" r="1.6" fill="currentColor"/><path d="M8 4.5a6 6 0 0 0 0 5M16 4.5a6 6 0 0 1 0 5"/></svg>Towers';
    const all = $('mtShow'); (all && all.parentNode === r) ? all.after(b) : r.appendChild(b);
    b.onclick = () => {
      on = !on; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      if (M && M.map.getLayer('tower')) M.map.setLayoutProperty('tower', 'visibility', on ? 'visible' : 'none');
      if (on) load(); else close();
    };
  }

  pill();
  (function wait(k) {
    const m = window._fieldnoteMap;
    if (m && m.map && m.map.isStyleLoaded && m.map.isStyleLoaded()) { M = m; try { setup(); } catch (e) { console.warn('towers', e); } return; }
    if (m && m.map && k > 20) { m.map.once('idle', () => wait(0)); return; }
    if (k < 240) setTimeout(() => wait(k + 1), 250);
  })(0);
})();
