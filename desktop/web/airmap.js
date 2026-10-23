// Stillwave Trace 1.2.5: dual-SDR extras on the Map page.
//  - listen strip (SDR 2): what plays, signal meter, QUIET / TALKING (squelch), tap ▴ = quick-tune picker, map stays live
//  - airport focus: tap the LAX label (or the KLAX pill) -> zoom, Tower / Ground / Approach / ATIS chooser, planes on approach ringed
//  - degraded notice when a saved radio role is missing
// With one dongle (no roles saved) none of this appears: the map is exactly as before.
(function () {
  'use strict';
  const H = document.documentElement, $ = id => document.getElementById(id);
  const HP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/></svg>';
  const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg>';
  const SQ = [['0', 'Off'], ['20', 'Low'], ['50', 'High']];
  let R = null, LV = null, AP = [], focus = null, group = 'tower', picker = false, busy = false, sqAir = '0';
  const wrap = () => $('mapwrap');
  const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f3 = m => (+m).toFixed(3);

  // ---------- DOM ----------
  let strip, sheet, apf, dgn, apx, apn, kp;
  function build() {
    const w = wrap(); if (!w || strip) return;
    strip = el('div', 'ls hide'); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Airband listen (SDR 2)');
    strip.innerHTML = '<span class="ls-ico">' + HP + '</span><span class="ls-id"><span class="ls-n" id="lsN">—</span><span class="ls-f" id="lsF"></span></span>' +
      '<span class="ls-m" id="lsM" aria-hidden="true">' + '<i></i>'.repeat(6) + '</span><span class="ls-sq" id="lsS">—</span>' +
      '<button type="button" class="ls-go" id="lsGo" aria-label="Pick a frequency" aria-expanded="false">▴</button>';
    w.appendChild(strip);
    strip.querySelectorAll('.ls-m i').forEach((i, k) => i.style.height = (6 + k * 3) + 'px');
    sheet = el('div', 'lsp hide'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Quick tune');
    w.appendChild(sheet);
    apf = el('div', 'apf hide'); w.appendChild(apf);
    dgn = el('div', 'dgn hide'); dgn.setAttribute('role', 'status'); w.appendChild(dgn);
    apx = el('div', 'm-ov apx hide', '<button type="button" class="m-pill on" id="apX">✕ Exit <span id="apXn">KLAX</span></button>'); w.appendChild(apx);
    apn = el('div', 'm-pill apn hide', '<span class="d"></span><span id="apnT">0 on approach</span>'); w.appendChild(apn);
    $('lsGo').onclick = () => { picker = !picker; render(); };
    $('apX').onclick = () => unfocus();
    sheet.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mhz) tune(+b.dataset.mhz, b.dataset.name);
      else if (b.dataset.sq != null) setSq(b.dataset.sq);
      else if (b.dataset.g) { group = b.dataset.g; render(); }
    };
    apf.onclick = e => { const b = e.target.closest('button'); if (!b || !b.dataset.g) return; group = b.dataset.g; const g = grp(); if (g && g.freqs[0]) tune(g.freqs[0].mhz, g.freqs[0].name); render(); };
  }
  // the KLAX pill in the right-hand column (map108 controls) opens airport focus
  function addAirportPill() {
    const col = document.querySelector('.m-r'); if (!col || kp) return;
    kp = el('button', 'm-pill hide', 'KLAX'); kp.type = 'button'; kp.id = 'mKlax'; kp.setAttribute('aria-label', 'Focus on LAX airport');
    kp.onclick = () => focusOn(AP[0]); col.appendChild(kp);
  }

  // ---------- data ----------
  const dual = () => !!(R && R.dual);
  const degraded = () => !!(R && R.degraded);
  function airport() { return focus || AP[0] || null; }
  function grp() { const a = airport(); return a && (a.groups.find(g => g.id === group) || a.groups[0]); }
  async function j(url, opt) { const r = await fetch(url, Object.assign({ cache: 'no-store' }, opt || {})); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status)); return d; }
  async function pollStrip() {
    try { const d = await j('/api/strip'); R = d.radios || null; R && (R.mode = d.mode && d.mode.mode); } catch (e) {}
    render();
  }
  async function pollLevel() {
    if (!dual()) { LV = null; return; }
    try { LV = await j('/api/listen/level'); if (LV.band === 'airband') sqAir = String(LV.squelch); } catch (e) { LV = null; }
    render();
  }
  async function tune(mhz, name) {
    if (busy) return; busy = true; render();
    try {
      await j('/api/listen/tune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mhz, demod: 'am', squelch: +sqAir, name: name || '', band: 'airband' }) });
      picker = false;
    } catch (e) { flash(e.message); }
    busy = false; pollLevel(); render();
  }
  async function setSq(v) {
    sqAir = v; render();
    try { await j('/api/listen/band', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ band: 'airband', squelch: +v }) }); } catch (e) { flash(e.message); }
    pollLevel();
  }
  let flashT = null;
  function flash(t) { const f = $('lsF'); if (!f) return; f.textContent = t; f.classList.add('err'); clearTimeout(flashT); flashT = setTimeout(() => { f.classList.remove('err'); render(); }, 4000); }

  // ---------- render ----------
  function render() {
    if (!strip) return;
    const on = dual(), bad = degraded() && !on;
    H.classList.toggle('dual', on || bad);
    H.classList.toggle('apfocus-any', on && !!focus);
    const missRadio = bad && R.missing.includes('radio');
    // degraded: one saved role is missing -> one-dongle behavior + a notice (map still live)
    dgn.classList.toggle('hide', !bad);
    if (bad) dgn.innerHTML = missRadio ? '<b>Airband radio missing</b><br>Map still live on SDR 1. Plug SDR 2 back in to listen alongside the map.'
      : '<b>Map radio missing</b><br>SDR 2 is doing everything for now. Plug SDR 1 back in for the full-time map.';
    strip.classList.toggle('hide', !(on || bad));
    strip.classList.toggle('bad', bad);
    if (kp) kp.classList.toggle('hide', !on || !!focus);
    if (bad) {
      strip.classList.remove('talk');
      strip.querySelector('.ls-ico').innerHTML = WARN;
      $('lsN').textContent = missRadio ? 'Airband offline' : 'Map radio offline';
      $('lsF').textContent = (missRadio ? 'SDR 2' : 'SDR 1') + ' not found · ' + (missRadio ? 'map OK' : 'shared radio');
      $('lsS').classList.add('hide'); $('lsM').classList.add('hide');
      const g = $('lsGo'); g.textContent = 'Check'; g.setAttribute('aria-label', 'Open Radio roles'); g.onclick = () => { location.href = '/dongles'; };
      sheet.classList.add('hide'); apf.classList.add('hide'); H.classList.remove('picker');
      return;
    }
    if (!on) { sheet.classList.add('hide'); apf.classList.add('hide'); H.classList.remove('picker', 'apfocus'); return; }
    strip.querySelector('.ls-ico').innerHTML = HP;
    $('lsS').classList.remove('hide'); $('lsM').classList.remove('hide');
    const g = $('lsGo'); g.textContent = picker ? '▾' : '▴'; g.setAttribute('aria-expanded', picker); g.setAttribute('aria-label', picker ? 'Close' : 'Pick a frequency');
    g.onclick = () => { picker = !picker; render(); };
    const air = LV && LV.live && LV.demod !== 'wfm';
    const mhz = LV && parseFloat(String(LV.frequency).replace(/[^0-9.]/g, ''));
    if (busy) { $('lsN').textContent = 'Tuning…'; }
    else if (air) { $('lsN').textContent = LV.name || f3(mhz) + ' MHz'; }
    else if (LV && LV.live) { $('lsN').textContent = LV.name || 'FM radio'; }
    else { $('lsN').textContent = R.mode && R.mode !== 'fm' && R.mode !== 'adsb' && R.mode !== 'none' ? 'SDR 2 · ' + R.mode : 'SDR 2 ready'; }
    if (!$('lsF').classList.contains('err'))
      $('lsF').textContent = air ? f3(mhz) + ' MHz ' + (LV.demod === 'am' ? 'AM' : 'NFM') + ' · SDR 2' + (focus ? ' · ' + focus.icao : '') : (LV && LV.live ? 'Broadcast FM · SDR 2' : 'Tap ▴ to listen to the tower');
    const st = LV && LV.state, talk = st === 'talking';
    strip.classList.toggle('talk', talk);
    const s = $('lsS'); s.textContent = talk ? '● Talking' : st === 'quiet' ? 'Quiet' : st === 'squelch_off' ? 'Squelch off' : 'Idle';
    const bars = LV && typeof LV.db === 'number' ? Math.max(0, Math.min(6, Math.round((LV.db + 60) / 8))) : 0;
    strip.querySelectorAll('.ls-m i').forEach((i, k) => i.classList.toggle('on', k < bars));
    // airport chooser (focus) and quick-tune sheet
    const a = airport();
    apf.classList.toggle('hide', !focus || picker);
    H.classList.toggle('apfocus', !!focus && !picker);
    if (focus) {
      apf.innerHTML = '<div class="apf-h"><b>' + esc(focus.icao) + '</b><span>' + esc(focus.name) + ' · tap to tune</span></div><div class="m-seg">' +
        focus.groups.map(x => '<button type="button" class="m-pill' + (x.id === group ? ' on' : '') + '" data-g="' + esc(x.id) + '">' + esc(x.label) + '</button>').join('') + '</div>';
      requestAnimationFrame(() => H.style.setProperty('--apf-h', apf.offsetHeight + 'px'));
    }
    sheet.classList.toggle('hide', !picker);
    H.classList.toggle('picker', picker);
    if (picker && a) {
      const cur = air ? mhz : null, gg = grp();
      sheet.innerHTML = '<div class="lsp-h"><span><b>// Quick tune</b> · map stays live</span><span>' + esc(a.icao) + '</span></div>' +
        '<div class="m-seg lsp-tabs">' + a.groups.map(x => '<button type="button" class="m-pill' + (x.id === gg.id ? ' on' : '') + '" data-g="' + esc(x.id) + '">' + esc(x.label) + '</button>').join('') + '</div>' +
        '<div class="lsp-g">' + gg.freqs.map(f => '<button type="button" data-mhz="' + f.mhz + '" data-name="' + esc(f.name) + '" class="' + (cur && Math.abs(cur - f.mhz) < 0.002 ? 'on' : '') + '"><b>' + f3(f.mhz) + '</b><span>' + esc(f.name.replace(/^LAX /, '')) + '</span></button>').join('') + '</div>' +
        '<div class="lsp-sq"><span>Squelch</span><span class="m-seg">' + SQ.map(([v, t]) => '<button type="button" class="m-pill' + (v === sqAir ? ' on' : '') + '" data-sq="' + v + '">' + t + '</button>').join('') + '</span></div>' +
        '<p class="lsp-n">Squelch Low or High shows Quiet / Talking. Off plays the hiss between calls.</p>';
    }
  }

  // ---------- airport focus ----------
  function M() { return window._fieldnoteMap; }
  function focusOn(a) {
    const m = M(); if (!a || !m || !m.map || !dual()) return;
    focus = a; group = 'tower'; picker = false;
    $('apXn').textContent = a.icao; apx.classList.remove('hide'); apn.classList.remove('hide');
    m.follow = false; m.map.easeTo({ center: [a.lon, a.lat], zoom: Math.max(a.zoom || 11, m.map.getZoom()), duration: 700 });
    markApproach(); render();
  }
  function unfocus() {
    focus = null; apx.classList.add('hide'); apn.classList.add('hide');
    const m = M(); if (m && m.map && m.map.getSource('apr')) m.map.getSource('apr').setData({ type: 'FeatureCollection', features: [] });
    render();
  }
  function nm(lat1, lon1, lat2, lon2) { const r = Math.PI / 180, x = (lon2 - lon1) * r * Math.cos((lat1 + lat2) / 2 * r), y = (lat2 - lat1) * r; return Math.sqrt(x * x + y * y) * 3440.065; }
  function brg(lat1, lon1, lat2, lon2) { const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r), x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  const angd = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  function onApproach(p, a) {
    // within 20 nm, below 7,000 ft, heading toward the field (track within 25° of the bearing to it), aligned with a runway, not climbing
    const x = p.a; if (x.lat == null || typeof x.alt !== 'number' || typeof x.track !== 'number') return false;
    const d = nm(x.lat, x.lon, a.lat, a.lon); if (d > 20 || d < 0.3 || x.alt > 7000) return false;
    if (typeof x.vr === 'number' && x.vr > 300) return false;
    const toField = brg(x.lat, x.lon, a.lat, a.lon);
    if (angd(x.track, toField) > 25) return false;
    return (a.runways_deg || []).some(rw => angd(x.track, rw) < 20);
  }
  function markApproach() {
    const m = M(); if (!m || !m.map || !focus || !m.ready) return;
    const mp = m.map;
    if (!mp.getSource('apr')) {
      mp.addSource('apr', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      mp.addLayer({ id: 'apr', type: 'circle', source: 'apr', paint: { 'circle-radius': 22, 'circle-color': 'rgba(245,165,36,0.12)', 'circle-stroke-color': '#f5a524', 'circle-stroke-width': 2 } }, 'ac');
    }
    const feats = []; for (const p of m.planes.values()) if (onApproach(p, focus)) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.a.lon, p.a.lat] } });
    mp.getSource('apr').setData({ type: 'FeatureCollection', features: feats });
    $('apnT').textContent = feats.length + ' on approach';
  }
  function hookMap() {
    const m = M(); if (!m || !m.map || !m.ready) return setTimeout(hookMap, 500);
    const up = m.update.bind(m);
    m.update = function (list, now) { const r = up(list, now); try { if (focus) markApproach(); } catch (e) {} return r; };
    m.map.on('click', 'lax', () => { if (dual()) focusOn(AP[0]); });
    m.map.on('mouseenter', 'lax', () => { if (dual()) m.map.getCanvas().style.cursor = 'pointer'; });
    m.map.on('mouseleave', 'lax', () => { m.map.getCanvas().style.cursor = ''; });
    addAirportPill(); render();
  }

  async function start() {
    build();
    try { AP = (await j('/api/airports')).airports || []; } catch (e) { AP = []; }
    hookMap(); pollStrip(); setInterval(pollStrip, 5000);
    setInterval(() => { if (!document.hidden) pollLevel(); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.traceAirmap = { focus: icao => focusOn(AP.find(a => a.icao === icao) || AP[0]), unfocus, render };
})();
