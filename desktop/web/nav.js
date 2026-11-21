// 1.3.4: shared friendly error card (approved mockup 1.3.4-errors). Raw helper output (sudo / command not found / paths)
// never reaches the page text; it sits behind a collapsed Details toggle. traceErr.clean() is for one-line status messages.
window.traceErr = window.traceErr || (function () {
  const SYS = /sudo:|command not found|Traceback|\/usr\/(local\/)?s?bin\/|No such file|Permission denied|Errno|Internal Server Error|^HTTP 5\d\d/i;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const sys = m => SYS.test(String(m || ''));
  const clean = (m, fb) => sys(m) ? (fb || 'The helper on this box did not answer.') : String(m == null ? '' : m);
  function card(what, why, raw, retry) {
    const d = document.createElement('div'); d.className = 'ec'; d.setAttribute('role', 'alert');
    d.innerHTML = '<h3>Couldn\u2019t read ' + esc(what) + '</h3><p>' + esc(why) + '</p><div class="ec-row"><button type="button" class="sm primary ec-retry">Try again</button>' +
      '<button type="button" class="sm ec-web">Restart web UI</button></div>' + (raw ? '<details><summary>Details</summary><pre>' + esc(raw) + '</pre></details>' : '');
    const rb = d.querySelector('.ec-retry'), wb = d.querySelector('.ec-web');
    rb.onclick = () => { rb.disabled = true; rb.textContent = 'Checking\u2026'; Promise.resolve().then(() => retry && retry()).catch(() => {}).then(() => { rb.disabled = false; rb.textContent = 'Try again'; }); };
    let armed = false;
    wb.onclick = () => {
      if (!armed) { armed = true; wb.textContent = 'Tap again to restart'; setTimeout(() => { armed = false; wb.textContent = 'Restart web UI'; }, 4000); return; }
      wb.disabled = true; wb.textContent = 'Restarting\u2026';
      fetch('/api/services/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: 'sdr-web' }) }).catch(() => {});
      setTimeout(() => location.reload(), 6000);
    };
    return d;
  }
  function show(host, what, why, raw, retry) { if (!host) return; host.innerHTML = ''; host.appendChild(card(what, why, raw, retry)); }
  function hide(host) { if (host) host.innerHTML = ''; }
  return { sys, clean, card, show, hide };
})();
// Stillwave Trace 1.0.8: single-load app. "/" is the shell (app.html): status strip + nav are built once and each tab
// lives in its own same-origin frame that stays loaded, so switching tabs is instant (no page reload) and the map keeps
// its instance. The shell runs the one live-update loop (/api/strip) and forwards it to the frames.
// Pages opened on their own (/listen, /adsb, ...) jump into the shell (/#/listen) unless ?standalone=1.
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
  const TAB_ROOT = { '/listen': 'listen', '/radio': 'listen', '/adsb': 'map', '/scan': 'spectrum', '/detect': 'spectrum', '/spectrum': 'spectrum', '/more': 'settings', '/settings': 'settings' };
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
    { id: 'spectrum', href: '/spectrum', label: 'Spectrum' },
    { id: 'settings', href: '/settings', label: 'Settings' }
  ];
  const PAGE_TAB = { 'listen': 'listen', 'radio': 'listen', 'adsb': 'map', 'spectrum': 'spectrum', 'scan': 'spectrum', 'detect': 'spectrum',
                     'more': 'settings', 'settings': 'settings', 'presets': 'settings', 'network': 'settings', 'system': 'settings', 'audio': 'settings', 'updates': 'settings', 'screen': 'settings', 'dongles': 'settings', 'shots': 'settings', 'maps': 'settings', 'stations': 'settings', 'about': 'settings', 'roles': 'settings' };
  const MODE_TAB = { fm: 'listen', adsb: 'map', spectrum: 'spectrum' };   // 1.3.2: Scan removed
  const MODE_NAME = { fm: 'FM radio', adsb: 'ADS-B', spectrum: 'Spectrum' };
  const MODE_PAGE = { fm: '/listen', adsb: '/adsb', spectrum: '/spectrum' };
  const page = location.pathname.replace(/^\/+|\.html$|\/+$/g, '');
  let here = IS_SHELL ? 'map' : (PAGE_TAB[page] || 'settings');

  // ---- build ----
  const strip = D.createElement('header');
  strip.className = 'qstrip'; strip.id = 'qstrip'; strip.setAttribute('aria-label', 'Trace status');
  strip.innerHTML =
    '<span class="qs-jobs" id="qsJobs"><a class="qs-chip qs-job" id="qsJob" href="/settings">' +
      '<span class="qs-dot unk"></span>' +
      '<span class="qs-txt"><span class="qs-k">SDR</span><span class="qs-v dash">—</span></span></a></span>' +
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
      const air = m.band === 'airband' || m.band === 'noaa' || m.band === 'frs' || m.band === 'other' || m.band === 'any';
      const f = air ? m.mhz.toFixed(3) : (Math.round(m.mhz * 10) / 10).toFixed(1) + ' MHz';
      const nm = m.name && !/^Tune /.test(m.name) ? m.name : '';
      return nm ? [nm, nm + (air ? ' · ' + f : '')] : [f, f];   // 1.0.8: station name in the strip
    }
    if (mode === 'adsb' && typeof m.count === 'number') return [m.count + ' aircraft', m.count + ' aircraft'];
    if (mode === 'spectrum' && mhz(m.center_hz, 2)) return [mhz(m.center_hz, 2) + ' MHz', mhz(m.center_hz, 3) + ' MHz'];
    return null;
  }
  // 1.3.2: one chip per SDR (USB order): "SDR 1 · ADS-B / 59 AC", "SDR 2 · FM / Tuning…" (amber) -> "Live 98.7" (green);
  // errors in red use the app's own words (Reconnecting… / No radio / Switching… / No signal). AIS: "SDR 2 · AIS / 4 boats".
  // One dongle = one chip. Live status comes from /api/strip "live" (radio_control.strip_live).
  const ROLE_NAME = { adsb: 'ADS-B', ais: 'AIS', radio: 'Radio', spare: 'Spare' };
  function radioJob(mode) {
    const m = S && S.metric;
    if (mode === 'fm') return (m && m.band === 'airband') ? 'Airband' : (m && m.band === 'noaa') ? 'NOAA' : (m && m.band === 'frs') ? 'FRS' : (m && m.band === 'any') ? 'Any MHz' : 'FM';
    return MODE_NAME[mode] || 'Radio';
  }
  function radioState(mode) {   // -> [text, class, dot]
    const lv = S && S.live, m = S && S.metric;
    if (busyTo) return ['Switching…', 'err', 'err'];
    if (mode === 'fm') {
      const st = lv && lv.radio, f = m && typeof m.mhz === 'number' ? (m.band === 'fm' || !m.band ? m.mhz.toFixed(1) : m.mhz.toFixed(3)) : '';
      if (st === 'tuning') return ['Tuning…', 'warn', 'warn'];
      if (st === 'live') return ['Live ' + f, 'live', 'ok'];
      if (st === 'nosignal') return ['No signal', 'err', 'err'];
      if (st === 'reconnecting') return ['Reconnecting…', 'err', 'err'];
      if (st === 'off') return ['Off', 'dash', ''];
      const mt = metricText(mode, m); return mt ? [mt[0], '', 'ok'] : ['—', 'dash', 'unk'];
    }
    if (mode === 'adsb') { const n = (lv && lv.adsb_count != null) ? lv.adsb_count : (m && m.count); return n != null ? [n + ' AC', 'live', 'ok'] : ['—', 'dash', 'unk']; }
    const mt = metricText(mode, m); return mt ? [mt[0], 'live', 'ok'] : ['—', 'dash', 'unk'];
  }
  function chipHTML(c, first) {
    return '<a class="qs-chip qs-job qs-sdr' + (c.cls === 'err' ? ' err' : c.cls === 'warn' ? ' warn' : '') + '"' + (first ? ' id="qsJob"' : '') + ' href="' + c.href + '" aria-label="' + c.aria.replace(/"/g, '') + '">' +
      '<span class="qs-dot ' + c.dot + (c.num ? ' num' : '') + '">' + (c.num ? '<b>' + c.num + '</b>' : '') + '</span><span class="qs-txt"><span class="qs-k"></span><span class="qs-v ' + c.cls + '"></span></span></a>';
  }
  function renderJob() {
    const md = S && S.mode, mode = md && md.mode, rd = S && S.radios, lv = S && S.live, box = $('qsJobs');
    const chips = [];
    const dl = rd && Array.isArray(rd.dongles) ? rd.dongles : null;
    if (md && md.off) chips.push({ k: 'SDR', v: 'Off', cls: 'dash', dot: '', href: '/dongles' });
    else if ((md && md.dongles === 0) || (dl && dl.length === 0)) chips.push({ k: 'SDR', v: 'No radio', cls: 'err', dot: 'err', href: '/dongles' });
    else if (!dl || dl.length <= 1 || !(rd.dual || rd.degraded || dl.some(d => d.role === 'ais'))) {
      // one dongle (or roles not set up): one chip for whatever the SDR is doing
      if (!md) chips.push({ k: 'SDR', v: busyTo ? 'Switching…' : '—', cls: busyTo ? 'err' : 'dash', dot: busyTo ? 'err' : 'unk', href: '/settings' });
      else if (mode === 'none' && !busyTo) chips.push({ k: 'SDR', v: 'Off', cls: 'dash', dot: '', href: '/settings' });
      else { const [v, cls, dot] = radioState(mode); chips.push({ k: 'SDR · ' + (mode === 'adsb' ? 'ADS-B' : radioJob(mode)), v, cls, dot, href: MODE_PAGE[mode] || '/settings' }); }
    } else {
      const miss = rd.missing || [];
      dl.forEach((d, i) => {
        const n = 'SDR ' + (i + 1) + ' · ', c0 = chips.length;
        if (d.role === 'adsb') {
          const c = lv && lv.adsb_count;
          chips.push(c != null ? { k: n + 'ADS-B', v: c + ' AC', cls: 'live', dot: 'ok', href: '/adsb' } : { k: n + 'ADS-B', v: md && md.adsb_live ? '—' : 'Off', cls: 'dash', dot: md && md.adsb_live ? 'unk' : '', href: '/adsb' });
        } else if (d.role === 'ais') {
          const a = lv && lv.ais;
          chips.push(a && a.live ? { k: n + 'AIS', v: a.n + (a.n === 1 ? ' boat' : ' boats'), cls: 'live', dot: 'ok', href: '/adsb' } : { k: n + 'AIS', v: 'Reconnecting…', cls: 'err', dot: 'err', href: '/dongles' });
        } else if (d.role === 'radio') {
          if (mode === 'adsb' || mode === 'none' || !mode) chips.push({ k: n + 'Radio', v: busyTo ? 'Switching…' : 'Off', cls: busyTo ? 'err' : 'dash', dot: busyTo ? 'err' : '', href: '/listen' });
          else { const [v, cls, dot] = radioState(mode); chips.push({ k: n + radioJob(mode), v, cls, dot, href: MODE_PAGE[mode] || '/listen' }); }
        } else chips.push({ k: n + (ROLE_NAME[d.role] || 'Spare'), v: 'Spare', cls: 'dash', dot: '', href: '/dongles' });
        if (chips[c0]) chips[c0].num = i + 1;   // 1.3.6: narrow screens show a "1"/"2" badge instead of "SDR 1 · "
      });
      miss.forEach(r => chips.push({ k: 'SDR · ' + (ROLE_NAME[r] || r), v: 'No radio', cls: 'err', dot: 'err', href: '/dongles' }));
    }
    chips.forEach(c => { c.aria = c.k + ': ' + c.v; });
    const sig = JSON.stringify(chips);
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = chips.map((c, i) => chipHTML(c, i === 0)).join('');
      box.querySelectorAll('.qs-chip').forEach((el, i) => {
        const c = chips[i], k = el.querySelector('.qs-k'), m = c.num ? /^(SDR \d · )(.*)$/.exec(c.k) : null;
        if (m) { const p = document.createElement('span'); p.className = 'qs-kn'; p.textContent = m[1]; k.append(p, m[2]); } else k.textContent = c.k;
        const v = el.querySelector('.qs-v'); v.textContent = c.v;
        if (/^Live /.test(c.v)) { v.dataset.short = '▶ ' + c.v.slice(5); }
      });
      box.classList.toggle('multi', chips.length > 1);
      setTimeout(measure, 0);
    }
    // live dot on the tab whose job an SDR is doing (status only; tabs never switch modes)
    tabs.querySelectorAll('.qlive').forEach(x => x.remove());
    const ids = new Set();
    if (!busyTo && md && MODE_TAB[mode]) ids.add(MODE_TAB[mode]);
    if (md && md.adsb_live) ids.add('map');
    if (lv && lv.ais && lv.ais.live) ids.add('map');
    ids.forEach(id => { const t = tabs.querySelector('[data-tab="' + id + '"]'); if (t) { const i = D.createElement('i'); i.className = 'qlive'; i.title = 'An SDR is doing this now'; t.appendChild(i); } });
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
      // 1.3: Off/none shows SPEAKER; full name on the Bluetooth / Audio page
      const wants = au.output === 'speaker' || au.output === 'both';
      if (au.output === 'phone' || !au.output) { v = ['Phone', 'Phone']; cls = ''; icon = ICON.phone; on = true; }
      // 1.3.1: the connected speaker's own name, trimmed to fit one line (SPEAKER when it has none)
      else if (wants && au.connected) { const nm = String(au.speaker || '').trim(); k = nm ? (nm.length > 12 ? nm.slice(0, 11).trimEnd() + '…' : nm) : 'Speaker'; v = ['✓', au.output === 'both' ? '✓ + phone' : '✓']; cls = ''; on = true; }
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
    url = url.replace(/^\/more(\.html)?(?=[?#]|$)/, '/settings');
    url = url.replace(/^\/(scan|detect)(\.html)?(?=[?#]|$)[^#]*/, '/spectrum');   // 1.3.2: Scan was removed; old links open Spectrum   // 1.3: More was renamed Settings; old links land on Settings
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
// 1.3.5: kiosk auto-reload. The kiosk shell (top window, html.kiosk) polls /api/ui/epoch and reloads itself when it changes:
// after an update restarts the web UI, after a map is installed or deleted, or from Settings > System > Reload screen.
// Nobody needs a keyboard (Ctrl+Shift+R) on the device. Phones and other browsers are never reloaded under the user.
(function () {
  if (window.top !== window || window.__traceEpoch) return;
  window.__traceEpoch = true;
  let first = null, fails = 0;
  async function tick() {
    if (!document.documentElement.classList.contains('kiosk')) return setTimeout(tick, 15000);
    try {
      const j = await (await fetch('/api/ui/epoch', { cache: 'no-store' })).json();
      fails = 0;
      if (j && j.epoch) {
        if (first === null) first = j.epoch;
        else if (j.epoch !== first) { location.reload(); return; }
      }
    } catch (e) { fails++; }   // web UI restarting: keep the old epoch, reload when it answers with a new one
    setTimeout(tick, fails ? 3000 : 5000);
  }
  setTimeout(tick, 4000);
})();
