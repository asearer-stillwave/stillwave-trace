// Stillwave Trace 1.0.8: single-load app. "/" is the shell (app.html): status strip + nav are built once and each tab
// lives in its own same-origin frame that stays loaded, so switching tabs is instant (no page reload) and the map keeps
// its instance. The shell runs the one live-update loop (/api/strip) and forwards it to the frames.
// Pages opened on their own (/scan, /adsb, ...) jump into the shell (/#/scan) unless ?standalone=1.
// Status strip (top) + tab bar (bottom on phones / 5" kiosk, side rail on iPad / desktop).
// Load it as the FIRST thing in <body> (<script src="/nav.js"></script>) so both bars exist before
// the page paints. Tabs only navigate; they never change what the SDR is doing (that stays in the
// SDR mode row, mode.js). The strip polls /api/strip gently and shows a dash for anything it
// cannot get: it never shows raw errors and never breaks the page.
(function () {
  if (window.fieldnoteStrip) return;
  const D = document, H = D.documentElement;

  // Kiosk flag (same rule as mode.js; set here too so the kiosk sizes apply before first paint)
  try {
    const q = new URLSearchParams(location.search).get('kiosk');
    if (q === '1') localStorage.setItem('fieldnoteKiosk', '1');
    if (q === '0') localStorage.removeItem('fieldnoteKiosk');
    if (localStorage.getItem('fieldnoteKiosk') === '1') H.classList.add('kiosk');
    // Desktop edition: ?display=hdmi marks the HDMI monitor kiosk (pointer visible, no on-screen keyboard
    // unless a touch screen is present)
    const dq = new URLSearchParams(location.search).get('display');
    if (dq === 'hdmi') localStorage.setItem('fieldnoteDisplay', 'hdmi');
    if (dq === 'dsi') localStorage.removeItem('fieldnoteDisplay');
    if (localStorage.getItem('fieldnoteDisplay') === 'hdmi') H.classList.add('hdmi');
  } catch (e) {}
  // 1.2.0 text size (More > Screen): Small / Normal / Large / Extra large scales the whole UI (text, subtexts and tap
  // targets) with CSS zoom on <body> (--tz, see fieldnote.css 1.2.0). Saved per device (localStorage, shared by the shell and every tab frame);
  // the 5" handheld kiosk defaults to Large, everything else to Normal.
  const TS = { small: 0.88, normal: 1, large: 1.15, xl: 1.3 };
  function tsGet() {
    let v = null; try { v = localStorage.getItem('traceTextSize'); } catch (e) {}
    if (TS[v]) return v;
    return (H.classList.contains('kiosk') && !H.classList.contains('hdmi')) ? 'large' : 'normal';
  }
  function tsApply() { const k = tsGet(); H.dataset.ts = k; H.style.setProperty('--tz', String(TS[k])); }
  tsApply();
  window.addEventListener('storage', e => { if (!e.key || e.key === 'traceTextSize') { tsApply(); window.dispatchEvent(new Event('resize')); } });
  window.traceTextSize = {
    sizes: TS, get: tsGet,
    set(k) { if (!TS[k]) return; try { localStorage.setItem('traceTextSize', k); } catch (e) {} tsApply(); window.dispatchEvent(new Event('resize')); }
  };
  const TAB_ROOT = { '/listen': 'listen', '/radio': 'listen', '/adsb': 'map', '/scan': 'scan', '/detect': 'scan', '/spectrum': 'spectrum', '/more': 'settings', '/settings': 'settings' };
  let SH = null;
  try { SH = (window.parent !== window && window.parent.fieldnoteShell) || null; } catch (e) { SH = null; }
  if (SH) {                                                  // ---- a page inside the shell: no own chrome, no own polling ----
    H.classList.add('embed');
    if (/^\/adsb/.test(location.pathname)) H.classList.add('emb-map');
    D.addEventListener('click', e => {                        // tab-level links switch tabs in the shell
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target || a.origin !== location.origin) return;
      const p = a.pathname.replace(/\.html$/, '');
      if (TAB_ROOT[p] || p === '/') { e.preventDefault(); SH.go(p === '/' ? '/adsb' : p + a.search); }
    });
    ['sdr-mode', 'sdr-mode-busy'].forEach(t => D.addEventListener(t, e => { if (!e.detail || !e.detail._fwd) SH.relay(t, e.detail); }));
    window.fieldnoteStrip = { refresh: () => SH.strip.refresh(), get: () => SH.strip.get(), icons: SH.strip.icons };
    try { if (window.parent.fieldnotePower) window.fieldnotePower = window.parent.fieldnotePower;     // one power sheet + one
          if (window.parent.fieldnoteScreen) window.fieldnoteScreen = window.parent.fieldnoteScreen; } catch (e) {}   // screen poller (shell)
    const tell = () => SH.frameNav(window, location.pathname + location.search);
    if (D.readyState !== 'loading') tell(); else D.addEventListener('DOMContentLoaded', tell);
    return;
  }
  const IS_SHELL = /^\/(app(\.html)?)?$/.test(location.pathname);
  if (!IS_SHELL && window.top === window && !/[?&]standalone=1/.test(location.search)) {
    location.replace('/#' + location.pathname.replace(/\.html$/, '') + location.search);   // open inside the single-load shell
    return;
  }

  const svg = (body, fill) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="' + (fill ? 'currentColor' : 'none') +
    '" stroke="' + (fill ? 'none' : 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  const ICON = {
    listen: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>'),
    radio: svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l10-5"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6.5 12h4M6.5 15.5h4"/>'),
    map: svg('<path d="M21 15.5v-1.8l-7.5-4.6V4a1.5 1.5 0 0 0-3 0v5.1L3 13.7v1.8l7.5-2.3v4.6l-2 1.5V21l3.5-1 3.5 1v-1.7l-2-1.5v-4.6z"/>', true),
    spectrum: svg('<path d="M2 20h20M4.5 20v-6M8.5 20V7M12.5 20v-9M16.5 20V4M20.5 20v-7"/>'),
    detect: svg('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>'),
    dash: svg('<rect x="3" y="3" width="11" height="18" rx="1.5"/><rect x="16" y="3" width="5" height="8" rx="1"/><rect x="16" y="13" width="5" height="8" rx="1"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    wifi: svg('<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.4a9.5 9.5 0 0 1 13 0M8.6 15.7a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>'),
    hotspot: svg('<circle cx="12" cy="10" r="2"/><path d="M12 12v9M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.6 3.6a9 9 0 0 0 0 12.8M18.4 3.6a9 9 0 0 1 0 12.8"/>'),
    net: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    speaker: svg('<rect x="6" y="2.5" width="12" height="19" rx="3"/><circle cx="12" cy="14.5" r="3.2"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/>'),
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>')
  };

  const TABS = [   // 1.0.8 order
    { id: 'listen', href: '/listen', label: 'Listen' },
    { id: 'map', href: '/adsb', label: 'Map' },
    { id: 'scan', href: '/scan', label: 'Scan' },
    { id: 'spectrum', href: '/spectrum', label: 'Spectrum' },
    { id: 'settings', href: '/settings', label: 'Settings' }
  ];
  ICON.scan = ICON.detect;
  const PAGE_TAB = { 'listen': 'listen', 'radio': 'listen', 'adsb': 'map', 'spectrum': 'spectrum', 'scan': 'scan', 'detect': 'scan',
                     'more': 'settings', 'settings': 'settings', 'presets': 'settings', 'network': 'settings', 'audio': 'settings', 'updates': 'settings', 'screen': 'settings', 'dongles': 'settings', 'shots': 'settings', 'maps': 'settings', 'stations': 'settings', 'about': 'settings', 'roles': 'settings' };
  const MODE_TAB = { fm: 'listen', adsb: 'map', spectrum: 'spectrum', detect: 'scan' };
  const MODE_NAME = { fm: 'FM radio', adsb: 'ADS-B', spectrum: 'Spectrum', detect: 'Scan' };
  const MODE_PAGE = { fm: '/listen', adsb: '/adsb', spectrum: '/spectrum', detect: '/scan' };
  const page = location.pathname.replace(/^\/+|\.html$|\/+$/g, '');
  let here = IS_SHELL ? 'map' : (PAGE_TAB[page] || 'settings');

  // ---- build ----
  const strip = D.createElement('header');
  strip.className = 'qstrip'; strip.id = 'qstrip'; strip.setAttribute('aria-label', 'Trace status');
  strip.innerHTML =
    '<a class="qs-chip qs-job" id="qsJob" href="/settings">' +
      '<span class="qs-dot unk" id="qsDot"></span>' +
      '<span class="qs-txt"><span class="qs-k" id="qsJobK">SDR</span><span class="qs-v dash" id="qsJobV">—</span></span></a>' +
    '<a class="qs-chip qs-net" id="qsNet" href="/network">' +
      '<span class="qs-ico off" id="qsNetI">' + ICON.net + '</span>' +
      '<span class="qs-txt"><span class="qs-k" id="qsNetK">Network</span><span class="qs-v dash" id="qsNetV">—</span></span></a>' +
    '<a class="qs-chip qs-aud" id="qsAud" href="/audio">' +
      '<span class="qs-ico off" id="qsAudI">' + ICON.speaker + '</span>' +
      '<span class="qs-txt"><span class="qs-k" id="qsAudK">Audio</span><span class="qs-v dash" id="qsAudV">—</span></span></a>' +
    '<span class="qs-pwr" id="qsPwr"></span>';

  const tabs = D.createElement('nav');
  tabs.className = 'qtabs'; tabs.id = 'qtabs'; tabs.setAttribute('aria-label', 'Pages');
  tabs.innerHTML = TABS.map(t => '<a class="qtab' + (t.id === here ? ' on' : '') + '" data-tab="' + t.id + '" href="' + t.href + '"' +
    (t.id === here ? ' aria-current="page"' : '') + '>' + ICON[t.id] + '<span>' + t.label + '</span></a>').join('');

  function mount() {
    const b = D.body;
    b.insertBefore(strip, b.firstChild);
    b.appendChild(tabs);
    if (IS_SHELL) setTimeout(shellInit, 0);
    measure();
    if (window.ResizeObserver) { const ro = new ResizeObserver(measure); ro.observe(strip); ro.observe(tabs); }
    window.addEventListener('resize', measure);
  }
  function measure() {
    if (strip.offsetHeight) H.style.setProperty('--chrome-top', strip.offsetHeight + 'px');
    const rail = getComputedStyle(tabs).flexDirection === 'column';   // side rail (iPad / desktop): nothing at the bottom
    if (rail) { H.style.setProperty('--chrome-bottom', '0px'); H.style.setProperty('--rail', tabs.offsetWidth + 'px'); }
    else { H.style.removeProperty('--rail'); if (tabs.offsetHeight) H.style.setProperty('--chrome-bottom', tabs.offsetHeight + 'px'); }
  }
  if (D.body) mount(); else D.addEventListener('DOMContentLoaded', mount);

  // ---- render ----
  const $ = id => strip.querySelector('#' + id);
  function text(id, short, long, cls) {
    const el = $(id);
    el.className = 'qs-v' + (cls ? ' ' + cls : '');
    if (long && long !== short) {
      el.innerHTML = '';
      const a = D.createElement('span'); a.className = 'qs-short'; a.textContent = short;
      const b = D.createElement('span'); b.className = 'qs-long'; b.textContent = long;
      el.append(a, b);
    } else el.textContent = short;
  }
  const mhz = (hz, d) => (typeof hz === 'number' && isFinite(hz)) ? (hz / 1e6).toFixed(d) : null;
  const trimMhz = x => String(x).replace(/\.?0+$/, '');

  let S = null, busyTo = null;
  function metricText(mode, m) {
    if (!m) return null;
    if (mode === 'fm' && typeof m.mhz === 'number') {
      const air = m.band === 'airband' || m.band === 'noaa' || m.band === 'other';
      const f = air ? m.mhz.toFixed(3) : (Math.round(m.mhz * 10) / 10).toFixed(1) + ' MHz';
      const nm = m.name && !/^Tune /.test(m.name) ? m.name : '';
      return nm ? [nm, nm + (air ? ' · ' + f : '')] : [f, f];   // 1.0.8: station name in the strip
    }
    if (mode === 'adsb' && typeof m.count === 'number') return [m.count + ' aircraft', m.count + ' aircraft'];
    if (mode === 'spectrum' && mhz(m.center_hz, 2)) return [mhz(m.center_hz, 2) + ' MHz', mhz(m.center_hz, 3) + ' MHz'];
    if (mode === 'detect' && mhz(m.start_hz, 0) && mhz(m.stop_hz, 0)) {
      const r = trimMhz(mhz(m.start_hz, 1)) + '–' + trimMhz(mhz(m.stop_hz, 1)) + ' MHz';
      return [r, r];
    }
    return null;
  }
  // 1.2.5: two radios (roles saved by serial): the job chip shows both, "ADS-B ✓ / Airband ✓"; a missing one turns amber
  function renderDual() {
    const rd = S && S.radios, md = S && S.mode;
    if (!rd || !(rd.dual || rd.degraded) || busyTo || (md && md.off)) return false;
    const dot = $('qsDot'), job = $('qsJob'), miss = rd.missing || [], mode = md && md.mode;
    const adsbOk = !miss.includes('adsb'), radioOk = !miss.includes('radio');
    const live = !!(md && md.adsb_live);
    const rjob = (mode === 'fm' && S.metric && S.metric.band === 'airband') ? 'Airband' : (mode === 'fm' && S.metric && S.metric.band === 'noaa') ? 'NOAA'
      : (mode && MODE_NAME[mode] && mode !== 'adsb') ? MODE_NAME[mode] : 'Airband';
    $('qsJobK').textContent = 'ADS-B ' + (adsbOk ? (live ? '✓' : '–') : '✕');
    text('qsJobV', rjob + ' ' + (radioOk ? (mode && mode !== 'adsb' && mode !== 'none' ? '✓' : '–') : '✕'), null, radioOk ? '' : 'warn');
    job.classList.add('dual-chip'); job.classList.toggle('warn', !(adsbOk && radioOk));
    dot.className = 'qs-dot ' + (adsbOk && radioOk ? 'ok' : 'warn');
    job.href = '/dongles'; job.title = '';
    job.setAttribute('aria-label', 'Radios: ADS-B ' + (adsbOk ? (live ? 'running' : 'idle') : 'missing') + ', ' + rjob + ' ' + (radioOk ? 'ready' : 'missing') + '. Open Radio roles.');
    tabs.querySelectorAll('.qlive').forEach(x => x.remove());
    ['map', MODE_TAB[mode]].forEach(id => { const t = id && (id !== 'map' || live) && tabs.querySelector('[data-tab="' + id + '"]'); if (t && !t.querySelector('.qlive')) { const i = D.createElement('i'); i.className = 'qlive'; t.appendChild(i); } });
    return true;
  }
  function renderJob() {
    const md = S && S.mode, mode = md && md.mode;
    const dot = $('qsDot'), job = $('qsJob');
    if (renderDual()) return;
    job.classList.remove('dual-chip', 'warn');
    let k = 'SDR', v = ['—'], cls = 'dash', d = 'unk', label;
    if (busyTo) {
      k = 'SDR'; v = ['Switching…', 'Switching to ' + (MODE_NAME[busyTo] || busyTo) + '…']; cls = 'warn'; d = 'warn';
    } else if (md && MODE_NAME[mode]) {
      k = MODE_NAME[mode]; d = 'ok';
      if (mode === 'fm' && S.metric && S.metric.band === 'airband') k = 'Airband';
      else if (mode === 'fm' && S.metric && S.metric.band === 'noaa') k = 'NOAA';
      const mt = metricText(mode, S.metric);
      if (mt) { v = mt; cls = ''; } else { v = ['—']; cls = 'dash'; }
    } else if (md && md.off) {
      k = 'SDR'; v = ['Off', 'Off']; cls = 'dash'; d = '';
    } else if (md && md.dongles === 0) {
      k = 'SDR'; v = ['No radio', 'No radio detected']; cls = 'warn'; d = 'warn';
    } else if (md && mode === 'none') {
      k = 'SDR'; v = ['Off', 'Off (nothing running)']; cls = 'dash'; d = '';
    }
    $('qsJobK').textContent = k;
    text('qsJobV', v[0], v[1], cls);
    dot.className = 'qs-dot ' + d;
    job.href = (md && MODE_PAGE[mode]) || '/settings';
    job.title = (mode === 'fm' && S.metric && S.metric.name) ? 'FM radio: ' + S.metric.name : '';
    label = 'SDR job: ' + (md ? (MODE_NAME[mode] || (mode === 'none' ? 'off' : 'unknown')) : 'unknown') + (cls ? '' : ', ' + (v[1] || v[0]));
    job.setAttribute('aria-label', busyTo ? 'SDR job: switching' : label);
    // live dot on the tab whose job the SDR is doing (status only; tabs never switch modes)
    tabs.querySelectorAll('.qlive').forEach(x => x.remove());
    const t = md && MODE_TAB[mode] && tabs.querySelector('[data-tab="' + MODE_TAB[mode] + '"]');
    if (t && !busyTo) { const i = D.createElement('i'); i.className = 'qlive'; i.title = 'The SDR is doing this now'; t.appendChild(i); }
  }
  function renderNet() {
    const n = S && S.net, ic = $('qsNetI'), a = $('qsNet');
    let k = 'Network', v = ['—'], cls = 'dash', icon = ICON.net, on = false;
    if (n) {
      if (n.switching) { v = ['Switching…']; cls = 'warn'; }
      else if (n.mode === 'wifi') { k = 'Wi‑Fi'; v = [n.name || 'connected', n.name || 'connected']; cls = ''; icon = ICON.wifi; on = true; }
      else if (n.mode === 'ap') { k = 'Hotspot'; v = [n.name || 'Trace']; cls = ''; icon = ICON.hotspot; on = true; }
      else if (n.mode === 'offline') { v = ['Not connected']; cls = 'warn'; }
    }
    $('qsNetK').textContent = k; text('qsNetV', v[0], v[1], cls);
    ic.innerHTML = icon; ic.className = 'qs-ico' + (on ? '' : ' off');
    a.setAttribute('aria-label', 'Network: ' + (n ? k + ' ' + v[0] : 'unknown') + '. Open Network.');
  }
  function renderAudio() {
    const au = S && S.audio, ic = $('qsAudI'), a = $('qsAud');
    let k = 'Audio', v = ['—'], cls = 'dash', icon = ICON.speaker, on = false;
    if (au) {
      // 1.3: no brand names in the chip (the speaker's full name is on the Bluetooth / Audio page)
      const wants = au.output === 'speaker' || au.output === 'both';
      if (au.output === 'phone' || !au.output) { v = ['Phone', 'Phone']; cls = ''; icon = ICON.phone; on = true; }
      else if (wants && au.connected) { k = 'Speaker'; v = ['✓', au.output === 'both' ? '✓ + phone' : '✓']; cls = ''; on = true; }
      else if (wants) { k = 'Speaker'; v = ['Off', 'Off']; cls = 'warn'; }
    }
    $('qsAudK').textContent = k;
    text('qsAudV', v[0], v[1], cls);
    ic.innerHTML = icon; ic.className = 'qs-ico' + (on ? '' : ' off');
    a.setAttribute('aria-label', k + ': ' + (v[1] || v[0]) + (au && au.speaker ? ' (' + au.speaker + ')' : '') + '. Open Audio.');
  }
  // ---- 1.2.4 weak power supply banner (from /api/strip psu; no extra polling). Pushes the content down; the X hides it
  // until the NEXT new under-voltage event (event number + boot id, saved per device). ----
  let pwr = null;
  function psuKey(p) { return (p.boot || '') + ':' + (p.event || 0); }
  function psuFit() {
    const h = pwr && !pwr.hidden ? Math.ceil(pwr.getBoundingClientRect().height) + 16 : 0;
    if (h) H.style.setProperty('--pwr-h', h + 'px'); else H.style.removeProperty('--pwr-h');
  }
  function renderPsu() {
    const p = S && S.psu;
    let dis = null; try { dis = localStorage.getItem('tracePsuDismissed'); } catch (e) {}
    const show = !!(p && (p.state === 'weak_now' || p.state === 'weak_seen') && dis !== psuKey(p));
    if (show && !pwr) {
      pwr = D.createElement('div'); pwr.id = 'pwrwarn'; pwr.className = 'umsg warn'; pwr.setAttribute('role', 'status');
      pwr.innerHTML = '<span class="pw-ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg></span>' +
        '<span class="pw-t"><b>Power supply too weak.</b> Use a stronger battery (5&nbsp;V, 3&nbsp;A or more).</span>' +
        '<button type="button" class="pw-x" aria-label="Dismiss">\u2715</button>';
      pwr.querySelector('.pw-x').onclick = () => {
        try { if (S && S.psu) localStorage.setItem('tracePsuDismissed', psuKey(S.psu)); } catch (e) {}
        pwr.hidden = true; psuFit();
      };
      D.body.appendChild(pwr);
      if (window.ResizeObserver) new ResizeObserver(psuFit).observe(pwr);
    }
    if (pwr) { pwr.hidden = !show; psuFit(); }
  }
  function render() {
    renderJob(); renderNet(); renderAudio(); renderPsu();
    D.dispatchEvent(new CustomEvent('fieldnote-strip', { detail: S }));
    eachFrame(w => w.document.dispatchEvent(new w.CustomEvent('fieldnote-strip', { detail: S })));
  }

  // ---- shell router (1.0.8) ----
  const frames = {};             // tab id -> iframe (kept alive)
  function eachFrame(fn) { Object.values(frames).forEach(f => { try { if (f.contentWindow && f.contentWindow.document) fn(f.contentWindow); } catch (e) {} }); }
  function tabOf(path) { const p = path.split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/+$/, '') || '/adsb'; return PAGE_TAB[p.slice(1)] || 'settings'; }
  function setHere(id) {
    here = id;
    tabs.querySelectorAll('.qtab').forEach(t => { const on = t.dataset.tab === id; t.classList.toggle('on', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  }
  function go(url, opt) {
    url = url || '/adsb';
    url = url.replace(/^\/more(\.html)?(?=[?#]|$)/, '/settings');   // 1.3: More was renamed Settings; old links land on Settings
    if (url === '/' || url === '/app') url = '/adsb';   // 1.2.0: Trace opens on Map/ADS-B (idle START screen)
    const id = tabOf(url), root = (TABS.find(t => t.id === id) || {}).href;
    let f = frames[id];
    if (!f) {
      f = D.createElement('iframe'); f.className = 'qframe'; f.title = id; f.dataset.tab = id;
      f.src = url; frames[id] = f; D.getElementById('qframes').appendChild(f);
    } else if ((opt && opt.reload) || (id === here && url.split('?')[0] === root) || url !== root || id === 'settings') {   // 1.1.0.1: the More tab always opens the More menu itself
      try { if (f.contentWindow.location.pathname + f.contentWindow.location.search !== url) f.contentWindow.location.replace(url); } catch (e) { f.src = url; }
    }
    Object.entries(frames).forEach(([k, el]) => { el.hidden = k !== id; });
    try { if (f.contentWindow.sdrMode) f.contentWindow.sdrMode.refresh(); } catch (e) {}   // START screen up to date
    setHere(id);
    if (!(opt && opt.noHash) && location.hash !== '#' + url) history.replaceState(null, '', '/#' + url);
    reportRoute(url);
    D.title = 'Stillwave Trace · ' + ((TABS.find(t => t.id === id) || {}).label || '');
  }
  // 1.2.0: the kiosk tells the box which page it shows (screenshot fallback renders that page, not the default tab)
  let routeT = null;
  function reportRoute(url) {
    if (!H.classList.contains('kiosk')) return;
    clearTimeout(routeT);
    routeT = setTimeout(() => { try { fetch('/api/kiosk/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: url }) }).catch(() => {}); } catch (e) {} }, 150);
  }
  function shellInit() {
    H.classList.add('shell');
    const box = D.createElement('main'); box.id = 'qframes'; D.body.appendChild(box);
    D.addEventListener('click', e => {                      // strip chips + tabs switch frames, never reload
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target || a.origin !== location.origin || !(strip.contains(a) || tabs.contains(a))) return;
      e.preventDefault(); go(a.pathname.replace(/\.html$/, '') + a.search);
    });
    D.addEventListener('fieldnote-screen', e => eachFrame(w => w.document.dispatchEvent(new w.CustomEvent('fieldnote-screen', { detail: e.detail }))));
    window.addEventListener('hashchange', () => go(location.hash.slice(1) || '/adsb', { noHash: true }));
    go(location.hash.length > 1 ? location.hash.slice(1) : '/adsb', { noHash: location.hash.length > 1 });
  }
  window.fieldnoteShell = IS_SHELL ? {
    go,
    relay(type, detail) {
      D.dispatchEvent(new CustomEvent(type, { detail: Object.assign({}, detail || {}, { _fwd: 1 }) }));
      if (type === 'sdr-mode') eachFrame(w => { try { const st = w.sdrMode && w.sdrMode.get(); if (st && detail && st.mode !== detail.mode) w.sdrMode.refresh(); } catch (e) {} });
    },
    frameNav(win, path) {           // a frame navigated itself (e.g. More -> Network): keep the tab + address in sync
      const id = Object.keys(frames).find(k => frames[k].contentWindow === win);
      if (id && !frames[id].hidden && location.hash !== '#' + path) history.replaceState(null, '', '/#' + path);
      if (id && !frames[id].hidden) reportRoute(path);
      try { if (S) win.document.dispatchEvent(new win.CustomEvent('fieldnote-strip', { detail: S })); } catch (e) {}
    },
    get strip() { return window.fieldnoteStrip; },
    frames
  } : null;

  // ---- poll: every 10 s while visible, 30 s after failures, paused when hidden ----
  let timer = null, inflight = false, fails = 0, soon = false, soonRuns = 0;
  async function refresh() {
    if (inflight) return S;
    inflight = true;
    const ac = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ac && ac.abort(), 8000);
    try {
      const r = await fetch('/api/strip', { cache: 'no-store', signal: ac ? ac.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || typeof j !== 'object') throw new Error('bad');
      S = j; fails = 0;
      // a slow helper is still answering (or the scope is still starting): ask again shortly, at most 4 times in a row
      const pend = Array.isArray(j.pending) && j.pending.length > 0;
      soon = pend && soonRuns < 4;
      soonRuns = pend ? soonRuns + 1 : 0;
    } catch (e) {
      fails++; S = null;          // API down: every chip shows a dash
    } finally { clearTimeout(to); inflight = false; }
    render(); schedule(soon ? 2500 : null); soon = false;
    return S;
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (D.hidden) return;
    timer = setTimeout(refresh, ms != null ? ms : (fails ? 30000 : 10000));
  }
  D.addEventListener('visibilitychange', () => { if (D.hidden) clearTimeout(timer); else refresh(); });
  // mode.js events: show a switch right away, then re-read
  let busyClr = null;
  D.addEventListener('sdr-mode-busy', e => {
    busyTo = e.detail && e.detail.to; renderJob();
    clearTimeout(busyClr); busyClr = setTimeout(() => { busyTo = null; renderJob(); }, 45000);
  });
  D.addEventListener('sdr-mode', e => {
    const s = e.detail; busyTo = null;
    if (s && s.mode) {
      const was = S && S.mode && S.mode.mode;
      if (!S) S = {};
      S.mode = Object.assign({}, S.mode || {}, { mode: s.mode, saved: s.saved, adsb_available: s.adsb_available });
      if (was && was !== s.mode) { S.metric = null; schedule(600); }
    }
    renderJob();
  });
  render();
  refresh();
  window.fieldnoteStrip = { refresh, get: () => S, icons: ICON };
})();
