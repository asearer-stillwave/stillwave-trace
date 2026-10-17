// Stillwave Trace: on-screen keyboard for the kiosk (5" touch screen, ?kiosk=1). Load after /screen.js on every page.
// Slides up when a text / password / number field gets focus; phones keep their own keyboard (nothing happens there).
// Layouts: letters (Shift, Backspace, Space, Done), numbers, symbols; number fields (type=number,
// inputmode=decimal|numeric) open a number pad. Typing goes through setRangeText + "input" events, so page JS
// sees it as normal typing. Done fires "change" and closes. Chromium's own keyboard is held off with inputmode=none.
(function () {
  'use strict';
  const H = document.documentElement, D = document;
  const touch = () => (navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && matchMedia('(any-pointer: coarse)').matches);
  // desktop edition: on the HDMI monitor (html.hdmi) the keyboard only appears when a touch screen is present
  const kiosk = () => H.classList.contains('kiosk') && (!H.classList.contains('hdmi') || touch());
  const TYPES = ['text', 'password', 'search', 'email', 'url', 'tel', 'number', ''];
  const isField = el => el && ((el.tagName === 'INPUT' && TYPES.includes((el.getAttribute('type') || '').toLowerCase()))
    || el.tagName === 'TEXTAREA') && !el.readOnly && !el.disabled;
  const isNum = el => el.type === 'number' || /^(decimal|numeric)$/.test(el.dataset.kbdMode || el.getAttribute('inputmode') || '');

  const L = {
    abc: [['q','w','e','r','t','y','u','i','o','p'], ['a','s','d','f','g','h','j','k','l'],
          ['@shift','z','x','c','v','b','n','m','@bksp'], ['@123','@sym','@space','.','@done']],
    num: [['1','2','3','4','5','6','7','8','9','0'], ['-','/',':',';','(',')','$','&','@','"'],
          ['@sym','.',',','?','!',"'",'_','@bksp'], ['@abc','@space','@done']],
    sym: [['[',']','{','}','#','%','^','*','+','='], ['_','\\','|','~','<','>','€','£','¥','•'],
          ['@123','.',',','?','!',"'",'`','@bksp'], ['@abc','@space','@done']],
    pad: [['1','2','3'], ['4','5','6'], ['7','8','9'], ['-','0','.'], ['@abc','@bksp','@done']],
  };
  const NAMES = {'@shift': 'Shift', '@bksp': 'Del', '@123': '123', '@sym': '#+=', '@abc': 'ABC', '@space': 'Space', '@done': 'Done'};

  let kb = null, field = null, layout = 'abc', shift = 0, lastShift = 0, padH = 0;

  function build() {
    kb = D.createElement('div');
    kb.className = 'kbd'; kb.id = 'fieldnoteKbd'; kb.setAttribute('aria-hidden', 'true');
    kb.addEventListener('pointerdown', e => {          // keep focus in the field; act on press (fast on touch)
      e.preventDefault();
      const b = e.target.closest('button'); if (!b) return;
      b.classList.add('down'); press(b.dataset.k);
      if (b.dataset.k === '@bksp') startRepeat();
    });
    const up = () => { stopRepeat(); kb.querySelectorAll('.down').forEach(b => b.classList.remove('down')); };
    kb.addEventListener('pointerup', up); kb.addEventListener('pointercancel', up); kb.addEventListener('pointerleave', up);
    kb.addEventListener('touchstart', e => e.preventDefault(), {passive: false});
    kb.addEventListener('mousedown', e => e.preventDefault());
    kb.addEventListener('focusin', () => { if (field) field.focus({preventScroll: true}); });
    kb.addEventListener('click', e => e.preventDefault());
    D.body.appendChild(kb);
  }
  function render() {
    const rows = L[layout];
    kb.dataset.layout = layout;
    kb.innerHTML = rows.map(r => '<div class="kr">' + r.map(k => {
      const fn = k.length > 1 && k[0] === '@';
      const lab = fn ? NAMES[k] : (layout === 'abc' && shift ? k.toUpperCase() : k);
      const cls = 'kk' + (fn ? ' fn k-' + k.slice(1) : '') + (k === '@shift' && shift ? (shift === 2 ? ' on lock' : ' on') : '') + (k === '@done' ? ' done' : '');
      return '<button type="button" tabindex="-1" class="' + cls + '" data-k="' + esc(k) + '">' + esc(lab) + '</button>';
    }).join('') + '</div>').join('');
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  let rep = null;
  function startRepeat() { stopRepeat(); rep = setTimeout(function again() { press('@bksp'); rep = setTimeout(again, 70); }, 450); }
  function stopRepeat() { if (rep) clearTimeout(rep); rep = null; }

  function fire(type, inputType, data) {
    const ev = type === 'input' ? new InputEvent('input', {bubbles: true, inputType, data: data == null ? null : data})
                                : new Event(type, {bubbles: true});
    field.dispatchEvent(ev);
  }
  function caret() {
    try { if (typeof field.selectionStart === 'number') return [field.selectionStart, field.selectionEnd]; } catch (e) {}
    return null;                                       // type=number / email: no selection API, edit at the end
  }
  function insert(t) {
    const max = field.maxLength > 0 ? field.maxLength : Infinity;
    if (field.value.length >= max) return;
    const c = caret();
    if (c) field.setRangeText(t, c[0], c[1], 'end'); else field.value = field.value + t;
    fire('input', 'insertText', t);
  }
  function backspace() {
    const c = caret();
    if (c) {
      if (c[0] === c[1] && c[0] === 0) return;
      field.setRangeText('', c[0] === c[1] ? c[0] - 1 : c[0], c[1], 'end');
    } else {
      if (!field.value) return;
      field.value = field.value.slice(0, -1);
    }
    fire('input', 'deleteContentBackward', null);
  }
  function press(k) {
    if (!field) return;
    if (k === '@shift') {
      const now = Date.now(), dbl = now - lastShift < 400;   // double tap = caps lock
      shift = shift === 0 ? 1 : (shift === 1 && dbl ? 2 : 0);
      lastShift = now; render(); return;
    }
    if (k === '@bksp') return backspace();
    if (k === '@done') return close(true);
    if (k === '@123') { layout = isNum(field) ? 'pad' : 'num'; return render(); }
    if (k === '@sym') { layout = 'sym'; return render(); }
    if (k === '@abc') { layout = 'abc'; return render(); }
    if (k === '@space') return insert(' ');
    insert(layout === 'abc' && shift ? k.toUpperCase() : k);
    if (layout === 'abc' && shift === 1) { shift = 0; render(); }
  }

  function reveal() {                                   // keep the focused field above the keyboard
    if (!field || !kb) return;
    const kh = kb.getBoundingClientRect().height || padH;
    const top = parseFloat(getComputedStyle(H).getPropertyValue('--chrome-top')) || 63;
    const r = field.getBoundingClientRect();
    const room = innerHeight - kh;
    const want = top + Math.max(12, (room - top - r.height) / 3);
    if (r.top < top + 8 || r.bottom > room - 12) {
      try { field.scrollIntoView({block: 'nearest'}); } catch (e) {}
      const r2 = field.getBoundingClientRect();
      window.scrollBy({top: r2.top - want, behavior: 'auto'});
    }
  }
  function open(el) {
    if (!kb) build();
    if (field && field !== el) restoreMode(field);
    field = el;
    if (!('kbdMode' in el.dataset)) el.dataset.kbdMode = el.getAttribute('inputmode') || '';
    el.setAttribute('inputmode', 'none');               // no Chromium / system keyboard on top of ours
    layout = isNum(el) ? 'pad' : 'abc';
    shift = 0; render();
    kb.classList.add('open'); kb.setAttribute('aria-hidden', 'false');
    H.classList.add('kbd-open');
    padH = kb.getBoundingClientRect().height;
    D.body.style.paddingBottom = padH + 'px';
    requestAnimationFrame(() => setTimeout(reveal, 30));
  }
  function restoreMode(el) {
    if ('kbdMode' in el.dataset) {
      if (el.dataset.kbdMode) el.setAttribute('inputmode', el.dataset.kbdMode); else el.removeAttribute('inputmode');
      delete el.dataset.kbdMode;
    }
  }
  function close(done) {
    stopRepeat();
    if (field) {
      const f = field; field = null;
      restoreMode(f);
      if (done) { f.dispatchEvent(new Event('change', {bubbles: true})); f.blur(); }
    }
    if (kb) { kb.classList.remove('open'); kb.setAttribute('aria-hidden', 'true'); }
    H.classList.remove('kbd-open'); D.body.style.paddingBottom = '';
  }

  D.addEventListener('focusin', e => {
    if (!kiosk() || !isField(e.target)) return;
    open(e.target);
  });
  D.addEventListener('focusout', e => {
    if (e.target !== field) return;
    setTimeout(() => {
      if (!field || D.activeElement === field || isField(D.activeElement)) return;
      if (kb && kb.contains(D.activeElement)) { field.focus({preventScroll: true}); return; }
      close(false);
    }, 120);
  });
  // a tap outside the keyboard and the field closes it (like a phone)
  D.addEventListener('pointerdown', e => {
    if (!field || !kb) return;
    if (kb.contains(e.target) || e.target === field || isField(e.target)) return;
    close(false); if (D.activeElement && D.activeElement.blur) D.activeElement.blur();
  }, true);
  // 1.2.0 hardware keyboard Shift fallback (kiosk only). On the desktop kiosk (cage + Chromium/Wayland) a Logitech K830
  // sends KEY_LEFTSHIFT (evtest sees it) but the browser could still type lowercase / unshifted symbols: the keyboard
  // shows up as several input devices and the modifier state of one is not applied to keys from the other. We track
  // physical Shift by e.code ourselves and, only when the browser delivers the UNSHIFTED character while Shift is held,
  // type the US shifted character instead. When Shift works normally this never triggers.
  const SHIFTED = {Backquote: '~', Digit1: '!', Digit2: '@', Digit3: '#', Digit4: '$', Digit5: '%', Digit6: '^', Digit7: '&', Digit8: '*',
    Digit9: '(', Digit0: ')', Minus: '_', Equal: '+', BracketLeft: '{', BracketRight: '}', Backslash: '|', Semicolon: ':', Quote: '"',
    Comma: '<', Period: '>', Slash: '?'};
  const PLAIN = {Backquote: '`', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8',
    Digit9: '9', Digit0: '0', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/'};
  let hwShift = 0;
  const isShiftCode = c => c === 'ShiftLeft' || c === 'ShiftRight';
  D.addEventListener('keydown', e => { if (isShiftCode(e.code) || e.key === 'Shift') hwShift = Date.now(); }, true);
  D.addEventListener('keyup', e => { if (isShiftCode(e.code) || e.key === 'Shift') hwShift = 0; }, true);
  window.addEventListener('blur', () => { hwShift = 0; });
  D.addEventListener('keydown', e => {
    if (!H.classList.contains('kiosk') || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const t = e.target; if (!isField(t)) return;
    const held = e.shiftKey || (hwShift && Date.now() - hwShift < 30000);
    if (!held) return;
    let want = null;
    if (/^Key[A-Z]$/.test(e.code) && e.key === e.code.slice(3).toLowerCase()) want = e.code.slice(3);
    else if (PLAIN[e.code] && e.key === PLAIN[e.code]) want = SHIFTED[e.code];
    if (!want) return;                                  // the browser already applied Shift: leave it alone
    e.preventDefault();
    const was = field; field = t;
    try { insert(want); } finally { field = was; }
  }, true);
  // hardware keyboard Enter / Escape still work
  D.addEventListener('keydown', e => { if (field && e.key === 'Escape') close(false); });
  window.fieldnoteKbd = {open: el => isField(el) && open(el), close: () => close(false), get field() { return field; }};
  // field already focused before this script ran (autofocus)
  const go = () => { if (kiosk() && isField(D.activeElement)) open(D.activeElement); };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', go); else go();
})();
