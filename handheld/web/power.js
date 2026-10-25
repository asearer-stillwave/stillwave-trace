// Stillwave Trace: Power menu (Reboot / Shut down) on every page.
// Load after /mode.js and /nav.js (the status strip holds the power icon; Settings has a Power row too).
// Opening the sheet does nothing by itself; each action needs a second, separate confirm tap (armed after a short delay so a double tap cannot confirm it).
(function () {
  if (window.fieldnotePower) return;
  const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<path d="M12 3v9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
    '<path d="M6.3 6.8a8 8 0 1 0 11.4 0" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
  const TEXT = {
    reboot: {
      q: 'Reboot Trace?',
      d: 'Radio, map and hotspot stop for about a minute. This screen reconnects by itself.',
      yes: 'Yes, reboot',
      title: 'Rebooting…',
      sub: 'Back in about a minute.'
    },
    poweroff: {
      q: 'Shut down Trace?',
      d: 'It stays off until you unplug it and plug it back in.',
      yes: 'Yes, shut down',
      title: 'Shutting down',
      sub: 'Safe to unplug when dark.',
      sub2: ''
    }
  };

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'powerbtn'; btn.id = 'powerbtn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = ICON + '<span>Power</span>';
  // Home: the power icon at the right end of the status strip (nav.js). Fallback: the page header.
  const slot = document.getElementById('qsPwr');
  const brand = document.querySelector('.brand');
  if (slot) { btn.setAttribute('aria-label', 'Power: reboot or shut down'); btn.title = 'Power'; slot.appendChild(btn); }
  else if (brand) { brand.classList.add('has-power'); brand.appendChild(btn); }
  else (document.querySelector('.wrap') || document.body).appendChild(btn);

  const ov = document.createElement('div');
  ov.className = 'pwr-ov hide'; ov.id = 'pwrSheet';
  ov.innerHTML =
    '<div class="pwr-sheet" role="dialog" aria-modal="true" aria-labelledby="pwrTitle">' +
      '<div class="pwr-step" data-step="menu">' +
        '<h2 id="pwrTitle">Power</h2>' +
        '<p class="note">Reboot or shut down this Trace.</p>' +
        '<button type="button" class="pwr-btn pwr-scr hide" id="pwrScr" data-go="screen">Screen off</button>' +
        '<button type="button" class="pwr-btn" data-go="reboot">Reboot</button>' +
        '<button type="button" class="pwr-btn danger" data-go="poweroff">Shut down</button>' +
        '<button type="button" class="pwr-btn pwr-cancel">Cancel</button>' +
      '</div>' +
      '<div class="pwr-step hide" data-step="confirm">' +
        '<h2 id="pwrQ"></h2>' +
        '<p class="note" id="pwrQd"></p>' +
        '<button type="button" class="pwr-btn pwr-cancel primary">Cancel</button>' +
        '<button type="button" class="pwr-btn danger" id="pwrYes"></button>' +
        '<p class="status err" id="pwrErr" role="alert"></p>' +
      '</div>' +
    '</div>';
  const full = document.createElement('div');
  full.className = 'pwr-full hide'; full.id = 'pwrFull'; full.setAttribute('role', 'alertdialog'); full.setAttribute('aria-live', 'assertive');
  full.innerHTML = '<div class="pwr-full-in"><div class="pwr-ico">' + ICON + '</div>' +
    '<h1 id="pwrFT"></h1><p class="pwr-sub" id="pwrFS"></p><p class="note" id="pwrFS2"></p>' +
    '<p class="note pwr-brand">Stillwave Trace</p></div>';
  function mount() { document.body.appendChild(ov); document.body.appendChild(full); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  const q = sel => ov.querySelector(sel);
  let action = null, armTimer = null, lastFocus = null, stepAt = 0;
  function step(name) {
    stepAt = Date.now();
    ov.querySelectorAll('.pwr-step').forEach(s => s.classList.toggle('hide', s.dataset.step !== name));
  }
  function open() {
    lastFocus = document.activeElement;
    step('menu'); ov.classList.remove('hide'); document.documentElement.classList.add('pwr-open');
    q('[data-go="reboot"]').focus({ preventScroll: true });
    if (window.fieldnoteScreen) window.fieldnoteScreen.refresh();
  }
  function close() {
    clearTimeout(armTimer); action = null;
    ov.classList.add('hide'); document.documentElement.classList.remove('pwr-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function ask(a) {
    action = a;
    const t = TEXT[a];
    q('#pwrQ').textContent = t.q; q('#pwrQd').textContent = t.d;
    const yes = q('#pwrYes'); yes.textContent = t.yes; yes.disabled = true;
    q('#pwrErr').textContent = '';
    step('confirm');
    q('.pwr-step[data-step="confirm"] .pwr-cancel').focus({ preventScroll: true });
    clearTimeout(armTimer); armTimer = setTimeout(() => { yes.disabled = false; }, 700);
  }
  async function go() {
    const a = action; if (!a) return;
    const yes = q('#pwrYes'); yes.disabled = true; yes.textContent = 'Sending…';
    try {
      const r = await fetch('/api/power/' + a, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ confirm: a }) });
      let j = {}; try { j = await r.json(); } catch (e) {}
      if (r.status !== 202 || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      showFull(a);
    } catch (e) {
      q('#pwrErr').textContent = 'Did not work: ' + e.message;
      yes.textContent = TEXT[a].yes; yes.disabled = false;
    }
  }
  function showFull(a) {
    const t = TEXT[a];
    ov.classList.add('hide');
    full.classList.toggle('off', a === 'poweroff');
    full.querySelector('#pwrFT').textContent = t.title;
    full.querySelector('#pwrFS').textContent = t.sub;
    full.querySelector('#pwrFS2').textContent = t.sub2 || '';
    full.classList.remove('hide'); document.documentElement.classList.add('pwr-open');
    if (a === 'reboot') waitForReturn();
  }
  // after a reboot, reload once the box answers again (phones; the kiosk browser restarts anyway)
  function waitForReturn() {
    const t0 = Date.now(); let wentAway = false;
    const tick = async () => {
      const el = full.querySelector('#pwrFS2');
      try {
        const r = await fetch('/health?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok && wentAway) { el.textContent = 'Back. Reloading…'; setTimeout(() => location.reload(), 800); return; }
        if (r.ok && Date.now() - t0 > 45000) wentAway = true;   // answered all along: it may have been quick
      } catch (e) { wentAway = true; el.textContent = 'Waiting for Trace to come back…'; }
      if (Date.now() - t0 > 240000) { el.textContent = 'Still not back after 4 minutes. Check the power, then reconnect to its hotspot or your Wi-Fi.'; return; }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 4000);
  }

  btn.addEventListener('click', open);
  ov.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (Date.now() - stepAt < 450) return;   // the 2nd tap of a double tap lands on the new step: ignore it
    if (e.target === ov) return close();      // tap outside the sheet = cancel
    if (!b) return;
    if (b.classList.contains('pwr-cancel')) return close();
    if (b.dataset.go === 'screen') {           // kiosk: screen off; phone: turn the kiosk screen off / on (screen.js)
      close();
      if (window.fieldnoteScreen) window.fieldnoteScreen.toggle();
      return;
    }
    if (b.dataset.go) return ask(b.dataset.go);
    if (b.id === 'pwrYes') return go();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.classList.contains('hide')) close(); });
  window.fieldnotePower = { open, close, ask, showFull };
})();
