/* Drawer behaviour for the AppShell markup of the losoft App system (the React AppShell does the same in the bundle).
   The shell measures its own width: below 720px the sidebar is an off-canvas drawer opened from the menu button;
   focus is trapped while open; Escape, the scrim, the close button or a link click close it and focus returns to the menu button.
   The page runtime may re-render class names, so the state is re-applied whenever the shell's attributes change. */
(function () {
  function init(shell) {
    if (shell.__laInit) return; shell.__laInit = true;
    var side = shell.querySelector('.la-shell__side'), menu = shell.querySelector('.la-shell__menu'), scrim = shell.querySelector('.la-shell__scrim'), main = shell.querySelector('.la-shell__main'), closeBtn = shell.querySelector('.la-shell__drawer-close');
    if (!side || !menu) return;
    var st = { narrow: false, open: false }, busy = false;
    function apply() {
      if (busy) return; busy = true;
      var o = st.narrow && st.open;
      if (shell.classList.contains('la-shell--narrow') !== st.narrow) shell.classList.toggle('la-shell--narrow', st.narrow);
      if (shell.classList.contains('la-shell--drawer-open') !== o) shell.classList.toggle('la-shell--drawer-open', o);
      // set only on change: a same-value write still fires the MutationObserver and would loop forever
      if (menu.hidden === st.narrow) menu.hidden = !st.narrow;
      if (closeBtn && closeBtn.hidden === st.narrow) closeBtn.hidden = !st.narrow;
      var ex = o ? 'true' : 'false'; if (menu.getAttribute('aria-expanded') !== ex) menu.setAttribute('aria-expanded', ex);
      if (o && !main.hasAttribute('inert')) main.setAttribute('inert', ''); else if (!o && main.hasAttribute('inert')) main.removeAttribute('inert');
      busy = false;
    }
    function setOpen(v, back) {
      st.open = v && st.narrow; apply();
      if (st.open) { var f = side.querySelector('a[href]'); if (f) f.focus(); }
      else if (back) menu.focus();
    }
    function measure() { st.narrow = shell.getBoundingClientRect().width < 720; if (!st.narrow) st.open = false; apply(); }
    menu.addEventListener('click', function () { setOpen(true); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false, true); });
    if (scrim) scrim.addEventListener('click', function () { setOpen(false, true); });
    side.addEventListener('click', function (e) { if (st.open && e.target.closest && e.target.closest('a')) setOpen(false, true); });
    shell.addEventListener('keydown', function (e) {
      if (!st.open) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false, true); return; }
      if (e.key !== 'Tab') return;
      var f = side.querySelectorAll('a[href],button:not([disabled]):not([hidden]),input:not([disabled]),select,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return; var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () { apply(); });
      mo.observe(shell, { attributes: true, attributeFilter: ['class'] });
      mo.observe(menu, { attributes: true, attributeFilter: ['hidden', 'aria-expanded'] });
      mo.observe(main, { attributes: true, attributeFilter: ['inert'] });
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(shell); else window.addEventListener('resize', measure);
    measure();
  }
  function scan() { var s = document.querySelectorAll('.la-shell'); for (var i = 0; i < s.length; i++) init(s[i]); }
  if (typeof MutationObserver !== 'undefined') new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan); scan();
})();
