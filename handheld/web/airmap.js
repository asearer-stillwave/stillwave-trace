// Stillwave Trace 1.2.5: dual-SDR extras on the Map page.
//  - listen strip (SDR 2): what plays, signal meter, QUIET / TALKING (squelch), tap ▴ = quick-tune picker, map stays live
//  - 1.3.2: 'ICAO ▾' follows the map (nearest airport to the map center, /api/airports?lat=&lon=)
//  - airport focus: tap the LAX label (or the ICAO button) -> zoom, Tower / Ground / Approach / ATIS chooser, planes on approach ringed
//  - degraded notice when a saved radio role is missing
// With one dongle (no roles saved) none of this appears: the map is exactly as before.
(function () {
  'use strict';
  const H = document.documentElement, $ = id => document.getElementById(id);
  const HP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/></svg>';
  const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg>';
  const SQ = [['0', 'Off'], ['20', 'Low'], ['50', 'High']];
  const GN = [['20', '20'], ['30', '30'], ['40', '40'], ['49.6', 'Max']];   // 1.3.4: airband gain steps, same as the Listen page
  let R = null, LV = null, AP = [], focus = null, group = 'tower', picker = false, busy = false, sqAir = '0', gnAir = '40', openRow = null;   // 1.3.4: openRow = 'g' | 's' (GAIN / SQ chip expanded)
  const wrap = () => $('mapwrap');
  const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f3 = m => (+m).toFixed(3);

  // ---------- DOM ----------
  let strip, sheet, apf, dgn, apx, apn, kp, qtn, qtnT = null;
  // 1.3.4: one radio (or roles not set): tapping the airport shows this for 8 s (degraded already has its own notice)
  function twoRadios() { if (!qtn || degraded()) return; qtn.classList.remove('hide'); clearTimeout(qtnT); qtnT = setTimeout(() => qtn.classList.add('hide'), 8000); }
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
    qtn = el('div', 'qtn hide', '<span><b>Set up two radios for quick tune</b><br>One radio runs the map, the other listens to the tower.</span><a class="m-pill on" href="/dongles">Radio roles ›</a>');
    qtn.setAttribute('role', 'status'); w.appendChild(qtn);
    dgn = el('div', 'dgn hide'); dgn.setAttribute('role', 'status'); w.appendChild(dgn);
    apx = el('div', 'm-ov apx hide', '<button type="button" class="m-pill on" id="apX">✕ Exit <span id="apXn">KLAX</span></button>'); w.appendChild(apx);
    apn = el('div', 'm-pill apn hide', '<span class="d"></span><span id="apnT">0 on approach</span>'); w.appendChild(apn);
    $('lsGo').onclick = () => { picker = !picker; render(); };
    $('apX').onclick = () => unfocus();
    sheet.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mhz) tune(+b.dataset.mhz, b.dataset.name);
      else if (b.dataset.sq != null) setSq(b.dataset.sq);
      else if (b.dataset.gn != null) setGain(b.dataset.gn);
      else if (b.dataset.row) { openRow = openRow === b.dataset.row ? null : b.dataset.row; render(); }
      else if (b.dataset.g) { group = b.dataset.g; render(); }
    };
    apf.onclick = e => { const b = e.target.closest('button'); if (!b || !b.dataset.g) return; group = b.dataset.g; const g = grp(); if (g && g.freqs[0]) tune(g.freqs[0].mhz, g.freqs[0].name); render(); };
  }
  // 1.3.2: the 'ICAO ▾' button replaces CENTER LAX (and the 1.2.5 KLAX pill). It follows the map: the airport nearest the
  // map center. Tap the code = center on it (with two radios: airport focus); tap ▾ = nearby airports with distances.
  let NEAR = [], ddOpen = false, ddAnchor = null, nearT = 0, nearSeq = 0;
  const SHORT = { tower: 'TWR', ground: 'GND', approach: 'APP', atis: 'ATIS', clearance: 'CLR', ctaf: 'CTAF', unicom: 'UNIC' };
  function addAirportPill() {
    const old = $('mcLax'); if (kp || !old) return;
    kp = el('div', 'apb'); kp.id = 'apB';
    kp.innerHTML = '<button type="button" class="m-pill on apb-c" id="apBc" aria-label="Center on the airport">' + esc(curIcao()) + '</button>' +
      '<button type="button" class="m-pill on apb-d" id="apBd" aria-label="Nearby airports" aria-expanded="false">▾</button>';
    old.replaceWith(kp);
    const dd = el('div', 'apdd hide'); dd.id = 'apDD'; dd.setAttribute('role', 'listbox'); wrap().appendChild(dd);
    $('apBc').onclick = () => centerCur();
    $('apBd').onclick = e => { e.stopPropagation(); ddAnchor = $('apBd'); ddOpen = !ddOpen; paintDD(); };
    $('apDD').onclick = e => { const b = e.target.closest('button[data-i]'); if (!b) return; ddOpen = false; paintDD(); pick(b.dataset.i); };
    document.addEventListener('click', e => { if (ddOpen && !kp.contains(e.target) && !$('apDD').contains(e.target) && !(sheet && sheet.contains(e.target))) { ddOpen = false; paintDD(); } });
  }
  function curIcao() { const a = AP[0]; return a ? a.icao : '—'; }
  function paintBtn() { const c = $('apBc'); if (c) c.textContent = curIcao(); const h = $('lspAp'); if (h) h.textContent = curIcao() + ' ▾'; }
  function paintDD() {
    const d = $('apDD'); if (!d) return;
    $('apBd').setAttribute('aria-expanded', ddOpen); d.classList.toggle('hide', !ddOpen);
    const cur = curIcao();
    d.innerHTML = '<div class="apdd-h">Near map center</div>' + (NEAR.length ? NEAR.map(a => '<button type="button" data-i="' + esc(a.icao) + '" class="' + (a.icao === cur ? 'on' : '') + '"><span>' + esc(a.icao) + '</span><small>' +
      (a.icao === cur && a.nm < 1 ? 'centered' : Math.round(a.nm) + ' nm') + '</small></button>').join('') : '<div class="apdd-e">No airports within 60 nm</div>');
    if (ddOpen && ddAnchor) {   // anchored under whichever ICAO ▾ opened it (map column or Quick Tune header)
      const w = wrap().getBoundingClientRect(), r = ddAnchor.getBoundingClientRect(), below = r.bottom - w.top + 6;
      d.style.right = Math.max(8, w.right - r.right) + 'px';
      if (below + d.offsetHeight > w.height - 8) { d.style.top = ''; d.style.bottom = (w.bottom - r.top + 6) + 'px'; } else { d.style.bottom = ''; d.style.top = below + 'px'; }
    }
  }
  async function load(icao) {
    let a = AP.find(x => x.icao === icao) || cache[icao];
    if (!a) { try { a = ((await j('/api/airports?id=' + encodeURIComponent(icao))).airports || [])[0]; } catch (e) { a = null; } }
    if (a) cache[icao] = a;
    return a || null;
  }
  const cache = {};
  async function pick(icao) { const a = await load(icao); if (!a) return; setCur(a); centerCur(); }
  function setCur(a) { if (!a || (AP[0] && AP[0].icao === a.icao)) return; AP = [a]; if (!focus) group = 'tower'; paintBtn(); paintDD(); render(); }
  function centerCur() {
    const a = AP[0], m = M(); if (!a || !m || !m.map) return;
    if (dual() && a.groups && a.groups.length) return focusOn(a);
    if (!dual()) twoRadios();   // 1.3.4: say why there is no Quick Tune instead of doing nothing
    m.follow = false; m.map.easeTo({ center: [a.lon, a.lat], zoom: Math.max(m.map.getZoom(), a.zoom ? a.zoom - 1.5 : 9.5), duration: 600 });
  }
  function followMap() {
    clearTimeout(nearT);
    nearT = setTimeout(async () => {
      const m = M(); if (!m || !m.map || focus) return;
      const c = m.map.getCenter(), seq = ++nearSeq;
      let d; try { d = await j('/api/airports?lat=' + c.lat.toFixed(4) + '&lon=' + c.lng.toFixed(4) + '&n=5'); } catch (e) { return; }
      if (seq !== nearSeq || !d || !d.near) return;
      NEAR = d.near; paintDD();
      if (NEAR[0]) { const a = await load(NEAR[0].icao); if (seq === nearSeq && a) setCur(a); }
    }, 500);
  }

  // ---------- data ----------
  const dual = () => !!(R && R.dual);
  const degraded = () => !!(R && R.degraded);
  function airport() { return focus || AP[0] || null; }
  function grp() { const a = airport(); return a && a.groups && (a.groups.find(g => g.id === group) || a.groups[0]); }
  async function j(url, opt) { const r = await fetch(url, Object.assign({ cache: 'no-store' }, opt || {})); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status)); return d; }
  async function pollStrip() {
    try { const d = await j('/api/strip'); R = d.radios || null; R && (R.mode = d.mode && d.mode.mode); } catch (e) {}
    render();
  }
  async function pollLevel() {
    if (!dual()) { LV = null; return; }
    try { LV = await j('/api/listen/level'); if (LV.band === 'airband') sqAir = String(LV.squelch); if (LV.air_gain != null && !busyGain) gnAir = String(parseFloat(LV.air_gain)); } catch (e) { LV = null; }
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
  let busyGain = false;
  async function setGain(v) {   // 1.3.4: Quick Tune GAIN chip, applies live (same API as the Listen gear)
    gnAir = v; openRow = null; busyGain = true; render();
    try { await j('/api/listen/band', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ band: 'airband', gain: +v }) }); } catch (e) { flash(e.message); }
    busyGain = false; pollLevel();
  }
  async function setSq(v) {
    sqAir = v; openRow = null; render();
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
        focus.groups.map(x => '<button type="button" class="m-pill' + (x.id === group ? ' on' : '') + '" data-g="' + esc(x.id) + '">' + esc(SHORT[x.id] || x.label) + '</button>').join('') + '</div>';
      requestAnimationFrame(() => H.style.setProperty('--apf-h', apf.offsetHeight + 'px'));
    }
    sheet.classList.toggle('hide', !picker);
    H.classList.toggle('picker', picker);
    if (picker && a) {
      const cur = air ? mhz : null, gg = grp();
      const sqT = (SQ.find(([v]) => v === sqAir) || [0, sqAir])[1], gnT = (GN.find(([v]) => v === gnAir) || [0, gnAir])[1];
      const chip = (k, lab, val) => '<button type="button" class="m-pill qchip' + (openRow === k ? ' on' : '') + '" data-row="' + k + '" aria-expanded="' + (openRow === k) + '">' + lab + ' <b>' + esc(val) + '</b> ' + (openRow === k ? '▴' : '▾') + '</button>';
      const hd = '<div class="lsp-h"><span class="lsp-t"><b>// Quick tune</b> · ' + (focus ? 'map stays live' : 'follows the map') + '</span><span class="qrow">' +
        (gg ? chip('g', 'Gain', gnT) + chip('s', 'SQ', sqT) : '') + '<button type="button" class="m-pill on lsp-ap" id="lspAp" aria-label="Nearby airports">' + esc(a.icao) + ' ▾</button></span></div>';
      if (!gg) {   // 1.3.2: no published frequencies -> no Quick Tune (never invented)
        sheet.innerHTML = hd + '<p class="lsp-n lsp-none">No published tower, ground, approach or ATIS frequencies for ' + esc(a.icao) + ' in the station bank. Quick Tune is off here.</p>';
        $('lspAp').onclick = e => { e.stopPropagation(); ddAnchor = $('lspAp'); ddOpen = !ddOpen; paintDD(); };
        return;
      }
      sheet.innerHTML = hd +
        '<div class="m-seg lsp-tabs">' + a.groups.map(x => '<button type="button" class="m-pill' + (x.id === gg.id ? ' on' : '') + '" data-g="' + esc(x.id) + '">' + esc(SHORT[x.id] || x.label) + '</button>').join('') + '</div>' +
        '<div class="lsp-g">' + gg.freqs.map(f => '<button type="button" data-mhz="' + f.mhz + '" data-name="' + esc(f.name) + '" class="' + (cur && Math.abs(cur - f.mhz) < 0.002 ? 'on' : '') + '"><b>' + f3(f.mhz) + '</b><span>' + esc(f.tag || f.name.replace(new RegExp('^(' + a.icao + '|' + a.icao.replace(/^K/, '') + ') '), '')) + '</span></button>').join('') + '</div>' +
        (openRow === 'g' ? '<div class="lsp-sq"><span>Gain</span><span class="m-seg">' + GN.map(([v, t]) => '<button type="button" class="m-pill' + (v === gnAir ? ' on' : '') + '" data-gn="' + v + '">' + t + '</button>').join('') + '</span></div>' : '') +
        (openRow === 's' ? '<div class="lsp-sq"><span>Squelch</span><span class="m-seg">' + SQ.map(([v, t]) => '<button type="button" class="m-pill' + (v === sqAir ? ' on' : '') + '" data-sq="' + v + '">' + t + '</button>').join('') + '</span></div>' : '') +
        '<p class="lsp-n">' + esc(a.name) + ' · ' + (focus ? 'focused' : 'follows the map') + ' · ' + (a.source === 'ourairports' ? 'OurAirports' : 'FAA') + '</p>';
      $('lspAp').onclick = e => { e.stopPropagation(); ddAnchor = $('lspAp'); ddOpen = !ddOpen; paintDD(); };
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
    m.map.on('click', 'lax', () => { if (dual()) load('KLAX').then(a => a && focusOn(a)); else twoRadios(); });
    m.map.on('mouseenter', 'lax', () => { if (dual()) m.map.getCanvas().style.cursor = 'pointer'; });
    m.map.on('mouseleave', 'lax', () => { m.map.getCanvas().style.cursor = ''; });
    addAirportPill(); m.map.on('moveend', followMap); followMap(); render();
  }

  async function start() {
    build();
    // 1.2.6: KLAX from the station bank (FAA runway headings) when installed, else the built-in file
    try { AP = (await j('/api/airports?id=KLAX')).airports || []; } catch (e) { AP = []; }
    hookMap(); pollStrip(); setInterval(pollStrip, 5000);
    setInterval(() => { if (!document.hidden) pollLevel(); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // 1.2.6: any US airport (Stations > airport > Focus on map, or traceAirmap.focus('KBUR')).
  // With one radio the map just flies there (no tuning); with two it opens the full airport focus.
  async function focusIcao(icao) {
    let a = AP.find(x => x.icao === icao);
    if (!a) { try { a = ((await j('/api/airports?id=' + encodeURIComponent(icao))).airports || [])[0]; } catch (e) { a = null; } }
    if (!a) return;
    cache[a.icao] = a; setCur(a);
    const m = M();
    if (dual()) focusOn(a);
    else if (m && m.map) { m.follow = false; m.map.easeTo({ center: [a.lon, a.lat], zoom: Math.max(a.zoom || 11, 10.5), duration: 700 }); }
  }
  function handoff() {
    // other pages leave a request in localStorage (Stations: traceFocusAirport, My maps: traceMapGoto)
    let f = null, g = null;
    try { f = localStorage.getItem('traceFocusAirport'); g = localStorage.getItem('traceMapGoto'); } catch (e) {}
    const m = M(); if (!m || !m.map || !m.ready) return;
    if (f) { try { localStorage.removeItem('traceFocusAirport'); } catch (e) {} focusIcao(f); }
    if (g) {
      try { localStorage.removeItem('traceMapGoto'); const v = JSON.parse(g); m.follow = false; m.map.easeTo({ center: v.center, zoom: v.zoom || 9, duration: 700 }); } catch (e) {}
    }
  }
  window.addEventListener('storage', e => { if (e.key === 'traceFocusAirport' || e.key === 'traceMapGoto') handoff(); if (e.key === 'traceMapsChanged') location.reload(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) handoff(); });
  setInterval(handoff, 1500);
  window.traceAirmap = { focus: icao => focusIcao(icao || 'KLAX'), unfocus, render };
})();
