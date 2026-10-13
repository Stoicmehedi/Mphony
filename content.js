/*
  Mphony content script — English by default; the trigger word flips the field to
  live Bangla phonetic (Avro). Works in <input>, <textarea> and simple
  contenteditable fields on any site. Loaded after avro-lib.js, so the global
  OmicronLab.Avro.Phonetic is available in this isolated world.
*/
(function () {
  "use strict";

  var API = (typeof browser !== "undefined") ? browser : chrome;
  var AVRO = (window.OmicronLab && OmicronLab.Avro && OmicronLab.Avro.Phonetic)
    ? OmicronLab.Avro.Phonetic
    : { parse: function (s) { return s; } };

  function parse(s) { try { return AVRO.parse(s); } catch (e) { return s; } }

  // one-time load marker so you can confirm injection + which build is live
  var DHONI_VERSION = "0.1.7-gtry";
  try { console.log("%cMphony " + DHONI_VERSION + " loaded", "color:#2f6f6a;font-weight:bold", "on", location.host); } catch (e) {}

  // ---- settings (synced with storage + popup) ----
  var ENABLED = true;
  var DEBUG = false;
  // Chrome uses callbacks; Firefox returns a Promise — support both.
  function storageGet(defaults, cb) {
    try {
      var p = API.storage.local.get(defaults, cb);
      if (p && typeof p.then === "function") { p.then(cb); }
    } catch (e) { cb(defaults); }
  }
  try {
    storageGet({ enabled: true, debug: false }, function (r) {
      if (r) {
        ENABLED = r.enabled !== false;
        DEBUG = !!r.debug;
        if (DEBUG) { hud("loaded on " + location.host); }
      }
    });
    API.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") { return; }
      if (changes.enabled) { ENABLED = changes.enabled.newValue !== false; }
      if (changes.debug) { DEBUG = !!changes.debug.newValue; if (DEBUG) { hud("debug on · " + location.host); } else { hudOff(); } }
    });
  } catch (e) { /* storage may be unavailable in some frames */ }

  // ---- visible debug bar (can't be hidden by console filters) ----
  var hudEl = null;
  function hud(msg) {
    if (!(DEBUG || window.__DHONI_DEBUG__)) { return; }
    try {
      if (!hudEl) {
        hudEl = document.createElement("div");
        hudEl.style.cssText =
          "position:fixed;z-index:2147483647;top:0;left:50%;transform:translateX(-50%);" +
          "background:#211c17;color:#6fe3d2;font:600 12px/1.4 ui-monospace,monospace;padding:4px 12px;" +
          "border-radius:0 0 8px 8px;pointer-events:none;max-width:94vw;white-space:nowrap;" +
          "overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.3);";
        (document.body || document.documentElement).appendChild(hudEl);
      }
      hudEl.textContent = "Mphony " + DHONI_VERSION + " · " + msg;
      hudEl.style.display = "block";
    } catch (e) {}
  }
  function hudOff() { if (hudEl) { hudEl.style.display = "none"; } }

  var ROMAN = /[A-Za-z]/;                       // what counts as a letter in a word
  var ROMAN_INPUT = /[A-Za-z`^~]/;              // chars that are still "mid-word" in Bangla mode
  var states = new WeakMap();                   // per-element { lang: 'en' | 'bn' }
  var busy = false;                             // guard against our own synthetic input events

  // The STABLE field to key state on. Rich editors (WhatsApp/Lexical) fire events
  // on throwaway inner nodes, so we climb to the contenteditable host, which
  // persists across keystrokes. Without this, Bangla mode resets every keystroke.
  function stateKey(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") { return el; }
    var n = el;
    while (n && n.parentNode && n.parentNode.isContentEditable) { n = n.parentNode; }
    return (n && n.isContentEditable) ? n : el;
  }
  function stateOf(el) {
    var k = stateKey(el);
    var s = states.get(k);
    if (!s) { s = { lang: "en" }; states.set(k, s); }
    return s;
  }

  function isEditable(el) {
    if (!el || !el.tagName) { return false; }
    var tag = el.tagName;
    if (tag === "TEXTAREA") { return true; }
    if (tag === "INPUT") {
      var t = (el.type || "text").toLowerCase();
      return t === "text" || t === "search" || t === "url" || t === "email" || t === "tel";
    }
    return !!el.isContentEditable;
  }

  function setNativeValue(el, value) {
    var proto = (el.tagName === "TEXTAREA")
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) { desc.set.call(el, value); } else { el.value = value; }
  }

  function dispatchInput(el) {
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false })); }
    catch (e) { el.dispatchEvent(new Event("input", { bubbles: true })); }
  }

  function fireInput(el, data) {
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, inputType: "insertText", data: data })); }
    catch (e) { try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {} }
  }

  // Replace range [s,e) in an input/textarea with `repl`. Try the browser's native
  // editing path (execCommand), then verify it actually took — stubborn boxes like
  // Google's search field re-sync from their own model, so if the value didn't
  // change we fall back to the native value setter + a full input event.
  function replaceRangeInput(el, s, e, repl) {
    var before = el.value;
    var want = before.slice(0, s) + repl + before.slice(e);
    try {
      el.focus();
      el.setSelectionRange(s, e);
      if (typeof document.execCommand === "function" && document.execCommand("insertText", false, repl)) {
        if (el.value === want || el.value !== before) { return; } // it stuck
      }
    } catch (_) {}
    // fallback: native value setter + rich input event
    setNativeValue(el, want);
    var c = s + repl.length;
    try { el.setSelectionRange(c, c); } catch (_) {}
    fireInput(el, repl);
  }

  // Return {text, caret, replace(start,end,repl)} for the active edit point, or null.
  function getCtx(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      var caret = el.selectionStart;
      if (caret == null) { return null; }
      return {
        text: el.value,
        caret: caret,
        replace: function (s, e, repl) { replaceRangeInput(el, s, e, repl); }
      };
    }
    // contenteditable — works in plain editors and, via execCommand, in rich
    // editors like WhatsApp/Facebook (Lexical) that ignore direct DOM edits.
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) { return null; }
    var node = sel.focusNode;
    if (!node || node.nodeType !== 3) { return null; } // only when caret is in a text node
    var off = sel.focusOffset;
    return {
      text: node.data,
      caret: off,
      replace: function (s, e, repl) {
        // Select the roman run, then insert through the editor's own input path.
        try {
          var r = document.createRange();
          r.setStart(node, s);
          r.setEnd(node, Math.min(e, node.data.length));
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (_) {}
        var ok = false;
        try { ok = document.execCommand && document.execCommand("insertText", false, repl); } catch (_) {}
        if (!ok) {
          // fallback: direct DOM edit (plain contenteditable)
          try {
            node.data = node.data.slice(0, s) + repl + node.data.slice(e);
            var r2 = document.createRange();
            r2.setStart(node, s + repl.length);
            r2.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r2);
            dispatchInput(el);
          } catch (_) {}
        }
      }
    };
  }

  // Convert the roman run ending at the caret to Bangla. Returns true if it did.
  function convertWord(el) {
    var ctx = getCtx(el);
    if (!ctx) { return false; }
    var text = ctx.text, caret = ctx.caret;
    var start = caret;
    while (start > 0 && ROMAN_INPUT.test(text.charAt(start - 1))) { start--; }
    var word = text.slice(start, caret);
    if (!word || !ROMAN.test(word)) { return false; }
    busy = true;
    ctx.replace(start, caret, parse(word));
    busy = false;
    return true;
  }

  function isSeparatorKey(e) {
    if (e.key === "Enter") { return true; }
    return e.key.length === 1 && !ROMAN_INPUT.test(e.key);
  }

  // ===================== word suggestions =====================
  // Prefer the bundled frequency-ranked list (dict-bn.js, ~30k words, most
  // frequent first); fall back to a tiny builtin if it isn't loaded.
  var DICT = (typeof DHONI_DICT !== "undefined" && DHONI_DICT && DHONI_DICT.length)
    ? DHONI_DICT
    : [
    "আমি","আমরা","আমার","আমাকে","আমাদের","আজ","আকাশ","আপনি","আপনাকে","আগে","আছে","আছি","আছো","আছেন","আছিস",
    "তুমি","তোমরা","তোমার","তোমাকে","তখন","তাই","তবে",
    "বাংলা","বাংলাদেশ","বাবা","বাজার","বাসা","বাসায়","বই","বন্ধু","বোন","বিকেল",
    "ভাই","ভালো","ভালোবাসা","ভাত",
    "কি","কী","কেমন","কথা","কাজ","করি","করছি","করবো","কলম","কলেজ","কোথায়","কেন","খাবার","খুব",
    "গান","ঘর","চা","ছবি","যাব","যাবে","যাচ্ছি","স্কুল","স্কুলে",
    "সকাল","সন্ধ্যা","রাত","দিন","দেশ","নাম","পানি","মা","অফিস","অফিসে",
    "ধন্যবাদ","শুভেচ্ছা","দয়া","অনেক","একটু","এখন","হবে","হচ্ছে","হয়েছে","থাকি","লাগছে","থেকো"
  ];
  var NEXT = {
    "আমি": ["তোমাকে", "ভালো", "আজ", "এখন", "একটু", "জানি"],
    "আমরা": ["যাবো", "আছি", "সবাই", "একসাথে"],
    "আমার": ["নাম", "সাথে", "কাছে", "জন্য", "বাসা"],
    "তুমি": ["কেমন", "কোথায়", "কি", "আজ", "ভালো", "কখন"],
    "তোমার": ["নাম", "সাথে", "কাছে", "জন্য", "বাসা"],
    "আপনি": ["কেমন", "কোথায়", "কি", "কখন"],
    "আজ": ["আমি", "অনেক", "রাতে", "সকালে", "খুব"],
    "কি": ["করছো", "হয়েছে", "খবর", "করবো", "বলবো"],
    "কেমন": ["আছো", "আছেন", "আছিস"],
    "ভালো": ["আছি", "আছো", "লাগছে", "থেকো", "হবে"],
    "খুব": ["ভালো", "সুন্দর", "খুশি"],
    "একটু": ["পরে", "আগে", "অপেক্ষা", "দাঁড়াও"],
    "ধন্যবাদ": ["আপনাকে", "তোমাকে", "অনেক"]
  };

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }

  function isInputLike(el) { return el.tagName === "INPUT" || el.tagName === "TEXTAREA"; }

  // All text immediately before the caret — robust across inputs AND rich
  // contenteditable editors (WhatsApp/YouTube/Lexical), via the Selection/Range
  // API. Driven by the current selection, NOT the event target element, because
  // rich editors fire events on inner nodes.
  function beforeCaret(el) {
    if (isInputLike(el)) {
      var c = el.selectionStart;
      if (c == null) { return null; }
      return { before: el.value.slice(0, c) };
    }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) { return null; }
    var range = sel.getRangeAt(0);
    if (!range.collapsed) { return null; }
    // climb to the top-most contenteditable host that contains the caret
    var host = range.endContainer.nodeType === 3 ? range.endContainer.parentNode : range.endContainer;
    while (host && host.parentNode && host.parentNode.isContentEditable) { host = host.parentNode; }
    try {
      var pre = document.createRange();
      pre.selectNodeContents(host || range.endContainer);
      pre.setEnd(range.endContainer, range.endOffset);
      return { before: pre.toString() };
    } catch (e) {
      // fallback: just the current text node up to the caret
      try {
        var ec = range.endContainer;
        if (ec.nodeType === 3) { return { before: ec.data.slice(0, range.endOffset) }; }
      } catch (_) {}
      return null;
    }
  }

  // the roman run ending at the caret, plus a replaceRun() that swaps it for Bangla
  function romanRunCtx(el) {
    var info = beforeCaret(el);
    if (!info) { return null; }
    var m = info.before.match(/[A-Za-z`^~]+$/);
    var roman = m ? m[0] : "";
    return {
      roman: roman,
      replaceRun: function (repl) {
        busy = true;
        try {
          if (isInputLike(el)) {
            var c = el.selectionStart;
            replaceRangeInput(el, c - roman.length, c, repl);
          } else {
            var sel = window.getSelection();
            try { for (var i = 0; i < roman.length; i++) { sel.modify("extend", "backward", "character"); } } catch (_) {}
            var ok = false;
            try { ok = document.execCommand("insertText", false, repl); } catch (_) {}
            if (!ok) { try { sel.getRangeAt(0).deleteContents(); } catch (_) {} }
          }
        } finally { busy = false; }
      }
    };
  }
  // the completed Bangla word just before the caret (followed by a space)
  function lastBanglaWord(el) {
    var info = beforeCaret(el);
    if (!info) { return ""; }
    var m = info.before.match(/(\S+)\s+$/);
    return m ? m[1] : "";
  }

  var sg = { el: null, list: [], idx: -1, target: null, rr: null };
  function sgEnsure() {
    if (sg.el) { return; }
    var d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText =
      "position:fixed;z-index:2147483647;min-width:120px;max-width:300px;background:#fff;color:#211c17;" +
      "border:1px solid #d9d0c2;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;" +
      "font-family:'Noto Sans Bengali','Hind Siliguri',system-ui,sans-serif;font-size:17px;display:none;";
    d.addEventListener("mousedown", function (e) {
      var it = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
      if (!it) { return; }
      e.preventDefault(); // keep the text field focused
      sgAccept(parseInt(it.getAttribute("data-i"), 10));
    });
    (document.body || document.documentElement).appendChild(d);
    sg.el = d;
  }
  function sgVisible() { return sg.el && sg.el.style.display !== "none" && sg.list.length; }
  function sgHide() { if (sg.el) { sg.el.style.display = "none"; } sg.list = []; sg.idx = -1; }
  function sgRender() {
    sgEnsure();
    var html = "";
    for (var i = 0; i < sg.list.length; i++) {
      var hot = i === sg.idx;
      html += '<div data-i="' + i + '" style="padding:6px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;' +
        (hot ? "background:#2f6f6a;color:#fff;" : "") + '">' + escHtml(sg.list[i]) + "</div>";
    }
    sg.el.innerHTML = html;
  }
  function caretRect(el) {
    if (!isInputLike(el)) {
      try {
        var sel = window.getSelection();
        if (sel && sel.rangeCount) {
          var rg = sel.getRangeAt(0).cloneRange();
          var rects = rg.getClientRects();
          var rc = (rects && rects.length) ? rects[rects.length - 1] : rg.getBoundingClientRect();
          if (rc && (rc.top || rc.bottom || rc.left)) { return rc; }
        }
      } catch (e) {}
    }
    return el.getBoundingClientRect();
  }
  function sgShow(el, items, rr) {
    sgEnsure();
    sg.list = items.slice(0, 6); sg.idx = -1; sg.target = el; sg.rr = rr || null;
    sgRender();
    try {
      sg.el.style.display = "block";
      var r = caretRect(el);
      var h = sg.el.offsetHeight || 40, w = sg.el.offsetWidth || 140;
      var top = r.bottom + 4;
      if (top + h > window.innerHeight - 4) { top = r.top - h - 4; } // flip above the caret
      if (top < 4) { top = 4; }
      var left = Math.min(r.left, window.innerWidth - w - 8);
      sg.el.style.left = Math.max(4, left) + "px";
      sg.el.style.top = top + "px";
    } catch (e) {}
  }
  function sgAccept(i) {
    if (i == null || i < 0) { i = 0; }
    var word = sg.list[i];
    var el = sg.target;
    if (word == null || !el) { return; }
    if (sg.rr) { sg.rr.replaceRun(word + " "); }
    sgHide();
    try { el.focus(); } catch (e) {}
    updateSuggestions(el); // offer next-word predictions
  }
  function updateSuggestions(el) {
    if (!ENABLED) { sgHide(); return; }
    if (stateOf(el).lang !== "bn") { hud("skip (lang=en)"); sgHide(); return; }
    var rr = romanRunCtx(el);
    var items = [];
    var how = "";
    if (rr && rr.roman && ROMAN.test(rr.roman)) {
      var pfx = parse(rr.roman);
      how = "roman='" + rr.roman + "'->'" + pfx + "'";
      for (var i = 0; i < DICT.length && items.length < 6; i++) {
        if (DICT[i].indexOf(pfx) === 0 && DICT[i] !== pfx) { items.push(DICT[i]); }
      }
    } else {
      var lw = lastBanglaWord(el);
      how = "nextword last='" + lw + "'";
      if (lw && NEXT[lw]) { items = NEXT[lw].slice(0, 6); }
    }
    hud(how + " -> " + items.length + " sugg" + (items.length ? " (" + items[0] + "…)" : ""));
    if (items.length) { sgShow(el, items, rr); } else { sgHide(); }
  }

  // ---- event wiring (capture phase, document-wide) ----
  document.addEventListener("keydown", function (e) {
    var el = e.target;
    if (!isEditable(el)) { return; }

    // suggestion navigation (only while the popup is open)
    if (ENABLED && sgVisible()) {
      var n = sg.list.length;
      if (e.key === "ArrowDown") { e.preventDefault(); sg.idx = (sg.idx + 1) % n; sgRender(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); sg.idx = (sg.idx - 1 + n) % n; sgRender(); return; }
      if (e.key === "Escape") { e.preventDefault(); sgHide(); return; }
      if (e.key === "Tab") { e.preventDefault(); sgAccept(sg.idx < 0 ? 0 : sg.idx); return; }
      if (e.key === "Enter" && sg.idx >= 0) { e.preventDefault(); sgAccept(sg.idx); return; }
    }

    // Ctrl/Cmd + Space toggles language for this field
    if ((e.ctrlKey || e.metaKey) && (e.code === "Space" || e.key === " ")) {
      if (!ENABLED) { return; }
      e.preventDefault();
      var st = stateOf(el);
      st.lang = (st.lang === "bn") ? "en" : "bn";
      if (st.lang !== "bn") { sgHide(); }
      showBadge(el, st.lang);
      return;
    }

    if (!ENABLED) { return; }
    var s = stateOf(el);
    if (s.lang === "bn" && isSeparatorKey(e)) {
      // finish the current word, then let the separator insert normally
      convertWord(el);
    }
  }, true);

  document.addEventListener("input", function (e) {
    if (busy || !ENABLED) { return; }
    var el = e.target;
    if (!isEditable(el)) { return; }
    var s = stateOf(el);
    hud("input " + el.tagName + (el.isContentEditable ? "(ce)" : "") + " lang=" + s.lang);
    if (s.lang === "bn") { updateSuggestions(el); }
  }, true);

  document.addEventListener("focusout", function (e) {
    if (!ENABLED) { return; }
    var el = e.target;
    if (!isEditable(el)) { return; }
    var s = states.get(stateKey(el));
    if (s && s.lang === "bn") { convertWord(el); }
    sgHide();
  }, true);

  // ---- tiny on-page status badge ----
  var badgeEl = null, badgeTimer = null;
  function showBadge(el, lang) {
    try {
      if (!badgeEl) {
        badgeEl = document.createElement("div");
        badgeEl.setAttribute("aria-hidden", "true");
        badgeEl.style.cssText =
          "position:fixed;z-index:2147483647;bottom:18px;right:18px;pointer-events:none;" +
          "font-family:system-ui,sans-serif;font-size:13px;font-weight:600;padding:7px 13px;" +
          "border-radius:999px;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);" +
          "transition:opacity .2s;opacity:0;";
        (document.body || document.documentElement).appendChild(badgeEl);
      }
      var bn = lang === "bn";
      badgeEl.textContent = bn ? "বাংলা" : "English";
      badgeEl.style.background = bn ? "#2f6f6a" : "#9d2b3a";
      badgeEl.style.opacity = "1";
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(function () { if (badgeEl) { badgeEl.style.opacity = "0"; } }, 1400);
    } catch (e) {}
  }
})();
