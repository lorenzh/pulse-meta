/* @ds-bundle: {"format":4,"namespace":"LosoftApp","components":[{"name":"Icon"},{"name":"Button"},{"name":"IconButton"},{"name":"Field"},{"name":"Checkbox"},{"name":"Switch"},{"name":"Segmented"},{"name":"Tabs"},{"name":"Breadcrumbs"},{"name":"Menu"},{"name":"Dialog"},{"name":"StatusDot"},{"name":"Badge"},{"name":"Kbd"},{"name":"Callout"},{"name":"Panel"},{"name":"AppShell"},{"name":"WorkspaceSwitcher"},{"name":"UserMenu"},{"name":"Avatar"},{"name":"DetailPanel"},{"name":"StatusBar"},{"name":"Timeline"},{"name":"Steps"},{"name":"CodeBlock"},{"name":"LineChart"},{"name":"AreaChart"},{"name":"BarChart"},{"name":"Heatmap"},{"name":"LatencyBand"},{"name":"Sparkline"},{"name":"ChartFrame"},{"name":"ChartLegend"},{"name":"ChartTooltip"},{"name":"SidebarNav"},{"name":"PageHeader"},{"name":"Toolbar"},{"name":"DataTable"},{"name":"StatCard"},{"name":"KpiStrip"},{"name":"UptimeBar"},{"name":"EmptyState"},{"name":"Toast"},{"name":"FormLayout"}]} */
(function () {
  "use strict";
  var React = window.React;
  var h = React.createElement;
  var ShellCtx = React.createContext({ narrow: false });
  var useState = React.useState, useRef = React.useRef, useEffect = React.useEffect, useId = React.useId;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(" ");
  }
  var NEW_TAB = /^(?:https?:)?\/\//i;
  function linkProps(href) { return href && NEW_TAB.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {}; }

  /* ---------- Icon (Lucide shapes: 24px grid, 2px stroke, round caps, no fill) ---------- */
  function P(d) { return h("path", { d: d }); }
  function Ci(cx_, cy, r) { return h("circle", { cx: cx_, cy: cy, r: r }); }
  function Rc(x, y, w, hh, rx) { return h("rect", { x: x, y: y, width: w, height: hh, rx: rx }); }
  var ICONS = {
    plus: [P("M5 12h14"), P("M12 5v14")],
    search: [Ci(11, 11, 8), P("m21 21-4.3-4.3")],
    "chevron-down": [P("m6 9 6 6 6-6")],
    "chevron-up": [P("m18 15-6-6-6 6")],
    "chevron-left": [P("m15 18-6-6 6-6")],
    "chevron-right": [P("m9 18 6-6-6-6")],
    "chevrons-up-down": [P("m7 15 5 5 5-5"), P("m7 9 5-5 5 5")],
    "arrow-up": [P("m5 12 7-7 7 7"), P("M12 19V5")],
    "arrow-down": [P("M12 5v14"), P("m19 12-7 7-7-7")],
    "arrow-right": [P("M5 12h14"), P("m13 6 6 6-6 6")],
    "arrow-up-right": [P("M7 17 17 7"), P("M8 7h9v9")],
    x: [P("M18 6 6 18"), P("m6 6 12 12")],
    check: [P("M20 6 9 17l-5-5")],
    "more-vertical": [Ci(12, 12, 1), Ci(12, 5, 1), Ci(12, 19, 1)],
    "more-horizontal": [Ci(12, 12, 1), Ci(19, 12, 1), Ci(5, 12, 1)],
    menu: [P("M4 12h16"), P("M4 6h16"), P("M4 18h16")],
    moon: [P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")],
    sun: [Ci(12, 12, 4), P("M12 2v2"), P("M12 20v2"), P("m4.93 4.93 1.41 1.41"), P("m17.66 17.66 1.41 1.41"), P("M2 12h2"), P("M20 12h2"), P("m6.34 17.66-1.41 1.41"), P("m19.07 4.93-1.41 1.41")],
    info: [Ci(12, 12, 10), P("M12 16v-4"), P("M12 8h.01")],
    "alert-triangle": [P("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"), P("M12 9v4"), P("M12 17h.01")],
    "alert-circle": [Ci(12, 12, 10), P("M12 8v4"), P("M12 16h.01")],
    "check-circle": [Ci(12, 12, 10), P("m9 12 2 2 4-4")],
    activity: [P("M22 12h-4l-3 9L9 3l-3 9H2")],
    dashboard: [Rc(3, 3, 7, 9, 1), Rc(14, 3, 7, 5, 1), Rc(14, 12, 7, 9, 1), Rc(3, 16, 7, 5, 1)],
    bell: [P("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), P("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
    users: [P("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"), Ci(9, 7, 4), P("M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75")],
    key: [Ci(7.5, 15.5, 5.5), P("m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3")],
    shield: [P("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z")],
    "credit-card": [Rc(2, 5, 20, 14, 2), P("M2 10h20")],
    monitor: [Rc(2, 3, 20, 14, 2), P("M8 21h8M12 17v4")],
    trash: [P("M3 6h18"), P("M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"), P("M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"), P("M10 11v6"), P("M14 11v6")],
    copy: [Rc(8, 8, 14, 14, 2), P("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2")],
    pencil: [P("M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"), P("m15 5 4 4")],
    pause: [Rc(14, 4, 4, 16, 1), Rc(6, 4, 4, 16, 1)],
    play: [h("polygon", { points: "6 3 20 12 6 21 6 3" })],
    "external-link": [P("M15 3h6v6"), P("M10 14 21 3"), P("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")],
    refresh: [P("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"), P("M21 3v5h-5"), P("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"), P("M8 16H3v5")],
    loader: [P("M21 12a9 9 0 1 1-6.219-8.56")],
    "log-out": [P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"), P("m16 17 5-5-5-5"), P("M21 12H9")],
    clock: [Ci(12, 12, 10), P("M12 6v6l4 2")],
    github: [P("M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"), P("M9 18c-4.51 2-5-2-7-2")]
  };
  function Icon(props) {
    var name = props.name, size = props.size || 16;
    var rest = {};
    for (var k in props) if (k !== "name" && k !== "size" && k !== "className") rest[k] = props[k];
    return h("svg", Object.assign({
      className: cx("la-icon", props.className), width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
      "aria-hidden": "true", focusable: "false"
    }, rest), ICONS[name] || null);
  }
  Icon.names = Object.keys(ICONS);

  /* ---------- Button, IconButton ---------- */
  function Button(props) {
    var variant = props.variant || "secondary", size = props.size || "md";
    var cls = cx("la-btn", "la-btn--" + variant, size !== "md" && "la-btn--" + size, props.block && "la-btn--block", props.loading && "la-btn--loading", props.className);
    var content = [
      props.loading ? h(Icon, { key: "s", name: "loader", className: "la-spin" }) : (props.icon ? h(Icon, { key: "i", name: props.icon }) : null),
      h("span", { key: "l", className: "la-btn__label" }, props.children),
      props.iconEnd && !props.loading ? h(Icon, { key: "e", name: props.iconEnd }) : null
    ];
    var extra = (props.onClick || props.loading)
      ? { onClick: function (e) { if (props.loading) { e.preventDefault(); return; } props.onClick && props.onClick(e); } } : {};
    if (props.href && !props.disabled && !props.loading) {
      return h("a", Object.assign({ className: cls, href: props.href }, linkProps(props.href), extra), content,
        NEW_TAB.test(props.href) ? h("span", { className: "la-sr" }, " (opens in a new tab)") : null);
    }
    return h("button", Object.assign({ type: props.type || "button", className: cls, disabled: props.disabled || undefined, "aria-disabled": props.loading ? "true" : undefined, "aria-busy": props.loading || undefined }, extra), content);
  }
  function IconButton(props) {
    var size = props.size || "md";
    return h("button", Object.assign({
      type: "button", className: cx("la-iconbtn", size !== "md" && "la-iconbtn--" + size, props.variant === "secondary" && "la-iconbtn--secondary", props.className),
      "aria-label": props.label, title: props.label, disabled: props.disabled || undefined,
      "aria-pressed": props.pressed === undefined ? undefined : props.pressed, onClick: props.onClick
    }, props.aria || {}, props.buttonRef ? { ref: props.buttonRef } : {}), h(Icon, { name: props.icon, size: size === "sm" ? 14 : 16 }));
  }

  /* ---------- Field ---------- */
  function Field(props) {
    var autoId = useId();
    var id = props.id || "la-f-" + autoId.replace(/:/g, "");
    var as = props.as || "input", size = props.size || "md";
    var descIds = [];
    var helpId = props.help ? id + "-help" : null, errId = props.error ? id + "-err" : null;
    if (helpId) descIds.push(helpId);
    if (errId) descIds.push(errId);
    var common = {
      id: id, name: props.name, value: props.value, defaultValue: props.defaultValue, onChange: props.onChange, onBlur: props.onBlur,
      placeholder: props.placeholder, disabled: props.disabled || undefined, required: props.required || undefined, readOnly: props.readOnly || undefined,
      "aria-invalid": props.error ? "true" : undefined, "aria-describedby": descIds.length ? descIds.join(" ") : undefined
    };
    var control;
    if (as === "textarea") {
      control = h("textarea", Object.assign({ className: cx("la-textarea", props.mono && "la-textarea--mono"), rows: props.rows || 3 }, common));
    } else if (as === "select") {
      var opts = (props.options || []).map(function (o) {
        var v = typeof o === "string" ? { value: o, label: o } : o;
        return h("option", { key: v.value, value: v.value, disabled: v.disabled }, v.label);
      });
      control = h("span", { className: cx("la-select", size !== "md" && "la-select--" + size) },
        h("select", common, opts, props.children),
        h("span", { className: "la-select__chev" }, h(Icon, { name: "chevron-down" })));
    } else {
      var input = h("input", Object.assign({
        className: cx("la-input", size !== "md" && "la-input--" + size, props.mono && "la-input--mono", props.prefix && "la-input--prefix", props.suffix && "la-input--suffix"),
        type: props.type || "text", autoComplete: props.autoComplete
      }, common));
      control = (props.prefix || props.suffix)
        ? h("span", { className: "la-input-wrap" },
            props.prefix ? h("span", { className: "la-input-wrap__prefix" }, typeof props.prefix === "string" ? h(Icon, { name: props.prefix }) : props.prefix) : null,
            input,
            props.suffix ? h("span", { className: "la-input-wrap__suffix" }, props.suffix) : null)
        : input;
    }
    var label = props.label ? h("label", { className: cx("la-field__label", props.hideLabel && "la-sr"), htmlFor: id }, props.label,
      props.optional ? h("span", { className: "la-field__optional" }, "(optional)") : null) : null;
    if (props.inline) return h("div", { className: cx("la-field la-field--inline", props.className) }, label, control);
    return h("div", { className: cx("la-field", props.className) }, label,
      props.help ? h("p", { id: helpId, className: "la-field__help" }, props.help) : null,
      control,
      props.error ? h("p", { id: errId, className: "la-field__error" }, h(Icon, { name: "alert-circle", size: 14 }), props.error) : null);
  }

  /* ---------- Checkbox, Switch ---------- */
  function Checkbox(props) {
    var ref = useRef(null);
    useEffect(function () { if (ref.current) ref.current.indeterminate = !!props.indeterminate; }, [props.indeterminate]);
    var input = h("input", {
      ref: ref, type: "checkbox", checked: props.checked, defaultChecked: props.defaultChecked, onChange: props.onChange,
      disabled: props.disabled || undefined, name: props.name, "aria-label": props.label ? undefined : props.ariaLabel
    });
    if (!props.label) return h("span", { className: cx("la-check la-check--bare", props.className) }, input);
    return h("label", { className: cx("la-check", props.className) }, input,
      h("span", { className: "la-check__text" }, props.label, props.help ? h("span", { className: "la-check__help" }, props.help) : null));
  }
  function Switch(props) {
    var id = "la-sw-" + useId().replace(/:/g, "");
    return h("div", { className: cx("la-switch", props.className) },
      h("span", { className: "la-switch__text" }, h("span", { id: id }, props.label), props.help ? h("span", { className: "la-check__help" }, props.help) : null),
      h("button", { type: "button", role: "switch", className: "la-switch__btn", "aria-checked": !!props.checked, "aria-labelledby": id, disabled: props.disabled || undefined, onClick: function () { props.onChange && props.onChange(!props.checked); } }));
  }

  /* ---------- Segmented, Tabs, Breadcrumbs ---------- */
  function Segmented(props) {
    return h("div", { className: cx("la-seg", props.size === "sm" && "la-seg--sm", props.className), role: "group", "aria-label": props.label },
      props.options.map(function (o) {
        var opt = typeof o === "string" ? { value: o, label: o } : o;
        return h("button", { key: opt.value, type: "button", className: "la-seg__item", "aria-pressed": props.value === opt.value, onClick: function () { props.onChange && props.onChange(opt.value); } }, opt.label);
      }));
  }
  function Tabs(props) {
    var tabs = props.tabs, refs = useRef({});
    var baseId = "la-tabs-" + useId().replace(/:/g, "");
    function move(i) {
      var t = tabs[(i + tabs.length) % tabs.length];
      props.onChange && props.onChange(t.id);
      var el = refs.current[t.id]; if (el) el.focus();
    }
    function onKey(e, i) {
      if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); }
      else if (e.key === "Home") { e.preventDefault(); move(0); }
      else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
    }
    return h("div", { className: cx("la-tabs", props.className), role: "tablist", "aria-label": props.label },
      tabs.map(function (t, i) {
        var sel = t.id === props.value;
        return h("button", {
          key: t.id, type: "button", role: "tab", id: baseId + "-" + t.id, "aria-selected": sel, "aria-controls": props.panelId || undefined,
          tabIndex: sel ? 0 : -1, className: "la-tabs__tab", ref: function (el) { refs.current[t.id] = el; },
          onClick: function () { props.onChange && props.onChange(t.id); }, onKeyDown: function (e) { onKey(e, i); }
        }, t.label, t.count !== undefined ? h("span", { className: "la-tabs__count" }, t.count) : null);
      }));
  }
  function Breadcrumbs(props) {
    var items = props.items;
    var out = [];
    items.forEach(function (it, i) {
      var last = i === items.length - 1;
      if (i > 0) out.push(h("li", { key: "s" + i, "aria-hidden": "true" }, "/"));
      out.push(h("li", { key: i }, last || !it.href ? h("span", { "aria-current": last ? "page" : undefined }, it.label) : h("a", Object.assign({ href: it.href }, linkProps(it.href)), it.label, NEW_TAB.test(it.href) ? h("span", { className: "la-sr" }, " (opens in a new tab)") : null)));
    });
    return h("nav", { className: cx("la-crumbs", props.className), "aria-label": "Breadcrumb" }, h("ol", null, out));
  }

  /* ---------- Menu ---------- */
  function Menu(props) {
    var _s = useState(!!props.defaultOpen), open = _s[0], setOpen = _s[1];
    var _p = useState(null), pos = _p[0], setPos = _p[1];
    var wrap = useRef(null), trig = useRef(null), menuRef = useRef(null);
    var items = props.items || [];
    React.useLayoutEffect(function () {
      if (!open || !wrap.current) return;
      var r = wrap.current.getBoundingClientRect();
      setPos(props.align === "start" ? { top: r.bottom + 4, left: r.left } : { top: r.bottom + 4, right: window.innerWidth - r.right });
    }, [open]);
    useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); }
      document.addEventListener("mousedown", onDoc);
      return function () { document.removeEventListener("mousedown", onDoc); };
    }, [open]);
    function enabled() { return Array.prototype.slice.call(menuRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')); }
    function onKey(e) {
      if (!menuRef.current) return;
      var els = enabled(), i = els.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); els[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); els[els.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); setOpen(false); if (trig.current) trig.current.focus(); }
      else if (e.key === "Tab") setOpen(false);
    }
    useEffect(function () { if (open && menuRef.current && !props.defaultOpen) { var els = enabled(); if (els[0]) els[0].focus(); } }, [open, !!pos]);
    var aria = { "aria-haspopup": "menu", "aria-expanded": open };
    var trigger = props.triggerContent
      ? h("button", { type: "button", ref: trig, className: cx("la-trigger", props.round && "la-trigger--round"), "aria-label": props.triggerLabelText, "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(!open); } }, props.triggerContent)
      : props.triggerLabel
      ? h("button", { type: "button", ref: trig, className: cx("la-btn", "la-btn--" + (props.variant || "secondary"), props.size && props.size !== "md" && "la-btn--" + props.size), "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(!open); } },
          h("span", { className: "la-btn__label" }, props.triggerLabel), h(Icon, { name: "chevron-down" }))
      : h(IconButton, { icon: props.icon || "more-vertical", label: props.label, size: props.size, aria: aria, buttonRef: trig, onClick: function () { setOpen(!open); } });
    return h("div", { className: cx("la-menu-wrap", props.className), ref: wrap },
      trigger,
      open ? h("div", { className: cx("la-menu", props.align === "start" ? "la-menu--start" : "la-menu--end"), role: "menu", "aria-label": props.label, ref: menuRef, onKeyDown: onKey, style: pos || { visibility: "hidden" } },
        props.header ? h("div", { className: "la-menu__head" }, props.header) : null,
        items.map(function (it, i) {
          if (it.separator) return h("div", { key: "sep" + i, className: "la-menu__sep", role: "separator" });
          return h("button", {
            key: it.label, type: "button", role: "menuitem", tabIndex: -1, "aria-disabled": it.disabled ? "true" : undefined,
            className: cx("la-menu__item", it.danger && "la-menu__item--danger"),
            onClick: function () { if (it.disabled) return; setOpen(false); if (trig.current) trig.current.focus(); it.onSelect && it.onSelect(); }
          }, it.icon ? h(Icon, { name: it.icon }) : null, h("span", { className: "la-menu__label" }, it.label), it.kbd ? h("span", { className: "la-menu__kbd" }, it.kbd) : null, it.checked ? h(Icon, { name: "check", className: "la-menu__check" }) : null);
        })) : null);
  }

  /* ---------- Dialog ---------- */
  function Dialog(props) {
    var dlg = useRef(null), prev = useRef(null);
    var titleId = "la-dlg-" + useId().replace(/:/g, "");
    useEffect(function () {
      if (!props.open) return;
      prev.current = document.activeElement;
      var first = dlg.current && dlg.current.querySelector("[data-autofocus],input,select,textarea,button:not([data-close])");
      (first || dlg.current).focus();
      return function () { if (prev.current && prev.current.focus) prev.current.focus(); };
    }, [props.open]);
    if (!props.open) return null;
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); props.onClose && props.onClose(); return; }
      if (e.key !== "Tab") return;
      var f = dlg.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
    return h("div", { className: cx("la-scrim", props.contained && "la-scrim--contained") },
      h("div", { className: cx("la-dialog", props.size && "la-dialog--" + props.size), role: props.alert ? "alertdialog" : "dialog", "aria-modal": "true", "aria-labelledby": titleId, ref: dlg, tabIndex: -1, onKeyDown: onKey },
        h("div", { className: "la-dialog__head" },
          h("div", { className: "la-dialog__titles" }, h("h2", { id: titleId, className: "la-dialog__title" }, props.title), props.subtitle ? h("span", { className: "la-dialog__sub" }, props.subtitle) : null),
          h("button", { type: "button", className: "la-iconbtn la-iconbtn--sm", "aria-label": "Close", "data-close": "1", onClick: props.onClose }, h(Icon, { name: "x", size: 14 }))),
        h("div", { className: "la-dialog__body" }, props.children),
        props.footer ? h("div", { className: "la-dialog__foot" }, props.footer) : null));
  }

  /* ---------- StatusDot, Badge, Kbd ---------- */
  var STATUS_LABEL = { up: "Up", degraded: "Degraded", down: "Down", unknown: "Unknown", maintenance: "Maintenance" };
  function StatusDot(props) {
    var s = props.status || "unknown";
    return h("span", { className: cx("la-status", "la-status--" + s, props.dense && "la-status--dense", props.className) },
      h("span", { className: "la-status__mark", "aria-hidden": "true" }),
      props.hideLabel ? h("span", { className: "la-sr" }, props.label || STATUS_LABEL[s]) : h("span", { className: "la-status__label" }, props.label || STATUS_LABEL[s]));
  }
  function Badge(props) {
    var tone = props.tone || "neutral";
    return h("span", { className: cx("la-badge", tone !== "neutral" && "la-badge--" + tone, props.mono && "la-badge--mono", props.className) }, props.children);
  }
  function Kbd(props) { return h("kbd", { className: cx("la-kbd", props.className) }, props.children); }

  /* ---------- Callout ---------- */
  var TONE_ICON = { info: "info", success: "check-circle", warning: "alert-triangle", error: "alert-circle", neutral: "info" };
  function Callout(props) {
    var tone = props.tone || "neutral";
    return h("div", { className: cx("la-callout", tone !== "neutral" && "la-callout--" + tone, props.banner && "la-callout--banner", props.className), role: props.alert ? "alert" : "status" },
      h(Icon, { name: TONE_ICON[tone], className: "la-callout__icon" }),
      h("div", { className: "la-callout__body" }, props.title ? h("p", { className: "la-callout__title" }, props.title) : null, h(props.banner ? "span" : "div", { className: "la-callout__text" }, props.children)),
      props.action ? h("div", { className: "la-callout__action" }, props.action) : null);
  }

  /* ---------- Panel ---------- */
  function Panel(props) {
    return h("section", { className: cx("la-panel", props.className), "aria-label": props.title ? undefined : props.label },
      props.title || props.actions ? h("header", { className: "la-panel__head" }, h("h3", { className: "la-panel__title" }, props.title), props.actions) : null,
      h("div", { className: cx("la-panel__body", props.flush && "la-panel__body--flush") }, props.children),
      props.footer ? h("footer", { className: "la-panel__foot" }, props.footer) : null);
  }

  /* ---------- AppShell, SidebarNav, PageHeader, Toolbar ---------- */
  function AppShell(props) {
    var _n = useState(false), narrow = _n[0], setNarrow = _n[1];
    var _o = useState(false), openState = _o[0], setOpenState = _o[1];
    var open = props.navOpen !== undefined ? props.navOpen : openState;
    var root = useRef(null), menuBtn = useRef(null), drawer = useRef(null);
    var drawerId = "la-drawer-" + useId().replace(/:/g, "");
    function setOpen(v) { if (props.navOpen === undefined) setOpenState(v); props.onNavOpenChange && props.onNavOpenChange(v); }
    /* The shell, not the viewport, decides: below 720px of its own width the sidebar is an off-canvas drawer. */
    React.useLayoutEffect(function () {
      var el = root.current; if (!el) return;
      function measure() { setNarrow(el.getBoundingClientRect().width < 720); }
      measure();
      if (typeof ResizeObserver !== "undefined") { var ro = new ResizeObserver(measure); ro.observe(el); return function () { ro.disconnect(); }; }
      window.addEventListener("resize", measure); return function () { window.removeEventListener("resize", measure); };
    }, []);
    var drawerOpen = narrow && open;
    useEffect(function () {
      if (drawerOpen && drawer.current) { var f = drawer.current.querySelector("a[href],button:not([data-close])"); if (f) f.focus(); }
    }, [drawerOpen]);
    var backFocus = useRef(false);
    function close(back) { backFocus.current = !!back; setOpen(false); }
    useEffect(function () { if (!drawerOpen && backFocus.current) { backFocus.current = false; if (menuBtn.current) menuBtn.current.focus(); } }, [drawerOpen]);
    function onKey(e) {
      if (!drawerOpen) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key !== "Tab") return;
      var f = drawer.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
    return h(ShellCtx.Provider, { value: { narrow: narrow } },
      h("div", { className: cx("la-shell", props.contained && "la-shell--contained", narrow && "la-shell--narrow", drawerOpen && "la-shell--drawer-open", props.sidebarCollapsed && !narrow && "la-shell--collapsed", props.className), style: props.style, ref: root },
        h("aside", { className: "la-shell__side", id: drawerId, ref: drawer, "aria-label": props.sidebarLabel || "Sidebar", onKeyDown: onKey, onClick: function (e) { if (drawerOpen && e.target.closest && e.target.closest("a")) close(true); } },
          narrow ? h("button", { type: "button", className: "la-iconbtn la-iconbtn--sm la-shell__drawer-close", "aria-label": "Close navigation", "data-close": "1", onClick: function () { close(true); } }, h(Icon, { name: "x", size: 14 })) : null,
          props.sidebar),
        narrow ? h("div", { className: "la-shell__scrim", onClick: function () { close(true); } }) : null,
        h("div", { className: "la-shell__main", inert: drawerOpen ? "" : undefined },
          h("header", { className: "la-shell__top" },
            narrow ? h(IconButton, { icon: "menu", label: "Open navigation", buttonRef: menuBtn, aria: { "aria-expanded": drawerOpen, "aria-controls": drawerId }, onClick: function () { setOpen(true); } }) : null,
            props.topbar),
          h("div", { className: "la-shell__banner" }, props.banner),
          h("div", { className: "la-shell__body" },
            h("main", { className: cx("la-shell__content", props.padded && "la-shell__content--padded"), id: "la-main" }, props.children),
            props.detail ? h("aside", { className: "la-shell__detail", "aria-label": props.detailLabel || "Details" }, props.detail) : null),
          h("div", { className: "la-shell__status" }, props.statusbar))));
  }
  function SidebarNav(props) {
    var ctx = React.useContext(ShellCtx);
    var col = !!props.collapsed && !ctx.narrow;
    var brand = props.brand;
    return h("div", { className: cx("la-side", col && "la-side--collapsed") },
      brand ? h("a", { className: "la-side__brand", href: brand.href || "#", "aria-label": brand.name + (brand.sub ? " " + brand.sub : "") + " home" },
        brand.mark ? h("img", { className: "la-side__mark", src: brand.mark, alt: "", width: 24, height: 24 }) : (col ? h("span", { className: "la-side__name" }, brand.name.charAt(0)) : null),
        col ? null : h("span", { className: "la-side__name" }, brand.name), col || brand.cursor === false ? null : h("span", { className: "la-side__cursor", "aria-hidden": "true" }),
        col || !brand.sub ? null : h("span", { className: "la-side__sub" }, brand.sub)) : null,
      col ? null : props.header,
      h("nav", { className: "la-side__nav", "aria-label": props.label || "Main" },
        (props.sections || []).map(function (sec, si) {
          return h(React.Fragment, { key: si },
            sec.title ? (col ? (si ? h("div", { className: "la-side__sep", "aria-hidden": "true" }) : null) : h("p", { className: "la-side__group" }, sec.title)) : (col && si ? h("div", { className: "la-side__sep", "aria-hidden": "true" }) : null),
            sec.items.map(function (it) {
              var num = typeof it.count === "number";
              var tip = it.label + (it.count !== undefined ? " \u00b7 " + it.count : "");
              return h("a", { key: it.id, href: it.href || "#", className: cx("la-side__link", col && "la-side__link--icon"), "aria-current": it.current ? "page" : undefined, onClick: it.onClick, "data-tip": col ? tip : undefined },
                it.icon ? h(Icon, { name: it.icon }) : null,
                col ? h("span", { className: "la-sr" }, it.label + " ") : it.label,
                it.count !== undefined
                  ? (col
                    ? h("span", { className: cx("la-side__badge", !num && "la-side__badge--dot", it.countTone === "error" && "la-side__badge--error") }, num ? it.count : h("span", { className: "la-sr" }, it.count), num ? null : null)
                    : h("span", { className: cx("la-side__count", it.countTone === "error" && "la-side__count--error") }, it.count))
                  : null);
            }));
        })),
      props.onToggleCollapsed && !ctx.narrow ? h("div", { className: "la-side__toggle" }, h(IconButton, { icon: col ? "chevron-right" : "chevron-left", label: col ? "Expand sidebar" : "Collapse sidebar", size: "sm", aria: { "aria-expanded": !col }, onClick: props.onToggleCollapsed })) : null,
      props.footer && !col ? h("div", { className: "la-side__foot" }, props.footer) : null);
  }
  function PageHeader(props) {
    return h("div", { className: cx("la-page", props.className) },
      props.breadcrumbs ? h(Breadcrumbs, { items: props.breadcrumbs }) : null,
      h("div", { className: "la-page__row" },
        h("h1", { className: "la-page__title" }, props.title),
        props.count !== undefined ? h(Badge, null, props.count) : null,
        props.subtitle ? h("p", { className: "la-page__sub" }, props.subtitle) : null,
        props.actions ? h("div", { className: "la-page__actions" }, props.actions) : null));
  }
  function Toolbar(props) {
    var s = props.search;
    return h("div", { className: cx("la-toolbar", props.className), role: "search", "aria-label": props.label || "Filters" },
      s ? h("div", { className: "la-toolbar__search" }, h(Field, { label: s.label || "Search", type: "search", prefix: "search", size: "md", placeholder: s.placeholder, value: s.value, onChange: s.onChange, hideLabel: true })) : null,
      props.children,
      props.end ? h("div", { className: "la-toolbar__end", role: "status" }, props.end) : null);
  }

  /* ---------- DataTable, EmptyState ---------- */
  function EmptyState(props) {
    return h("div", { className: cx("la-empty", props.className) },
      props.icon ? h("span", { className: "la-empty__icon" }, h(Icon, { name: props.icon, size: 20 })) : null,
      h("p", { className: "la-empty__title" }, props.title),
      props.description ? h("p", { className: "la-empty__text" }, props.description) : null,
      props.action ? h("div", { className: "la-empty__action" }, props.action) : null);
  }
  function DataTable(props) {
    var cols = props.columns, rows = props.rows || [], key = props.rowKey || "id";
    var sel = props.selected || [], sortBy = props.sort, click = props.onRowClick;
    var allSel = rows.length > 0 && rows.every(function (r) { return sel.indexOf(r[key]) >= 0; });
    var someSel = sel.length > 0 && !allSel;
    function toggle(id) { props.onSelect && props.onSelect(sel.indexOf(id) >= 0 ? sel.filter(function (x) { return x !== id; }) : sel.concat([id])); }
    function toggleAll() { props.onSelect && props.onSelect(allSel ? [] : rows.map(function (r) { return r[key]; })); }
    cols = cols.map(function (c) { return c.num && !c.align ? Object.assign({}, c, { align: "right" }) : c; });
    var head = h("tr", null,
      props.selectable ? h("th", { scope: "col", className: "la-dt__sel" }, h(Checkbox, { ariaLabel: "Select all rows", checked: allSel, indeterminate: someSel, onChange: toggleAll })) : null,
      cols.map(function (c) {
        var active = sortBy && sortBy.key === c.key;
        var ariaSort = c.sortable ? (active ? (sortBy.dir === "desc" ? "descending" : "ascending") : "none") : undefined;
        return h("th", { key: c.key, scope: "col", "data-align": c.align, "aria-sort": ariaSort, style: c.width ? { width: c.width } : undefined },
          c.sortable ? h("button", { type: "button", onClick: function () { props.onSort && props.onSort({ key: c.key, dir: active && sortBy.dir === "asc" ? "desc" : "asc" }); } },
            c.header, h(Icon, { name: active ? (sortBy.dir === "desc" ? "arrow-down" : "arrow-up") : "chevrons-up-down", size: 12 })) : (c.hideHeader ? h("span", { className: "la-sr" }, c.header) : c.header));
      }));
    var colSpan = cols.length + (props.selectable ? 1 : 0);
    var body;
    if (props.loading) {
      body = [0, 1, 2, 3, 4].map(function (i) {
        return h("tr", { key: "sk" + i }, props.selectable ? h("td", { className: "la-dt__sel" }) : null,
          cols.map(function (c, ci) { return h("td", { key: c.key }, h("span", { className: "la-skel", style: { width: ((ci * 37 + i * 23) % 40 + 40) + "%" } })); }));
      });
    } else if (!rows.length) {
      body = h("tr", null, h("td", { colSpan: colSpan }, props.empty ? h(EmptyState, props.empty) : h(EmptyState, { title: "Nothing here yet" })));
    } else {
      body = rows.map(function (r) {
        var id = r[key], isSel = sel.indexOf(id) >= 0, isActive = props.activeKey !== undefined && props.activeKey === id;
        var rp = { key: id, "aria-selected": props.selectable ? isSel : undefined, "aria-current": isActive ? "true" : undefined };
        if (click) {
          rp["data-click"] = "1"; rp.tabIndex = 0;
          rp.onClick = function (e) { if (e.target.closest("button,a,input,label,[role=menu]")) return; click(r); };
          rp.onKeyDown = function (e) { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); click(r); } };
        }
        return h("tr", rp,
          props.selectable ? h("td", { className: "la-dt__sel" }, h(Checkbox, { ariaLabel: "Select " + (r.name || id), checked: isSel, onChange: function () { toggle(id); } })) : null,
          cols.map(function (c) {
            var v = c.render ? c.render(r) : r[c.key];
            var p = { key: c.key, "data-align": c.align };
            if (c.mono) p["data-mono"] = "1";
            if (c.num) p["data-num"] = "1";
            if (c.muted) p["data-muted"] = "1";
            return h("td", p, v);
          }));
      });
    }
    var pg = props.pagination;
    var foot = null;
    if (pg && pg.total > pg.pageSize) {
      var from = pg.total === 0 ? 0 : (pg.page - 1) * pg.pageSize + 1, to = Math.min(pg.total, pg.page * pg.pageSize);
      var pages = Math.max(1, Math.ceil(pg.total / pg.pageSize));
      foot = h("div", { className: "la-dt__foot" },
        h("span", { role: "status" }, from + "\u2013" + to + " of " + pg.total),
        h("div", { className: "la-dt__pager" },
          h(IconButton, { icon: "chevron-left", label: "Previous page", size: "sm", disabled: pg.page <= 1, onClick: function () { pg.onPage(pg.page - 1); } }),
          h("span", null, "Page " + pg.page + " of " + pages),
          h(IconButton, { icon: "chevron-right", label: "Next page", size: "sm", disabled: pg.page >= pages, onClick: function () { pg.onPage(pg.page + 1); } })));
    }
    var bulk = props.selectable && sel.length > 0 && props.bulkActions
      ? h("div", { className: "la-dt__bulk", role: "status" }, h("span", { className: "la-dt__bulk-n" }, sel.length + " selected"), props.bulkActions,
          h("span", { style: { marginLeft: "auto" } }, h(Button, { size: "sm", variant: "ghost", onClick: function () { props.onSelect && props.onSelect([]); } }, "Clear selection"))) : null;
    return h("div", { className: cx("la-dt", props.rowHeight === 2 && "la-dt--2", props.className) },
      bulk,
      h("div", { className: "la-dt__scroll", tabIndex: 0, role: "region", "aria-label": props.label },
        h("table", { "aria-busy": props.loading || undefined },
          props.caption ? h("caption", { className: "la-sr" }, props.caption) : null,
          h("thead", null, head), h("tbody", null, body))),
      foot);
  }

  /* ---------- StatCard, UptimeBar ---------- */
  /* one figure: label, value + trend/usage on one row, change chip + hint under it; shared by StatCard and KpiStrip */
  function Sparkline(p) {
    var d = p.data || [], w = p.width || 80, hh = p.height || 28, pad = 3;
    if (d.length < 2) return null;
    var mn = Math.min.apply(null, d), mx = Math.max.apply(null, d), span = mx - mn || 1;
    var pts = d.map(function (v, i) { return [pad + i * (w - 2 * pad) / (d.length - 1), hh - pad - (v - mn) / span * (hh - 2 * pad)]; });
    var last = pts[pts.length - 1];
    var color = p.tone && p.tone !== "accent" ? "var(--status-" + p.tone + ")" : "var(--accent)";
    return h("svg", { className: "la-spark", width: w, height: hh, viewBox: "0 0 " + w + " " + hh, "aria-hidden": p.label ? undefined : "true", role: p.label ? "img" : undefined, "aria-label": p.label, focusable: "false" },
      h("polyline", { points: pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "), fill: "none", stroke: color, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
      h("circle", { cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: 2.5, fill: color }));
  }
  function Delta(p) {
    var d = p.delta; if (!d) return null;
    var tone = d.tone || "neutral", dir = d.direction || "flat";
    var word = (dir === "up" ? "Up" : dir === "down" ? "Down" : "Unchanged") + (tone === "good" ? ", better: " : tone === "bad" ? ", worse: " : ": ");
    return h("span", { className: cx("la-delta", "la-delta--" + tone) },
      dir === "flat" ? null : h(Icon, { name: dir === "up" ? "arrow-up" : "arrow-down", size: 12 }),
      h("span", { className: "la-sr" }, word), d.value);
  }
  function figure(pre, it) {
    var usage = it.usage;
    return [
      h("p", { key: "l", className: pre + "__label" }, it.status ? h("span", { className: cx("la-status la-status--" + it.status) }, h("span", { className: "la-status__mark", "aria-hidden": "true" })) : null, it.label),
      h("div", { key: "r", className: pre + "__row" },
        h("p", { className: pre + "__value" }, it.value, it.unit ? h("span", { className: pre + "__unit" }, it.unit) : null),
        it.trend ? h(Sparkline, { data: it.trend, tone: it.trendTone }) : null),
      usage ? h("div", { key: "u", className: "la-usage", role: "meter", "aria-valuenow": usage.value, "aria-valuemin": 0, "aria-valuemax": usage.max, "aria-label": usage.label || it.label },
        h("span", { className: "la-usage__fill", style: { width: Math.min(100, usage.value / usage.max * 100) + "%" } })) : null,
      it.delta || it.hint ? h("div", { key: "s", className: pre + "__sub" }, h(Delta, { delta: it.delta }), it.hint ? h("p", { className: pre + "__hint" }, it.hint) : null) : null
    ];
  }
  function StatCard(props) {
    return h("div", { className: cx("la-stat", props.className) }, figure("la-stat", props));
  }
  function KpiStrip(props) {
    return h("div", { className: cx("la-kpis", props.className), role: "group", "aria-label": props.label || "Key figures" },
      (props.items || []).map(function (it, i) { return h("div", { key: i, className: "la-kpi" }, figure("la-kpi", it)); }));
  }
  function UptimeBar(props) {
    var days = props.days || [];
    var counts = { up: 0, degraded: 0, down: 0, maintenance: 0, none: 0 };
    days.forEach(function (d) { counts[d] = (counts[d] || 0) + 1; });
    var summary = props.summary || ("Last " + days.length + " " + (props.unit || "days") + ": " + counts.up + " up, " + counts.degraded + " degraded, " + counts.down + " down" + (counts.maintenance ? ", " + counts.maintenance + " in maintenance" : "") + (counts.none ? ", " + counts.none + " without data" : ""));
    return h("div", { className: cx("la-uptime", props.size === "sm" && "la-uptime--sm", props.className) },
      h("div", { className: "la-uptime__bar", role: "img", "aria-label": summary },
        days.map(function (d, i) { return h("span", { key: i, className: "la-uptime__seg", "data-s": d }); })),
      props.from || props.to ? h("div", { className: "la-uptime__legend" }, h("span", null, props.from), h("span", null, props.to)) : null);
  }

  /* ---------- Toast ---------- */
  function Toast(props) {
    var tone = props.tone || "info";
    return h("div", { className: cx("la-toast", "la-toast--" + tone), role: tone === "error" ? "alert" : "status" },
      h(Icon, { name: TONE_ICON[tone], className: "la-toast__icon" }),
      h("div", { className: "la-toast__body" }, props.title ? h("p", { className: "la-toast__title" }, props.title) : null, props.children ? h("p", { className: "la-toast__text" }, props.children) : null),
      props.action || null,
      props.onDismiss ? h(IconButton, { icon: "x", label: "Dismiss", size: "sm", onClick: props.onDismiss }) : null);
  }
  function ToastRegion(props) {
    return h("div", { className: cx("la-toasts", props.contained && "la-toasts--contained"), "aria-live": "polite", "aria-label": "Notifications" },
      (props.toasts || []).map(function (t) { return h(Toast, Object.assign({ key: t.id }, t, { onDismiss: props.onDismiss ? function () { props.onDismiss(t.id); } : undefined })); }));
  }
  Toast.Region = ToastRegion;

  /* ---------- FormLayout ---------- */
  function FormSection(props) {
    return h("section", { className: "la-form__section", "aria-label": props.title },
      h("div", null, h("h3", { className: "la-form__title" }, props.title), props.description ? h("p", { className: "la-form__desc" }, props.description) : null),
      h("div", { className: "la-form__fields" }, props.children));
  }
  function FormLayout(props) {
    return h("form", { className: cx("la-form", props.dense && "la-form--dense", props.className), onSubmit: props.onSubmit, id: props.id, noValidate: true },
      props.children,
      props.actions ? h("div", { className: "la-form__bar" }, props.actions) : null);
  }
  FormLayout.Section = FormSection;
  FormLayout.Row = function (p) { return h("div", { className: "la-form__row" }, p.children); };

  /* ---------- Avatar, UserMenu, WorkspaceSwitcher ---------- */
  function initialsOf(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(""); }
  function Avatar(props) {
    return h("span", { className: cx("la-avatar", props.size && "la-avatar--" + props.size, props.square && "la-avatar--sq", props.className), "aria-hidden": "true" },
      props.src ? h("img", { src: props.src, alt: "" }) : (props.initials || initialsOf(props.name || "")));
  }
  function UserMenu(props) {
    return h(Menu, { label: "Account menu", items: props.items, align: "end", round: true, triggerLabelText: "Account menu for " + props.name,
      triggerContent: h(Avatar, { name: props.name, src: props.src }),
      header: h("div", { className: "la-who" }, h("b", null, props.name), props.email ? h("span", null, props.email) : null) });
  }
  function WorkspaceSwitcher(props) {
    return h(Menu, { label: "Switch workspace", items: props.items, align: "start", triggerLabelText: "Workspace " + props.name + ". Switch workspace",
      triggerContent: [h(Avatar, { key: "a", square: true, name: props.name, initials: props.initials }), h("span", { key: "t", className: "la-ws" }, h("b", null, props.name), props.meta ? h("span", null, props.meta) : null), h(Icon, { key: "c", name: "chevrons-up-down", size: 14 })] });
  }

  /* ---------- DetailPanel, StatusBar ---------- */
  function DetailPanel(props) {
    var opener = useRef(typeof document !== "undefined" ? document.activeElement : null);
    var resizable = !!props.onResize || !!props.resizable;
    var min = props.minWidth || 320, max = props.maxWidth || 640;
    function clamp(v) { return Math.max(min, Math.min(max, v)); }
    var _w = useState(clamp(props.width || 360)), w = _w[0], setW = _w[1];
    var drag = useRef(null);
    useEffect(function () { if (props.width !== undefined) setW(clamp(props.width)); }, [props.width]);
    useEffect(function () {
      var o = opener.current;
      return function () { if (o && o !== document.body && document.contains(o) && o.focus) o.focus(); };
    }, []);
    function commit(v) { v = clamp(v); setW(v); props.onResize && props.onResize(v); }
    function onKey(e) {
      if (e.key === "Escape" && props.onClose && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); props.onClose(); }
    }
    var handle = resizable ? h("div", {
      className: "la-detail__handle", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize details panel", tabIndex: 0,
      "aria-valuenow": w, "aria-valuemin": min, "aria-valuemax": max,
      onPointerDown: function (e) { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: w }; e.currentTarget.setAttribute("data-drag", "1"); },
      onPointerMove: function (e) { if (drag.current) commit(drag.current.w + (drag.current.x - e.clientX)); },
      onPointerUp: function (e) { drag.current = null; e.currentTarget.removeAttribute("data-drag"); },
      onKeyDown: function (e) {
        if (e.key === "ArrowLeft") { e.preventDefault(); commit(w + 16); }
        else if (e.key === "ArrowRight") { e.preventDefault(); commit(w - 16); }
        else if (e.key === "Home") { e.preventDefault(); commit(min); }
        else if (e.key === "End") { e.preventDefault(); commit(max); }
      }
    }) : null;
    return h("div", { className: cx("la-detail", props.className), onKeyDown: onKey, style: resizable ? { width: w } : undefined },
      handle,
      h("div", { className: "la-detail__head" },
        h("div", { className: "la-detail__titles" }, h("h2", { className: "la-detail__title" }, props.title), props.status || null, props.subtitle ? h("span", { style: { font: "400 12px/16px var(--font-sans)", color: "var(--muted)" } }, props.subtitle) : null),
        props.actions || null,
        props.onClose ? h(IconButton, { icon: "x", label: "Close details", size: "sm", onClick: props.onClose }) : null),
      props.tabs ? h("div", { className: "la-detail__tabs" }, h(Tabs, { label: props.tabsLabel || "Details", tabs: props.tabs, value: props.tab, onChange: props.onTab })) : null,
      h("div", { className: "la-detail__body" }, props.children),
      props.footer ? h("div", { className: "la-detail__foot" }, props.footer) : null);
  }
  DetailPanel.List = function (p) {
    return h("dl", { className: "la-kv" }, (p.items || []).map(function (it, i) {
      return h(React.Fragment, { key: i }, h("dt", null, it.label), h("dd", { "data-mono": it.mono ? "1" : undefined }, it.value));
    }));
  };
  function StatusBar(props) {
    var st = props.status || "live";
    return h("div", { className: "la-statusbar", "data-s": st, role: "status" },
      h("span", { className: "la-statusbar__live" }, h("span", { className: "la-statusbar__dot", "aria-hidden": "true" }), props.children || (st === "live" ? "Live" : st === "reconnecting" ? "Reconnecting" : "Offline")),
      props.end ? h("span", { className: "la-statusbar__end" }, props.end) : null);
  }

  /* ---------- Timeline, Steps, CodeBlock ---------- */
  var TL_STATUS = { investigating: ["down", "Investigating"], identified: ["degraded", "Identified"], monitoring: ["maintenance", "Monitoring"], resolved: ["up", "Resolved"], scheduled: ["unknown", "Scheduled"] };
  function Timeline(props) {
    var items = props.items || [];
    return h("ol", { className: cx("la-tl", props.className), "aria-label": props.label || "Updates" },
      props.composer ? h("li", { className: "la-tl__item la-tl__item--composer" },
        h("span", { className: "la-tl__mark" }, h("span", { className: "la-status la-status--unknown" }, h("span", { className: "la-status__mark", "aria-hidden": "true" }))),
        h("div", { className: "la-tl__body" }, props.composer)) : null,
      items.map(function (it, i) {
        var m = TL_STATUS[it.status] || TL_STATUS.investigating;
        return h("li", { key: it.id !== undefined ? it.id : i, className: "la-tl__item" },
          h("span", { className: "la-tl__mark" }, h("span", { className: "la-status la-status--" + m[0] }, h("span", { className: "la-status__mark", "aria-hidden": "true" }))),
          h("div", { className: "la-tl__body" },
            h("div", { className: "la-tl__head" },
              h("span", { className: "la-tl__status" }, it.statusLabel || m[1]),
              it.time ? h("time", { className: "la-tl__time", dateTime: it.datetime }, it.time) : null,
              it.author ? h("span", { className: "la-tl__author" }, it.author) : null),
            it.children ? h("div", { className: "la-tl__text" }, it.children) : null));
      }));
  }
  function Steps(props) {
    var steps = props.steps || [], vertical = props.orientation === "vertical";
    /* current is an id (compared by value, any type) or, when no id matches, an index. */
    var byId = steps.map(function (s) { return String(s.id); }).indexOf(String(props.current));
    var ci = byId >= 0 && props.current !== undefined ? byId : (typeof props.current === "number" ? props.current : 0);
    return h("ol", { className: cx("la-steps", vertical ? "la-steps--v" : "la-steps--h", props.className), "aria-label": props.label || "Progress" },
      steps.map(function (st, i) {
        var state = st.status === "error" ? "error" : i < ci ? "done" : i === ci ? "current" : "upcoming";
        var word = state === "done" ? "completed" : state === "current" ? "current step" : state === "error" ? "has an error" : "not started";
        return h("li", { key: st.id !== undefined ? st.id : i, className: "la-step", "data-state": state, "aria-current": i === ci ? "step" : undefined },
          h("span", { className: "la-step__mark", "aria-hidden": "true" }, state === "done" ? h(Icon, { name: "check", size: 14 }) : state === "error" ? h(Icon, { name: "alert-circle", size: 14 }) : String(i + 1)),
          h("span", { className: "la-step__text" },
            h("span", { className: "la-step__label" }, st.label, h("span", { className: "la-sr" }, " (" + word + ")")),
            st.description ? h("span", { className: "la-step__desc" }, st.description) : null),
          !vertical && i < steps.length - 1 ? h("span", { className: "la-step__line", "aria-hidden": "true" }) : null);
      }));
  }
  function CodeBlock(props) {
    var text = props.code !== undefined ? props.code : (typeof props.children === "string" ? props.children : "");
    var _s = useState("idle"), st = _s[0], setSt = _s[1], timer = useRef(null);
    useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);
    function done(ok) { setSt(ok ? "copied" : "failed"); clearTimeout(timer.current); timer.current = setTimeout(function () { setSt("idle"); }, 2000); props.onCopy && props.onCopy(ok); }
    function copy() {
      try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    }
    return h("div", { className: cx("la-codeblock", props.wrap && "la-codeblock--wrap", props.className) },
      h("div", { className: "la-codeblock__bar" },
        h("span", { className: "la-codeblock__title" }, props.title || props.language || ""),
        h("button", { type: "button", className: "la-codeblock__copy", "aria-label": props.copyLabel || "Copy code", onClick: copy },
          h(Icon, { name: st === "copied" ? "check" : "copy", size: 14 }), h("span", null, st === "copied" ? "Copied" : st === "failed" ? "Copy failed" : "Copy"))),
      h("pre", { className: "la-codeblock__pre", tabIndex: 0, role: "region", "aria-label": props.label || props.title || "Code" }, h("code", null, text)),
      h("span", { className: "la-sr", role: "status" }, st === "copied" ? "Copied to clipboard" : st === "failed" ? "Copy failed" : ""));
  }
  function Code(props) { return h("code", { className: cx("la-code", props.className) }, props.children); }

  /* ---------- Charts: plain SVG, tokens only ---------- */
  var SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtHM(t) { var d = new Date(t); return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); }
  function fmtDay(t) { var d = new Date(t); return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function fmtFull(t) { var d = new Date(t); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) + " " + fmtHM(t); }
  function niceTicks(min, max, n) {
    var range = max - min || 1, raw = range / n, pw = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pw;
    var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pw;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (var v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
    return { ticks: t, min: lo, max: hi };
  }
  function fmtNum(v) { var a = Math.abs(v); return a >= 10000 ? +(v / 1000).toFixed(1) + "K" : String(+v.toFixed(2)); }
  var T_STEPS = [60000, 300000, 600000, 900000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000, 172800000, 604800000];
  function timeTicks(x0, x1, n) {
    var step = T_STEPS[T_STEPS.length - 1];
    for (var i = 0; i < T_STEPS.length; i++) if ((x1 - x0) / T_STEPS[i] <= n) { step = T_STEPS[i]; break; }
    var out = []; for (var t = Math.ceil(x0 / step) * step; t <= x1; t += step) out.push(t);
    return { ticks: out, day: step >= 86400000 };
  }
  /* Callback ref: re-measures whenever the plot element mounts or remounts (error to data, table view and back). */
  function useWidth(fallback) {
    var _s = useState(fallback), w = _s[0], setW = _s[1], off = useRef(null);
    var ref = React.useCallback(function (el) {
      if (off.current) { off.current(); off.current = null; }
      if (!el) return;
      function m() { var r = el.getBoundingClientRect().width; if (r > 0) setW(Math.round(r)); }
      m();
      if (typeof ResizeObserver !== "undefined") { var ro = new ResizeObserver(m); ro.observe(el); off.current = function () { ro.disconnect(); }; }
      else { window.addEventListener("resize", m); off.current = function () { window.removeEventListener("resize", m); }; }
    }, []);
    return [ref, w];
  }
  /* Stable colour per entity: explicit slot, then colorKeys position, then first-seen order kept for the life of the chart. */
  function useSlots(series, colorKeys) {
    var seen = useRef({}), m = seen.current;
    series.forEach(function (s) {
      if (m[s.id] === undefined) { var used = {}; Object.keys(m).forEach(function (k) { used[m[k]] = 1; }); var n = 1; while (used[n]) n++; m[s.id] = n; }
    });
    return function (s) {
      if (s.slot) return s.slot;
      if (colorKeys) { var ix = colorKeys.indexOf(s.id); if (ix >= 0) return ix + 1; }
      return m[s.id];
    };
  }
  function fit(str, px) { var max = Math.max(3, Math.floor(px / 6.6)); return str.length > max ? str.slice(0, max - 1) + "\u2026" : str; }
  function svgText(x, y, str, anchor, extra) {
    var ex = Object.assign({}, extra || {}), full = ex.full; delete ex.full;
    return h("text", Object.assign({ x: x, y: y, textAnchor: anchor || "start", className: "la-chart__tick" }, ex), str, full ? h("title", null, full) : null);
  }
  function runs(vals) {
    var out = [], cur = [];
    vals.forEach(function (v, i) { if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(i); });
    if (cur.length) out.push(cur);
    return out;
  }

  function ChartTooltip(props) {
    var side = props.align === "left" ? { right: props.right } : { left: props.left };
    return h("div", { className: "la-tip", style: Object.assign({ top: props.top }, side), "aria-hidden": "true" },
      props.title ? h("div", { className: "la-tip__title" }, props.title) : null,
      (props.rows || []).map(function (r, i) {
        return h("div", { key: i, className: "la-tip__row" },
          h("span", { className: cx("la-tip__key", r.shape === "rect" && "la-tip__key--rect"), style: { background: r.color } }),
          h("span", { className: "la-tip__value" }, r.value),
          h("span", { className: "la-tip__name" }, r.label));
      }));
  }
  function ChartLegend(props) {
    return h("ul", { className: cx("la-legend", props.className), "aria-label": props.label || "Legend" },
      (props.items || []).map(function (it) {
        var key = h("span", { className: cx("la-legend__key", it.shape === "rect" && "la-legend__key--rect"), style: { background: it.color, opacity: it.hidden ? 0.35 : 1 } });
        return h("li", { key: it.id }, props.onToggle
          ? h("button", { type: "button", className: cx("la-legend__item", it.hidden && "la-legend__item--off"), "aria-pressed": !it.hidden, onClick: function () { props.onToggle(it.id); } }, key, h("span", null, it.name))
          : h("span", { className: "la-legend__item" }, key, h("span", null, it.name)));
      }));
  }
  function ChartFrame(props) {
    var _v = useState("chart"), view = _v[0], setView = _v[1];
    var tb = props.table, st = props.state;
    var body;
    if (view === "table" && tb) {
      body = h("div", { className: "la-chart__tablewrap", tabIndex: 0, role: "region", "aria-label": (props.title || "Chart") + " data table" },
        h("table", { className: "la-chart__table" },
          h("caption", { className: "la-sr" }, (props.title || "Chart") + " as a table"),
          h("thead", null, h("tr", null, tb.columns.map(function (c, i) { return h("th", { key: i, scope: "col", "data-num": i ? "1" : undefined }, c); }))),
          h("tbody", null, tb.rows.map(function (r, ri) {
            return h("tr", { key: ri }, r.map(function (c, ci) { return ci === 0 ? h("th", { key: ci, scope: "row" }, c) : h("td", { key: ci, "data-num": "1" }, c); }));
          }))));
    } else if (st === "loading" && !props.children) {
      body = h("div", { className: "la-chart__skel", style: { height: props.height || 220 }, "aria-busy": "true" }, h("span", { className: "la-sr" }, "Loading chart"));
    } else if (st === "empty") {
      body = h(EmptyState, { icon: "activity", title: props.emptyTitle || "No data for this range", description: props.emptyMessage || "Pick a longer range or check that the check is running." });
    } else if (st === "error") {
      body = h(Callout, { tone: "error", alert: true, title: props.errorTitle || "Could not load this chart", action: props.onRetry ? h(Button, { size: "sm", variant: "secondary", onClick: props.onRetry }, "Try again") : null }, props.errorMessage || "The request failed. Try again in a moment.");
    } else {
      body = h("div", { className: cx("la-chart__body", st === "loading" && "la-chart__body--busy"), "aria-busy": st === "loading" ? "true" : undefined }, props.children);
    }
    return h("figure", { className: cx("la-chart", props.className) },
      h("figcaption", { className: "la-chart__head" },
        h("div", { className: "la-chart__titles" }, props.title ? h("h3", { className: "la-chart__title" }, props.title) : null, props.subtitle ? h("p", { className: "la-chart__sub" }, props.subtitle) : null),
        h("div", { className: "la-chart__actions" }, props.actions || null,
          tb ? h(Segmented, { label: "View", size: "sm", options: [{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }], value: view, onChange: setView }) : null)),
      props.legend || null,
      body);
  }

  /* Shared time-axis core: grid, bands, threshold, crosshair, tooltip, keyboard */
  function TimeChartCore(p) {
    var wm = useWidth(640), wrap = wm[0], w = wm[1], hh = p.height || 220;
    var _i = useState(null), idx = _i[0], setIdx = _i[1];
    var kbd = useRef(false);
    var x = p.x, n = x.length;
    var showEnd = !!p.endLabels && w >= 480, rm = showEnd ? Math.min(w * 0.36, p.endLabelMax * 7.2 + 30) : 12, m = { l: 44, r: rm, t: 8, b: 24 };
    var pw = Math.max(40, w - m.l - m.r), ph = hh - m.t - m.b;
    var x0 = x[0], x1 = x[n - 1] === x0 ? x0 + 1 : x[n - 1];
    function X(t) { return m.l + (t - x0) / (x1 - x0) * pw; }
    var all = []; p.arrays.forEach(function (a) { a.forEach(function (v) { if (v != null) all.push(v); }); });
    if (p.threshold) all.push(p.threshold.value);
    var lo = p.yMin !== undefined ? p.yMin : 0, hi = Math.max.apply(null, all.concat([lo + 1]));
    var nt = niceTicks(lo, hi * 1.04, 4);
    function Y(v) { return m.t + ph - (v - nt.min) / (nt.max - nt.min) * ph; }
    var yf = p.yFormat || fmtNum, tt = timeTicks(x0, x1, Math.max(2, Math.floor(pw / 80)));
    function nearest(clientX, rect) {
      var t = x0 + (clientX - rect.left - m.l) / pw * (x1 - x0), best = 0, bd = Infinity;
      for (var i = 0; i < n; i++) { var d = Math.abs(x[i] - t); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function onKey(e) {
      var k = e.key, next = idx;
      if (k === "ArrowRight") next = idx == null ? 0 : Math.min(n - 1, idx + 1);
      else if (k === "ArrowLeft") next = idx == null ? n - 1 : Math.max(0, idx - 1);
      else if (k === "Home") next = 0; else if (k === "End") next = n - 1;
      else if (k === "Escape") { setIdx(null); return; } else return;
      e.preventDefault(); kbd.current = true; setIdx(next);
    }
    var rows = idx != null ? p.rowsAt(idx) : null;
    var tx = idx != null ? X(x[idx]) : 0, leftSide = tx > w * 0.6;
    var live = idx != null ? fmtFull(x[idx]) + ": " + rows.map(function (r) { return r.label + " " + r.value; }).join(", ") : "";
    return h("div", { className: "la-chart__plot", ref: wrap, tabIndex: 0, role: "group", "aria-label": p.summary + " Focus the chart and use the arrow keys to move through points; the table view lists every value.",
        onKeyDown: onKey, onFocus: function () { if (!kbd.current && idx == null && n) { kbd.current = true; setIdx(n - 1); } }, onBlur: function () { kbd.current = false; setIdx(null); } },
      h("svg", { width: w, height: hh, viewBox: "0 0 " + w + " " + hh, "aria-hidden": "true", focusable: "false",
          onPointerMove: function (e) { kbd.current = false; setIdx(nearest(e.clientX, e.currentTarget.getBoundingClientRect())); },
          onPointerLeave: function () { if (!kbd.current) setIdx(null); } },
        nt.ticks.map(function (v) { return h("g", { key: "y" + v }, h("line", { x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v), className: v === nt.min ? "la-chart__axis" : "la-chart__grid" }), svgText(m.l - 8, Y(v) + 4, yf(v), "end")); }),
        tt.ticks.map(function (t) { return svgText(X(t), hh - 6, tt.day ? fmtDay(t) : fmtHM(t), "middle", { key: "x" + t }); }),
        (p.bands || []).map(function (b, bi) {
          var bx0 = Math.max(m.l, X(b.from)), bx1 = Math.min(m.l + pw, X(b.to));
          if (bx1 <= bx0) return null;
          var fits = (bx1 - bx0) > (b.label || "").length * 6 + 8;
          return h("g", { key: "b" + bi }, h("rect", { x: bx0, y: m.t, width: bx1 - bx0, height: ph, className: "la-chart__band" }), b.label ? (fits ? h("text", { x: bx0 + 4, y: m.t + 12, className: "la-chart__bandlabel" }, b.label) : h("text", { x: bx0 - 4, y: m.t + 12, textAnchor: "end", className: "la-chart__bandlabel" }, b.label)) : null);
        }),
        p.threshold ? h("g", null, h("line", { x1: m.l, x2: m.l + pw, y1: Y(p.threshold.value), y2: Y(p.threshold.value), className: "la-chart__threshold" }), h("text", { x: m.l + 4, y: Y(p.threshold.value) - 5, textAnchor: "start", className: "la-chart__bandlabel" }, p.threshold.label)) : null,
        p.layers(X, Y, { x0: m.l, x1: m.l + pw, y0: m.t, y1: m.t + ph }),
        showEnd ? p.endLabels(X, Y, rm - 26) : null,
        idx != null ? h("g", null, h("line", { x1: X(x[idx]), x2: X(x[idx]), y1: m.t, y2: m.t + ph, className: "la-chart__cross" }), p.dotsAt ? p.dotsAt(idx, X, Y) : null) : null),
      rows ? h(ChartTooltip, { title: fmtFull(x[idx]), rows: rows, top: 8, left: tx + 12, right: w - tx + 12, align: leftSide ? "left" : "right" }) : null,
      h("span", { className: "la-sr", role: "status", "aria-live": "polite" }, kbd.current ? live : ""));
  }

  function chartSummary(title, x, series, fmtV) {
    var last = series.map(function (s) { var v = null; for (var i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) { v = s.values[i]; break; } return s.name + " " + (v == null ? "no data" : fmtV(v)); });
    return (title || "Chart") + ". " + fmtFull(x[0]) + " to " + fmtFull(x[x.length - 1]) + " UTC. Latest: " + last.join(", ") + ".";
  }
  function LineChart(props) {
    var series = props.series, x = props.x, area = !!props.area;
    var _h = useState({}), hidden = _h[0], setHidden = _h[1];
    var yf = props.yFormat || fmtNum, unit = props.unit || "";
    function fmtV(v) { return yf(v) + (unit ? " " + unit : ""); }
    var slotOf = useSlots(series, props.colorKeys);
    function col(s) { return SLOTS[(slotOf(s) - 1) % 6]; }
    var vis = series.map(function (s, i) { return { s: s, i: i }; }).filter(function (o) { return !hidden[o.s.id]; });
    function toggle(id) {
      var next = Object.assign({}, hidden); next[id] = !next[id];
      if (series.every(function (s) { return next[s.id]; })) return;
      setHidden(next);
    }
    var showEnd = props.directLabels !== false && series.length >= 2 && series.length <= 4;
    var maxName = Math.max.apply(null, series.map(function (s) { return s.name.length; }));
    var core = !(x && x.length > 1) ? null : h(TimeChartCore, {
      x: x, height: props.height, yMin: props.yMin, yFormat: yf, threshold: props.threshold, bands: props.bands,
      endLabelMax: maxName,
      arrays: vis.map(function (o) { return o.s.values; }),
      summary: chartSummary(props.title, x, series, fmtV),
      rowsAt: function (i) { return vis.map(function (o) { var v = o.s.values[i]; return { label: o.s.name, value: v == null ? "no data" : fmtV(v), color: col(o.s, o.i) }; }); },
      layers: function (X, Y, box) {
        return vis.map(function (o) {
          var c = col(o.s, o.i);
          return h("g", { key: o.s.id, "data-series": o.s.id },
            runs(o.s.values).map(function (r, ri) {
              if (r.length === 1) return h("circle", { key: ri, cx: X(x[r[0]]), cy: Y(o.s.values[r[0]]), r: 3, fill: c });
              var d = r.map(function (i, k) { return (k ? "L" : "M") + X(x[i]).toFixed(1) + " " + Y(o.s.values[i]).toFixed(1); }).join("");
              return h("g", { key: ri },
                area ? h("path", { d: d + "L" + X(x[r[r.length - 1]]).toFixed(1) + " " + box.y1 + "L" + X(x[r[0]]).toFixed(1) + " " + box.y1 + "Z", fill: c, fillOpacity: 0.1 }) : null,
                h("path", { d: d, fill: "none", stroke: c, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }));
            }));
        });
      },
      dotsAt: function (i, X, Y) {
        return vis.map(function (o) { var v = o.s.values[i]; return v == null ? null : h("circle", { key: o.s.id, cx: X(x[i]), cy: Y(v), r: 4, fill: col(o.s, o.i), stroke: "var(--chart-surface)", strokeWidth: 2 }); });
      },
      endLabels: showEnd ? function (X, Y, maxPx) {
        var items = vis.map(function (o) { var li = -1; for (var i = o.s.values.length - 1; i >= 0; i--) if (o.s.values[i] != null) { li = i; break; } return li < 0 ? null : { y: Y(o.s.values[li]), x: X(x[x.length - 1]), name: o.s.name, c: col(o.s, o.i), id: o.s.id }; }).filter(Boolean).sort(function (a, b) { return a.y - b.y; });
        var lastY = -99, out = [];
        items.forEach(function (it) { if (it.y - lastY >= 14) { out.push(it); lastY = it.y; } });
        return h("g", null, out.map(function (it) { return h("g", { key: it.id }, h("rect", { x: it.x + 8, y: it.y - 1, width: 10, height: 2, rx: 1, fill: it.c }), h("text", { x: it.x + 22, y: it.y + 4, className: "la-chart__label" }, fit(it.name, maxPx - 14), it.name.length > Math.floor((maxPx - 14) / 6.6) ? h("title", null, it.name) : null)); }));
      } : null
    });
    var legend = series.length >= 2 ? h(ChartLegend, { items: series.map(function (s, i) { return { id: s.id, name: s.name, color: col(s, i), hidden: !!hidden[s.id] }; }), onToggle: toggle, label: "Series" }) : null;
    var table = { columns: ["Time (UTC)"].concat(series.map(function (s) { return s.name + (unit ? " (" + unit + ")" : ""); })), rows: x.map(function (t, i) { return [fmtFull(t)].concat(series.map(function (s) { return s.values[i] == null ? "no data" : yf(s.values[i]); })); }) };
    return h(ChartFrame, { title: props.title, subtitle: props.subtitle, actions: props.actions, legend: legend, table: table, state: props.state || (x && x.length > 1 ? undefined : "empty"), onRetry: props.onRetry, height: props.height, emptyTitle: props.emptyTitle, emptyMessage: props.emptyMessage, errorTitle: props.errorTitle, errorMessage: props.errorMessage }, core);
  }
  function AreaChart(props) { return h(LineChart, Object.assign({}, props, { area: true })); }

  function LatencyBand(props) {
    var x = props.x, yf = props.yFormat || fmtNum, unit = props.unit || "ms";
    function fmtV(v) { return yf(v) + " " + unit; }
    var c = SLOTS[0];
    var core = !(x && x.length > 1) ? null : h(TimeChartCore, {
      x: x, height: props.height, yFormat: yf, threshold: props.threshold, bands: props.bands, arrays: [props.p99, props.p95, props.p50],
      summary: (props.title || "Latency") + ". " + fmtFull(x[0]) + " to " + fmtFull(x[x.length - 1]) + " UTC. Latest p50 " + fmtV(props.p50[props.p50.length - 1]) + ", p95 " + fmtV(props.p95[props.p95.length - 1]) + ", p99 " + fmtV(props.p99[props.p99.length - 1]) + ".",
      rowsAt: function (i) { return [{ label: "p99", value: fmtV(props.p99[i]), color: c, shape: "rect" }, { label: "p95", value: fmtV(props.p95[i]), color: c, shape: "rect" }, { label: "p50", value: fmtV(props.p50[i]), color: c }]; },
      layers: function (X, Y) {
        function band(hi, lo, op) { var up = x.map(function (t, i) { return X(t).toFixed(1) + " " + Y(hi[i]).toFixed(1); }), dn = x.map(function (t, i) { return X(t).toFixed(1) + " " + Y(lo[i]).toFixed(1); }).reverse(); return h("path", { d: "M" + up.join("L") + "L" + dn.join("L") + "Z", fill: c, fillOpacity: op }); }
        return h("g", null, band(props.p99, props.p95, 0.1), band(props.p95, props.p50, 0.2),
          h("path", { d: x.map(function (t, i) { return (i ? "L" : "M") + X(t).toFixed(1) + " " + Y(props.p50[i]).toFixed(1); }).join(""), fill: "none", stroke: c, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }));
      },
      dotsAt: function (i, X, Y) { return h("circle", { cx: X(x[i]), cy: Y(props.p50[i]), r: 4, fill: c, stroke: "var(--chart-surface)", strokeWidth: 2 }); }
    });
    var legend = h(ChartLegend, { label: "Bands", items: [{ id: "p50", name: "p50", color: c }, { id: "p95", name: "p50 to p95", color: c, shape: "rect" }, { id: "p99", name: "p95 to p99", color: c, shape: "rect" }] });
    var table = { columns: ["Time (UTC)", "p50 (" + unit + ")", "p95 (" + unit + ")", "p99 (" + unit + ")"], rows: x.map(function (t, i) { return [fmtFull(t), yf(props.p50[i]), yf(props.p95[i]), yf(props.p99[i])]; }) };
    return h(ChartFrame, { title: props.title, subtitle: props.subtitle, actions: props.actions, legend: legend, table: table, state: props.state || (x && x.length > 1 ? undefined : "empty"), onRetry: props.onRetry, height: props.height, emptyTitle: props.emptyTitle, emptyMessage: props.emptyMessage, errorTitle: props.errorTitle, errorMessage: props.errorMessage }, core);
  }

  function barPath(x, y, w, hgt, r, horizontal) {
    r = Math.max(0, Math.min(r, w / 2, hgt / 2, horizontal ? w : hgt));
    if (horizontal) return "M" + x + " " + y + "H" + (x + w - r) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + "V" + (y + hgt - r) + "Q" + (x + w) + " " + (y + hgt) + " " + (x + w - r) + " " + (y + hgt) + "H" + x + "Z";
    return "M" + x + " " + (y + hgt) + "V" + (y + r) + "Q" + x + " " + y + " " + (x + r) + " " + y + "H" + (x + w - r) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + "V" + (y + hgt) + "Z";
  }
  function BarChart(props) {
    var wm = useWidth(640), wrap = wm[0], w = wm[1], horizontal = props.orientation === "horizontal", stacked = !!props.stacked;
    var cats = props.categories, series = props.series, yf = props.yFormat || fmtNum, unit = props.unit || "";
    function fmtV(v) { return yf(v) + (unit ? " " + unit : ""); }
    var _h = useState({}), hidden = _h[0], setHidden = _h[1], _i = useState(null), idx = _i[0], setIdx = _i[1], kbd = useRef(false);
    var slotOf = useSlots(series, props.colorKeys);
    function col(s) { return SLOTS[(slotOf(s) - 1) % 6]; }
    var vis = series.map(function (s, i) { return { s: s, i: i }; }).filter(function (o) { return !hidden[o.s.id]; });
    function toggle(id) { var nx = Object.assign({}, hidden); nx[id] = !nx[id]; if (series.every(function (s) { return nx[s.id]; })) return; setHidden(nx); }
    var n = cats.length, hh = props.height || (horizontal ? Math.max(120, n * 32 + 32) : 220);
    var maxLab = Math.max.apply(null, cats.map(function (c) { return c.length; }));
    var m = horizontal ? { l: Math.min(w * 0.4, maxLab * 6.6 + 16), r: 44, t: 8, b: 24 } : { l: 44, r: 12, t: 16, b: 24 };
    var pw = Math.max(40, w - m.l - m.r), ph = hh - m.t - m.b;
    var totals = cats.map(function (c, ci) { return stacked ? vis.reduce(function (a, o) { return a + (o.s.values[ci] || 0); }, 0) : Math.max.apply(null, vis.map(function (o) { return o.s.values[ci] || 0; }).concat([0])); });
    var allMax = Math.max.apply(null, cats.map(function (c, ci) { return stacked ? series.reduce(function (a, s) { return a + (s.values[ci] || 0); }, 0) : Math.max.apply(null, series.map(function (s) { return s.values[ci] || 0; })); }).concat([1]));
    var nt = niceTicks(0, allMax * 1.04, horizontal ? Math.max(2, Math.floor(pw / 90)) : 4);
    var band = (horizontal ? ph : pw) / n, k = stacked ? 1 : vis.length;
    var thick = Math.min(24, (band * 0.7 - (k - 1) * 2) / k);
    function V(v) { return horizontal ? m.l + (v - nt.min) / (nt.max - nt.min) * pw : m.t + ph - (v - nt.min) / (nt.max - nt.min) * ph; }
    var labelStep = horizontal ? 1 : Math.max(1, Math.ceil((maxLab * 6.2 + 8) / band));
    function onKey(e) {
      var key = e.key, nx = idx;
      if (key === "ArrowRight" || key === "ArrowDown") nx = idx == null ? 0 : Math.min(n - 1, idx + 1);
      else if (key === "ArrowLeft" || key === "ArrowUp") nx = idx == null ? n - 1 : Math.max(0, idx - 1);
      else if (key === "Home") nx = 0; else if (key === "End") nx = n - 1; else if (key === "Escape") { setIdx(null); return; } else return;
      e.preventDefault(); kbd.current = true; setIdx(nx);
    }
    var rows = idx != null ? vis.map(function (o) { return { label: o.s.name, value: fmtV(o.s.values[idx] || 0), color: col(o.s, o.i), shape: "rect" }; }).concat(stacked && vis.length > 1 ? [{ label: "Total", value: fmtV(totals[idx]), color: "transparent" }] : []) : null;
    var pos = idx != null ? m.l + (idx + 0.5) * band : 0;
    var tipX = horizontal ? m.l + pw * 0.5 : pos, tipY = horizontal ? m.t + (idx + 0.5) * band : 8;
    var live = idx != null ? cats[idx] + ": " + rows.map(function (r) { return r.label + " " + r.value; }).join(", ") : "";
    var summary = (props.title || "Bar chart") + ". " + cats.map(function (c, ci) { return c + " " + (stacked ? fmtV(series.reduce(function (a, s) { return a + (s.values[ci] || 0); }, 0)) : series.map(function (s) { return fmtV(s.values[ci] || 0); }).join(" / ")); }).join(", ") + ".";
    var marks = cats.map(function (c, ci) {
      var offset = 0, cum = 0;
      var segs = vis.map(function (o, vi) {
        var v = o.s.values[ci] || 0; if (v <= 0) { if (!stacked) offset++; return null; }
        var colr = col(o.s, o.i), node;
        if (horizontal) {
          var y = m.t + ci * band + (band - (stacked ? thick : k * thick + (k - 1) * 2)) / 2 + (stacked ? 0 : (vi) * (thick + 2));
          var x0 = stacked ? V(cum) + (cum ? 1 : 0) : V(0), x1 = V(stacked ? cum + v : v) - (stacked ? 1 : 0);
          node = h("path", { key: o.s.id, d: barPath(x0, y, Math.max(1, x1 - x0), thick, 4, true), fill: colr, className: "la-chart__bar" });
        } else {
          var xx = m.l + ci * band + (band - (stacked ? thick : k * thick + (k - 1) * 2)) / 2 + (stacked ? 0 : vi * (thick + 2));
          var yTop = V(stacked ? cum + v : v) + (stacked ? 1 : 0), yBot = V(stacked ? cum : 0) - (stacked && cum ? 1 : 0);
          node = h("path", { key: o.s.id, d: barPath(xx, yTop, thick, Math.max(1, yBot - yTop), (!stacked || vi === vis.length - 1) ? 4 : 0, false), fill: colr, className: "la-chart__bar" });
        }
        cum += v; return node;
      });
      var tip = null;
      if (series.length === 1 && vis.length === 1 && n <= 14 && !stacked) {
        var v0 = vis[0].s.values[ci] || 0, lab = yf(v0);
        tip = horizontal ? svgText(V(v0) + 6, m.t + ci * band + band / 2 + 4, lab, "start", { className: "la-chart__label", key: "t" }) : svgText(m.l + ci * band + band / 2, V(v0) - 6, lab, "middle", { className: "la-chart__label", key: "t" });
        if (!horizontal && lab.length * 6.4 > band) tip = null;
      }
      return h("g", { key: ci, className: cx("la-chart__cat", idx === ci && "la-chart__cat--on") }, segs, tip);
    });
    var plot = h("div", { className: "la-chart__plot", ref: wrap, tabIndex: 0, role: "group", "aria-label": summary + " Focus the chart and use the arrow keys to move between bars; the table view lists every value.",
        onKeyDown: onKey, onFocus: function () { if (!kbd.current && idx == null) { kbd.current = true; setIdx(0); } }, onBlur: function () { kbd.current = false; setIdx(null); } },
      h("svg", { width: w, height: hh, viewBox: "0 0 " + w + " " + hh, "aria-hidden": "true", focusable: "false", className: cx(idx != null && "la-chart--hasfocus"),
          onPointerLeave: function () { if (!kbd.current) setIdx(null); } },
        nt.ticks.map(function (v) {
          return horizontal
            ? h("g", { key: "v" + v }, h("line", { x1: V(v), x2: V(v), y1: m.t, y2: m.t + ph, className: v === 0 ? "la-chart__axis" : "la-chart__grid" }), svgText(V(v), hh - 6, yf(v), "middle"))
            : h("g", { key: "v" + v }, h("line", { x1: m.l, x2: m.l + pw, y1: V(v), y2: V(v), className: v === 0 ? "la-chart__axis" : "la-chart__grid" }), svgText(m.l - 8, V(v) + 4, yf(v), "end"));
        }),
        cats.map(function (c, ci) {
          if (ci % labelStep) return null;
          var lab = fit(c, horizontal ? m.l - 16 : band * labelStep - 6), ttl = lab !== c ? c : undefined;
          return horizontal ? svgText(m.l - 8, m.t + (ci + 0.5) * band + 4, lab, "end", { key: "c" + ci, className: "la-chart__label", full: ttl }) : svgText(m.l + (ci + 0.5) * band, hh - 6, lab, "middle", { key: "c" + ci, full: ttl });
        }),
        marks,
        cats.map(function (c, ci) {
          return h("rect", { key: "h" + ci, x: horizontal ? m.l : m.l + ci * band, y: horizontal ? m.t + ci * band : m.t, width: horizontal ? pw + m.r : band, height: horizontal ? band : ph + m.b, fill: "transparent", onPointerMove: function () { kbd.current = false; setIdx(ci); } });
        })),
      rows ? h(ChartTooltip, { title: cats[idx], rows: rows, top: horizontal ? Math.min(hh - 70, tipY) : 8, left: Math.min(w - 170, tipX + 12), right: 0, align: "right" }) : null,
      h("span", { className: "la-sr", role: "status", "aria-live": "polite" }, kbd.current ? live : ""));
    var legend = series.length >= 2 ? h(ChartLegend, { label: "Series", items: series.map(function (s, i) { return { id: s.id, name: s.name, color: col(s, i), shape: "rect", hidden: !!hidden[s.id] }; }), onToggle: toggle }) : null;
    var table = { columns: [props.categoryLabel || "Category"].concat(series.map(function (s) { return s.name + (unit ? " (" + unit + ")" : ""); })).concat(stacked && series.length > 1 ? ["Total"] : []), rows: cats.map(function (c, ci) { return [c].concat(series.map(function (s) { return yf(s.values[ci] || 0); })).concat(stacked && series.length > 1 ? [yf(series.reduce(function (a, s) { return a + (s.values[ci] || 0); }, 0))] : []); }) };
    return h(ChartFrame, { title: props.title, subtitle: props.subtitle, actions: props.actions, legend: legend, table: table, state: props.state || (n ? undefined : "empty"), onRetry: props.onRetry, height: hh, emptyTitle: props.emptyTitle, emptyMessage: props.emptyMessage, errorTitle: props.errorTitle, errorMessage: props.errorMessage }, plot);
  }

  function Heatmap(props) {
    var wm = useWidth(640), wrap = wm[0], w = wm[1], rows = props.rows, cols = props.cols, vals = props.values, fmt = props.format || fmtNum, unit = props.unit || "";
    var _s = useState(null), sel = _s[0], setSel = _s[1], kbd = useRef(false);
    var flat = []; vals.forEach(function (r) { r.forEach(function (v) { if (v != null) flat.push(v); }); });
    var mn = props.min !== undefined ? props.min : Math.min.apply(null, flat), mx = props.max !== undefined ? props.max : Math.max.apply(null, flat);
    var STEPS = 5;
    function step(v) { return Math.max(0, Math.min(STEPS - 1, Math.floor((v - mn) / ((mx - mn) || 1) * STEPS - 1e-9))); }
    var maxRow = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([3])), m = { l: Math.min(w * 0.3, maxRow * 6.8 + 14), r: 8, t: 4, b: 22 }, cw = (w - m.l - m.r) / cols.length, ch = 22, hh = m.t + rows.length * ch + m.b;
    var labelEvery = Math.max(1, Math.ceil(30 / cw));
    function label(r, c) { var v = vals[r][c]; return rows[r] + " " + cols[c] + ": " + (v == null ? "no data" : fmt(v) + (unit ? " " + unit : "")); }
    function onKey(e) {
      var r = sel ? sel[0] : 0, c = sel ? sel[1] : 0, k = e.key;
      if (!sel && (k.indexOf("Arrow") === 0)) { e.preventDefault(); kbd.current = true; setSel([0, 0]); return; }
      if (k === "ArrowRight") c = Math.min(cols.length - 1, c + 1); else if (k === "ArrowLeft") c = Math.max(0, c - 1);
      else if (k === "ArrowDown") r = Math.min(rows.length - 1, r + 1); else if (k === "ArrowUp") r = Math.max(0, r - 1);
      else if (k === "Home") c = 0; else if (k === "End") c = cols.length - 1; else if (k === "Escape") { setSel(null); return; } else return;
      e.preventDefault(); kbd.current = true; setSel([r, c]);
    }
    var tipV = sel ? vals[sel[0]][sel[1]] : null;
    var cells = [];
    rows.forEach(function (rn, r) { cols.forEach(function (cn, c) {
      var v = vals[r][c], x = m.l + c * cw, y = m.t + r * ch;
      cells.push(h("rect", { key: r + "-" + c, x: x + 1, y: y + 1, width: Math.max(1, cw - 2), height: ch - 2, rx: 2, className: cx("la-heat__cell", v == null && "la-heat__cell--none", sel && sel[0] === r && sel[1] === c && "la-heat__cell--on"), fill: v == null ? "transparent" : "var(--chart-seq-" + (step(v) + 1) + ")", onPointerMove: function () { kbd.current = false; setSel([r, c]); } }));
    }); });
    var plot = h("div", { className: "la-chart__plot", ref: wrap, tabIndex: 0, role: "group", "aria-label": (props.title || "Heatmap") + ". " + rows.length + " rows by " + cols.length + " columns, " + fmt(mn) + " to " + fmt(mx) + (unit ? " " + unit : "") + ". Focus the chart and use the arrow keys to move between cells; the table view lists every value.",
        onKeyDown: onKey, onFocus: function () { if (!kbd.current && !sel) { kbd.current = true; setSel([0, 0]); } }, onBlur: function () { kbd.current = false; setSel(null); } },
      h("svg", { width: w, height: hh, viewBox: "0 0 " + w + " " + hh, "aria-hidden": "true", focusable: "false", onPointerLeave: function () { if (!kbd.current) setSel(null); } },
        rows.map(function (rn, r) { var lab = fit(rn, m.l - 14); return svgText(m.l - 8, m.t + r * ch + ch / 2 + 4, lab, "end", { key: "r" + r, full: lab !== rn ? rn : undefined }); }),
        cols.map(function (cn, c) { if (c % labelEvery) return null; var cl = fit(cn, cw * labelEvery - 4); return svgText(m.l + c * cw + cw / 2, hh - 6, cl, "middle", { key: "c" + c, full: cl !== cn ? cn : undefined }); }),
        cells),
      sel ? h(ChartTooltip, { title: rows[sel[0]] + " " + cols[sel[1]], rows: [{ label: tipV == null ? "no data" : (props.valueLabel || unit || "value"), value: tipV == null ? "-" : fmt(tipV) + (unit ? " " + unit : ""), color: tipV == null ? "var(--chart-grid)" : "var(--chart-seq-" + (step(tipV) + 1) + ")", shape: "rect" }], top: Math.min(hh - 50, m.t + sel[0] * ch + ch), left: Math.min(w - 170, m.l + sel[1] * cw + cw), right: 0, align: "right" }) : null,
      h("span", { className: "la-sr", role: "status", "aria-live": "polite" }, kbd.current && sel ? label(sel[0], sel[1]) : ""));
    var legend = h("div", { className: "la-heat__legend", role: "img", "aria-label": "Scale from " + fmt(mn) + " to " + fmt(mx) + (unit ? " " + unit : "") },
      h("span", null, fmt(mn)), h("span", { className: "la-heat__ramp" }, [1, 2, 3, 4, 5].map(function (i) { return h("span", { key: i, style: { background: "var(--chart-seq-" + i + ")" } }); })), h("span", null, fmt(mx) + (unit ? " " + unit : "")),
      flat.length < rows.length * cols.length ? h("span", { className: "la-heat__none" }, h("span", { className: "la-heat__nonekey" }), "No data") : null);
    var table = { columns: [props.rowLabel || "Row"].concat(cols.map(function (c) { return c; })), rows: rows.map(function (rn, r) { return [rn].concat(vals[r].map(function (v) { return v == null ? "no data" : fmt(v); })); }) };
    return h(ChartFrame, { title: props.title, subtitle: props.subtitle, actions: props.actions, legend: null, table: table, state: props.state || (rows.length && cols.length ? undefined : "empty"), onRetry: props.onRetry, height: hh, emptyTitle: props.emptyTitle, emptyMessage: props.emptyMessage, errorTitle: props.errorTitle, errorMessage: props.errorMessage }, [h("div", { key: "p" }, plot), h("div", { key: "l" }, legend)]);
  }

  window.LosoftApp = {
    Icon: Icon, Button: Button, IconButton: IconButton, Field: Field, Checkbox: Checkbox, Switch: Switch, Segmented: Segmented, Tabs: Tabs,
    Breadcrumbs: Breadcrumbs, Menu: Menu, Dialog: Dialog, StatusDot: StatusDot, Badge: Badge, Kbd: Kbd, Callout: Callout, Panel: Panel,
    AppShell: AppShell, WorkspaceSwitcher: WorkspaceSwitcher, UserMenu: UserMenu, Avatar: Avatar, DetailPanel: DetailPanel, StatusBar: StatusBar, Timeline: Timeline, Steps: Steps, CodeBlock: CodeBlock, Code: Code, LineChart: LineChart, AreaChart: AreaChart, BarChart: BarChart, Heatmap: Heatmap, LatencyBand: LatencyBand, Sparkline: Sparkline, ChartFrame: ChartFrame, ChartLegend: ChartLegend, ChartTooltip: ChartTooltip, SidebarNav: SidebarNav, PageHeader: PageHeader, Toolbar: Toolbar, DataTable: DataTable, StatCard: StatCard, KpiStrip: KpiStrip,
    UptimeBar: UptimeBar, EmptyState: EmptyState, Toast: Toast, FormLayout: FormLayout
  };
})();
