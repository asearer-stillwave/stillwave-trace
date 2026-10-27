// Stillwave Trace dongle mode (1.0.8: START screen per tab, no mode row).
// Load /mode.js on a page; <body data-mode="fm|spectrum|adsb"> ties the page to a mode. (Page navigation is the tab bar in nav.js.)
// One RTL-SDR: Listen (FM), Spectrum and ADS-B take turns owning it.
(function(){
  // Kiosk flag for the Trace display: /?kiosk=1 sets it (kiosk=0 clears), then it sticks
  // for this browser profile so every page hides the pointer.
  try {
    const q = new URLSearchParams(location.search).get('kiosk');
    if (q === '1') localStorage.setItem('fieldnoteKiosk', '1');
    if (q === '0') localStorage.removeItem('fieldnoteKiosk');
    if (localStorage.getItem('fieldnoteKiosk') === '1') {
      document.documentElement.classList.add('kiosk');
      const bodyKiosk = () => document.body && document.body.classList.add('kiosk');
      if (document.body) bodyKiosk(); else document.addEventListener('DOMContentLoaded', bodyKiosk);
    }
  } catch(e) {}
  const MODES = [
    {id:'fm', label:'FM radio', page:'/listen', start:'Start listening', tab:'Listen'},
    {id:'spectrum', label:'Spectrum', page:'/spectrum', start:'Start spectrum', tab:'Spectrum'},
    {id:'adsb', label:'ADS-B', page:'/adsb', start:'Start map', tab:'Map'}
  ];
  // 1.0.8: no SDR MODE row. Each tab belongs to one dongle mode (<body data-mode="...">). When the dongle is doing
  // something else the page shows the START screen (mode line + big START button). Opening a tab never switches.
  const PAGE_MODE = document.body && document.body.dataset.mode;
  const NAMES = {fm:'FM', spectrum:'SPECTRUM', adsb:'ADS-B', none:'NO', unknown:'UNKNOWN'};
  let gate = null;
  function gateRender(s){
    if(!PAGE_MODE) return;
    const m = MODES.find(x => x.id === PAGE_MODE);
    // 1.0.9: SDR OFF (safe to swap antenna) and "no radio detected" take over every mode page; in dual-dongle mode the
    // map has its own dongle (adsb_live), so the Map tab is never gated by the radio's mode.
    const isOff = !!(s && s.off), noRadio = !!(s && s.dongles === 0 && !isOff);
    const live = PAGE_MODE === 'adsb' && s && s.adsb_live && s.dual;
    const off = isOff || noRadio || (!live && !!(s && s.mode && s.mode !== PAGE_MODE));
    document.documentElement.classList.toggle('gated', off);
    if(!off){ if(gate) gate.hidden = true; return; }
    if(!gate){
      gate = document.createElement('div'); gate.className = 'v-gate'; gate.setAttribute('role', 'region'); gate.setAttribute('aria-label', 'Start ' + m.label);
      gate.innerHTML = '<div class="card v-start"><div class="v-ico" id="vgI" aria-hidden="true" hidden><svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15.5v-1.8l-7.5-4.6V4a1.5 1.5 0 0 0-3 0v5.1L3 13.7v1.8l7.5-2.3v4.6l-2 1.5V21l3.5-1 3.5 1v-1.7l-2-1.5v-4.6z"/></svg></div><div class="k" id="vgK"></div><button type="button" class="primary" id="vgGo"></button><p class="tiny" id="vgN"></p></div>';
      document.body.appendChild(gate);
      gate.querySelector('#vgGo').onclick = () => (state && state.off ? power(true) : set(PAGE_MODE, false, true)).catch(() => {});
      if(PAGE_MODE === 'adsb' && s && !s.adsb_available){ gate.querySelector('#vgGo').disabled = true; }
    }
    gate.hidden = false;
    gate.classList.toggle('v-off', isOff); gate.classList.toggle('v-noradio', noRadio);
    if(isOff){
      gate.querySelector('#vgK').textContent = '// SDR IS OFF · SAFE TO SWAP ANTENNA';
      gate.querySelector('#vgGo').textContent = 'Turn SDR on';
      gate.querySelector('#vgN').textContent = 'The dongle is released. Turning it on resumes ' + (NAMES[s.resume] || 'the last mode') + '.';
      return;
    }
    if(noRadio){
      gate.querySelector('#vgK').textContent = '// NO RADIO DETECTED';
      gate.querySelector('#vgGo').textContent = 'Try again';
      gate.querySelector('#vgN').textContent = 'No SDR dongle on USB. Check it is plugged in (try another USB port), then tap Try again. Still nothing: Settings > Reset SDR USB.';
      return;
    }
    if(s.mode === 'none'){   // 1.2.0 boot idle: radio + map idle until START
      gate.classList.add('v-idle'); gate.querySelector('#vgI').hidden = PAGE_MODE !== 'adsb';
      gate.querySelector('#vgK').textContent = '// ' + m.label.toUpperCase() + ' · IDLE';
      gate.querySelector('#vgGo').textContent = PAGE_MODE === 'adsb' ? '▶ START' : '▶ ' + m.start;
      gate.querySelector('#vgN').textContent = PAGE_MODE === 'adsb' ? 'Radio and map are idle. Nothing tunes or loads until you tap START. Or pick another tab to listen.' : 'Nothing is running yet. Tap to start.';
      return;
    }
    gate.classList.remove('v-idle'); gate.querySelector('#vgI').hidden = true;
    const cur = MODES.find(x => x.id === s.mode);
    gate.querySelector('#vgK').textContent = '// DONGLE IS IN ' + (NAMES[s.mode] || String(s.mode).toUpperCase()) + ' MODE';
    gate.querySelector('#vgGo').textContent = m.start;
    let what = cur ? cur.label : 'it';
    try { const st = window.fieldnoteStrip && window.fieldnoteStrip.get(); if(s.mode === 'fm' && st && st.metric && st.metric.name) what = 'FM (' + st.metric.name + ')'; } catch(e) {}
    gate.querySelector('#vgN').textContent = cur ? 'Stops ' + what + ' until you go back to ' + cur.tab + '.' : '';
  }
  let state = null;
  function say(t, err){ const g = document.getElementById('vgN'); if(g && t) { g.textContent = t; g.classList.toggle('err', !!err); } }
  function render(s){
    state = s;
    gateRender(s);
    document.dispatchEvent(new CustomEvent('sdr-mode', {detail: s}));
  }
  async function jfetch(url, opt){
    const r = await fetch(url, Object.assign({cache:'no-store'}, opt || {}));
    const t = await r.text();
    let j = {}; try { j = JSON.parse(t); } catch(e) { j = {error: t || r.statusText}; }
    if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  async function refresh(){
    try { render(await jfetch('/api/mode')); say(''); }
    catch(e){ /* strip shows the dash */ }
    return state;
  }
  async function power(on){
    const gb = document.getElementById('vgGo'); if(gb) gb.disabled = true;
    say(on ? 'Turning the SDR on…' : 'Stopping the SDR…');
    try {
      const s = await jfetch('/api/sdr/power', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({on: !!on})});
      render(s); return s;
    } catch(e){ say(e.message, true); await refresh(); throw e; }
    finally { const gb2 = document.getElementById('vgGo'); if(gb2) gb2.disabled = false; }
  }
  async function set(mode, navigate, force){
    const m = MODES.find(x => x.id === mode);
    if(state && state.mode === mode && !force){
      return state;
    }
    const gb = document.getElementById('vgGo'); if(gb) gb.disabled = true;
    say('Switching to ' + (m ? m.label : mode) + '…');
    document.dispatchEvent(new CustomEvent('sdr-mode-busy', {detail: {to: mode}}));
    try {
      const s = await jfetch('/api/mode', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({mode})});
      render(s);
      return s;
    } catch(e){
      say(e.message, true);
      await refresh();
      throw e;
    } finally {
      const gb2 = document.getElementById('vgGo'); if(gb2) gb2.disabled = false;
      if(state) render(state);
    }
  }
  window.sdrMode = {refresh, set, power, get: () => state};
  refresh();
  setInterval(refresh, 20000);
})();
