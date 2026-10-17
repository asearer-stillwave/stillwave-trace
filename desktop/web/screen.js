// Stillwave Trace: kiosk screen on every page. Load after /nav.js, /mode.js and /power.js.
//  * Kiosk (?kiosk=1): "Screen off" first in the Power sheet (and on More / the Screen page). While the screen is
//    off, a full-screen black catcher covers the page: the touch that wakes the screen lands on it and
//    never presses what is underneath (sdr-screen also holds the touch device until the finger lifts).
//  * Phones: "Turn kiosk screen off / on" in the Power sheet (and More, Screen page). Nothing on the
//    phone's own page changes when the kiosk screen goes off.
//  * Shutdown / restart (Power menu or systemctl poweroff): a full-screen message.
// Polls /api/screen (a local file read on the box): every 2 s on the kiosk, 5 s on phones, paused when hidden.
(function () {
  if (window.fieldnoteScreen) return;
  const D = document, H = D.documentElement;
  const kiosk = () => H.classList.contains('kiosk');
  const page = location.pathname.replace(/^\/+|\.html$|\/+$/g, '');
  let S = null, shut = null, pressing = false, graceUntil = 0, timer = null, inflight = false, hintTo = null;

  // ---- elements ----
  const cat = D.createElement('div');
  cat.className = 'scr-catch hide'; cat.id = 'scrCatch'; cat.setAttribute('aria-hidden', 'true');
  cat.innerHTML = '<p class="scr-hint">Touch to wake</p>';
  const sd = D.createElement('div');
  sd.className = 'scr-shut hide'; sd.id = 'scrShut'; sd.setAttribute('role', 'alertdialog'); sd.setAttribute('aria-live', 'assertive');
  sd.innerHTML = '<div class="scr-shut-in"><h1 id="scrShutT"></h1><p class="scr-sub" id="scrShutS"></p>' +
    '<p class="note" id="scrShutS2"></p><p class="note pwr-brand">Stillwave Trace</p></div>';
  function mount() {
    D.body.appendChild(cat); D.body.appendChild(sd);
    render();
  }
  if (D.body) mount(); else D.addEventListener('DOMContentLoaded', mount);

  // ---- the wake catcher (kiosk only) ----
  function showCatch(withHint) {
    if (!kiosk() || shut) return;
    if (cat.classList.contains('hide')) {
      cat.classList.remove('hide');
      cat.classList.toggle('quiet', !withHint);
      clearTimeout(hintTo); hintTo = setTimeout(() => cat.classList.add('quiet'), 4000);
      H.classList.add('scr-off');
      schedule(700);
    }
  }
  function hideCatch() {
    if (cat.classList.contains('hide')) return;
    cat.classList.add('hide'); H.classList.remove('scr-off');
    schedule();
  }
  const swallow = e => { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); };
  ['pointerdown', 'touchstart', 'mousedown'].forEach(t => cat.addEventListener(t, e => { swallow(e); pressing = true; }, { passive: false }));
  ['click', 'contextmenu', 'dblclick'].forEach(t => cat.addEventListener(t, swallow, { passive: false }));
  ['pointerup', 'touchend', 'mouseup', 'pointercancel', 'touchcancel'].forEach(t => cat.addEventListener(t, e => {
    swallow(e);
    if (!pressing) return;
    pressing = false;
    graceUntil = Date.now() + 2500;              // don't let a slow poll put the catcher back right away
    if (S) S.state = 'on';
    setTimeout(hideCatch, 350);                  // the click that follows this touch still lands on the catcher
    post('on').catch(() => {});
  }, { passive: false }));

  // ---- shutdown / restart message (sticky: the web app goes away right after) ----
  function showShutdown(kind) {
    if (shut === kind) return;
    shut = kind;
    cat.classList.add('hide'); H.classList.remove('scr-off');
    const k = kiosk(), off = kind !== 'reboot';
    sd.classList.toggle('off', off);
    sd.querySelector('#scrShutT').textContent = off ? (k ? 'Shutting down…' : 'Trace is shutting down') : (k ? 'Restarting…' : 'Trace is restarting');
    sd.querySelector('#scrShutS').textContent = off
      ? (k ? 'Safe to unplug when this screen goes dark.' : 'Safe to unplug when the screen on the box goes dark.')
      : 'Back in about a minute.';
    sd.querySelector('#scrShutS2').textContent = off ? 'Or when the green light on the Pi stops blinking.' : '';
    sd.classList.remove('hide'); H.classList.add('pwr-open');
    if (window.fieldnotePower && window.fieldnotePower.close) try { window.fieldnotePower.close(); } catch (e) {}
    H.classList.add('pwr-open');
    if (!off) waitBack();
  }
  function waitBack() {
    let gone = false; const t0 = Date.now(), since = S && S.since;
    const tick = async () => {
      try {
        const r = await fetch('/api/screen?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) gone = true;
        else {
          const j = await r.json();
          // back after the restart (or the restart didn't happen): reload into the normal page
          if (gone || (!j.shutdown && j.running && j.since !== since)) { location.reload(); return; }
        }
      } catch (e) { gone = true; }
      if (Date.now() - t0 < 300000) setTimeout(tick, 3000);
    };
    setTimeout(tick, 5000);
  }

  // ---- state ----
  function render() {
    const s = S || {};
    if (s.shutdown) showShutdown(s.shutdown);
    if (shut) return;
    const k = kiosk();
    if (k && s.running) {
      const off = s.state === 'off' || s.turning_off;
      if (off && !pressing && Date.now() > graceUntil) showCatch(s.method === 'overlay');
      else if (!off && !pressing && Date.now() > graceUntil) hideCatch();
    } else if (!s.running) hideCatch();
    const pb = D.getElementById('pwrScr');
    if (pb) {
      pb.classList.toggle('hide', !s.running);
      pb.textContent = k ? 'Screen off' : (s.state === 'off' ? 'Turn kiosk screen on' : 'Turn kiosk screen off');
    }
    D.dispatchEvent(new CustomEvent('fieldnote-screen', { detail: S }));
  }
  async function refresh() {
    if (inflight) return S;
    inflight = true;
    try {
      const r = await fetch('/api/screen', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') S = j; }
    } catch (e) { /* box restarting: keep what we have */ }
    finally { inflight = false; }
    render(); schedule();
    return S;
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (D.hidden || shut) return;
    const off = !cat.classList.contains('hide');
    timer = setTimeout(refresh, ms != null ? ms : (kiosk() ? (off ? 700 : 2000) : (page === 'screen' ? 2500 : 5000)));
  }
  D.addEventListener('visibilitychange', () => { if (D.hidden) clearTimeout(timer); else refresh(); });

  async function post(action, body) {
    const r = await fetch('/api/screen/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: kiosk() ? 'kiosk' : 'phone' }, body || {})) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (j && typeof j === 'object' && 'state' in j) { S = Object.assign({}, S || {}, j); }
    render();
    return j;
  }
  async function off() {
    if (kiosk()) { graceUntil = Date.now() + 2500; pressing = false; showCatch(true); }
    const j = await post('off').catch(() => ({ ok: false, message: "The box didn't answer." }));
    if (!j.ok && kiosk()) { graceUntil = 0; hideCatch(); }
    return j;
  }
  async function on() { graceUntil = Date.now() + 2500; hideCatch(); return post('on').catch(() => ({ ok: false })); }
  function toggle() { return (S && S.state === 'off' && !kiosk()) ? on() : off(); }

  window.fieldnoteScreen = { refresh, get: () => S, off, on, toggle, post, isKiosk: kiosk };
  refresh();
})();
