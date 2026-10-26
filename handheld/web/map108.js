// Trace 1.0.8: full-page ADS-B map. The page chrome becomes floating overlays (count chip, MAP/LIST, fullscreen,
// CENTER LAX / CENTER ME / RINGS / LABELS pills, slim altitude legend). Fullscreen hides the shell's strip + nav.
(function () {
  const H = document.documentElement, $ = id => document.getElementById(id);
  H.classList.add('m108');
  const wrap = $('mapwrap');
  const pill = (txt, id, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'm-pill' + (cls ? ' ' + cls : ''); if (id) b.id = id; b.innerHTML = txt; return b; };
  const tl = document.createElement('div'); tl.className = 'm-ov m-tl';
  const cnt = document.createElement('div'); cnt.className = 'm-pill m-count'; cnt.innerHTML = '<span class="d"></span><span id="mCnt">— aircraft</span>'; tl.appendChild(cnt);
  const tr = document.createElement('div'); tr.className = 'm-ov m-tr';
  const seg = document.createElement('div'); seg.className = 'm-seg';
  const pm = pill('Map', 'mMap', 'on'), pl = pill('List', 'mList'); seg.append(pm, pl);
  pm.onclick = () => $('vMap').click(); pl.onclick = () => $('vList').click();
  const fs = pill('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', 'mFs', 'm-fs');
  fs.title = 'Full screen'; fs.onclick = () => { const on = !H.classList.contains('mapfs'); H.classList.toggle('mapfs', on); try { if (H.classList.contains('embed')) window.parent.document.documentElement.classList.toggle('mapfs', on); } catch (e) {} fs.classList.toggle('on', on); fs.title = on ? 'Show the status bar and menu' : 'Full screen'; layout(); };
  tr.append(seg, fs);
  const r = document.createElement('div'); r.className = 'm-ov m-r';
  const map = { cLax: 'Center LAX', cMe: 'Center me', tRings: 'Rings <span id="mRingsV">3</span>', tLabels: 'Labels' };
  for (const [id, t] of Object.entries(map)) {
    const p = pill(t, 'm' + id, $(id).classList.contains('on') ? 'on' : ''); p.onclick = () => { $(id).click(); sync(); }; r.appendChild(p);
  }
  // 1.3.1 AIS: All / Aircraft / Boats pill, shown once a boat has been heard (mirrors #tShow)
  const ps = pill('All', 'mtShow', ''); ps.onclick = () => { $('tShow').click(); syncShow(); }; r.appendChild(ps);
  function syncShow() { const t = $('tShow'); if (!t) { ps.hidden = true; return; } ps.hidden = t.classList.contains('hide'); ps.textContent = t.textContent; ps.classList.toggle('on', t.classList.contains('on')); }
  if ($('tShow')) new MutationObserver(syncShow).observe($('tShow'), { attributes: true, childList: true, characterData: true, subtree: true });
  syncShow();
  const leg = document.createElement('div'); leg.className = 'm-leg';
  const cols = ['#5f7a68','#1c6b3c','#26904f','#33b866','#4ade80','#97f0b8','#c8f8d9','#f4fff7'], labs = ['GND','<1K','1–3K','3–6K','6–10K','10–20K','20–30K','30K+'];
  leg.innerHTML = '<span class="lk">// ALT FT</span><span class="bars">' + cols.map((c, i) => '<span><i style="background:' + c + '"></i><b>' + labs[i] + '</b></span>').join('') + '</span>';
  // 1.2.0: ADS-B gain stepper (- / value / + / Auto), saved to ADSB_GAIN; the decoder restarts, the count chip stays live
  const gb = document.createElement('div'); gb.className = 'm-ov m-gain'; gb.setAttribute('aria-label', 'ADS-B gain');
  gb.innerHTML = '<span class="m-gk">// GAIN</span>';
  const gm = pill('−', 'mGainDn', 'm-gstep'), gv = document.createElement('span'), gp = pill('+', 'mGainUp', 'm-gstep'), ga = pill('Auto', 'mGainAuto');
  gv.className = 'm-pill m-gv'; gv.id = 'mGainV'; gv.textContent = '—'; gm.setAttribute('aria-label', 'Less gain'); gp.setAttribute('aria-label', 'More gain');
  gb.append(gm, gv, gp, ga);
  let gainBusy = false;
  function paintGain(g) { const auto = g === 'auto'; gv.textContent = auto ? 'AUTO' : g + ' dB'; ga.classList.toggle('on', auto); ga.textContent = auto ? 'Manual' : 'Auto'; }   // 1.2.1: the value pill already says AUTO; the button now offers the other choice
  async function gainCall(body) {
    if (gainBusy) return; gainBusy = true; gb.classList.add('busy');
    try {
      const r = await fetch('/api/adsb/gain', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
      const j = await r.json(); if (j && j.ok) paintGain(j.gain); else if (j && j.error) gv.title = j.error;
    } catch (e) {} finally { gainBusy = false; gb.classList.remove('busy'); }
  }
  gm.onclick = () => gainCall({ step: -1 }); gp.onclick = () => gainCall({ step: 1 });
  ga.onclick = () => gainCall({ gain: ga.classList.contains('on') ? 38.6 : 'auto' });
  gainCall(null);
  wrap.append(tl, tr, r, gb, leg);
  function sync() {
    const s = $('summary').textContent, m = s.match(/(\d+) aircraft/); $('mCnt').textContent = m ? m[1] + ' aircraft' + (innerWidth > 600 ? ' · ' + (s.match(/(\d+) on map/) || [0, '?'])[1] + ' on map' : '') : s;
    ['tRings', 'tLabels'].forEach(id => $('m' + id).classList.toggle('on', $(id).classList.contains('on')));
    $('mRingsV').textContent = $('tRingsV').textContent;
    const lv = !$('listview').classList.contains('hide'); pm.classList.toggle('on', !lv); pl.classList.toggle('on', lv);
    H.classList.toggle('m108', !lv);
  }
  new MutationObserver(sync).observe($('summary'), { childList: true, characterData: true, subtree: true });
  function layout() {
    const st = $('qstrip'), tb = $('qtabs'), side = tb && getComputedStyle(tb).flexDirection === 'column', vis = e => e && getComputedStyle(e).display !== 'none';
    H.style.setProperty('--m-t', (vis(st) ? st.offsetHeight : 0) + 'px');
    H.style.setProperty('--m-b', (!side && vis(tb) ? tb.offsetHeight : 0) + 'px');
    H.style.setProperty('--m-l', (side && vis(tb) ? tb.offsetWidth : 0) + 'px');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }
  window.addEventListener('load', layout); setTimeout(layout, 300); setTimeout(sync, 1500);
})();
