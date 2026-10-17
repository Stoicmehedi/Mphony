/*
  Mphony content script — English by default; the toggle shortcut flips the site to
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
  var DHONI_VERSION = "0.2.0-next";
  try { console.log("%cMphony " + DHONI_VERSION + " loaded", "color:#2f6f6a;font-weight:bold", "on", location.host); } catch (e) {}

  // ---- settings (synced with storage + popup) ----
  // Bangla/English mode is remembered per site (hostname), so new tabs and
  // reloads of the same site open in the last mode used there.
  var SITE = location.hostname || location.protocol;
  var siteState = { lang: "en" };
  function saveSiteLang(lang) {
    storageGet({ siteLang: {} }, function (r) {
      var m = (r && r.siteLang) || {};
      if (lang === "bn") { m[SITE] = "bn"; } else { delete m[SITE]; }
      try { API.storage.local.set({ siteLang: m }); } catch (e) {}
    });
  }
  var ENABLED = true;
  var LEARN_ON = true;
  var SHORTCUT_FALLBACK = true;   // handle Ctrl+Space in-page while the browser command has no key
  var learned = { u: {}, b: {} }, pending = { u: {}, b: {} }; // see "learning" below; set before storage loads
  var DEBUG = false;
  // Chrome uses callbacks; Firefox returns a Promise — support both.
  function storageGet(defaults, cb) {
    try {
      var p = API.storage.local.get(defaults, cb);
      if (p && typeof p.then === "function") { p.then(cb); }
    } catch (e) { cb(defaults); }
  }
  try {
    storageGet({ enabled: true, debug: false, siteLang: {}, learn: true, learned: null, shortcutFallback: true }, function (r) {
      if (r) {
        ENABLED = r.enabled !== false;
        DEBUG = !!r.debug;
        LEARN_ON = r.learn !== false;
        SHORTCUT_FALLBACK = r.shortcutFallback !== false;
        learnedLoaded(r.learned);
        siteState.lang = (r.siteLang && r.siteLang[SITE] === "bn") ? "bn" : "en";
        if (DEBUG) { hud("loaded on " + location.host); }
      }
    });
    API.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") { return; }
      if (changes.enabled) { ENABLED = changes.enabled.newValue !== false; }
      if (changes.shortcutFallback) { SHORTCUT_FALLBACK = changes.shortcutFallback.newValue !== false; }
      if (changes.learn) { LEARN_ON = changes.learn.newValue !== false; }
      if (changes.learned) { learnedLoaded(changes.learned.newValue); }
      if (changes.siteLang) {
        var m = changes.siteLang.newValue || {};
        var lang = m[SITE] === "bn" ? "bn" : "en";
        if (lang !== siteState.lang) { siteState.lang = lang; if (lang !== "bn") { sgHide(); } }
      }
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
  var busy = false;                             // guard against our own synthetic input events

  // One mode for the whole site (see SITE above); every field shares it.
  function stateOf(el) { return siteState; }

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
    var bn = parse(word);
    busy = true;
    ctx.replace(start, caret, bn);
    busy = false;
    learnWord(prevWordIn(text.slice(0, start)), bn);
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
  // Hand-picked chat replies, shown before the corpus suggestions.
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

  // য় ড় ঢ় can be one code point or base+nukta; Avro and our data use the former.
  function norm(w) {
    return w.replace(/\u09AF\u09BC/g, "\u09DF").replace(/\u09A1\u09BC/g, "\u09DC")
      .replace(/\u09A2\u09BC/g, "\u09DD").replace(/\u200C/g, "");
  }
  var BN_WORD = /^[\u0980-\u09E5\u09F0-\u09FF\u200C\u200D]+$/;

  // Corpus next-word table (next-bn.js): "i:j,k,..." hex indexes into DICT,
  // best first. Parsed on first use so pages that never use Bangla pay nothing.
  var corpusNext = null;
  function corpusNextOf(w) {
    if (!corpusNext) {
      corpusNext = {};
      var raw = (typeof DHONI_NEXT === "string") ? DHONI_NEXT : "";
      var rows = raw ? raw.split("|") : [];
      for (var i = 0; i < rows.length; i++) {
        var c = rows[i].indexOf(":");
        corpusNext[DICT[parseInt(rows[i].slice(0, c), 16)]] = rows[i].slice(c + 1);
      }
    }
    var r = corpusNext[w];
    if (typeof r === "string") {           // decode a row lazily, once
      r = r.split(",").map(function (x) { return DICT[parseInt(x, 16)]; });
      corpusNext[w] = r;
    }
    return r || [];
  }

  // ---- learning from the user's own typing ----
  // Stored only in this browser (storage.local, never synced or sent):
  // { u: {word: count}, b: {prevWord: {word: count}} }. Words the user commits
  // in Bangla mode are counted; a word needs LEARN_MIN uses before it is offered.
  var LEARN_MIN = 2, MAX_U = 5000, MAX_B = 5000;
  var flushTimer = null;
  var INCOGNITO = false;
  try { INCOGNITO = !!(API.extension && API.extension.inIncognitoContext); } catch (e) {}

  function addInto(t, d) {
    var k, w;
    for (k in d.u) { t.u[k] = (t.u[k] || 0) + d.u[k]; }
    for (k in d.b) {
      var row = t.b[k] || (t.b[k] = {});
      for (w in d.b[k]) { row[w] = (row[w] || 0) + d.b[k][w]; }
    }
    return t;
  }
  function copyLearned(v) {
    return addInto({ u: {}, b: {} }, (v && v.u && v.b) ? v : { u: {}, b: {} });
  }
  function learnedLoaded(v) {
    if (!v) { pending = { u: {}, b: {} }; }       // cleared from the popup
    learned = addInto(copyLearned(v), pending);
  }
  // keep the store bounded: drop the least-used entries
  function prune(t) {
    var us = Object.keys(t.u);
    if (us.length > MAX_U) {
      us.sort(function (a, b) { return t.u[b] - t.u[a]; });
      us.slice(Math.floor(MAX_U * 0.8)).forEach(function (k) { delete t.u[k]; });
    }
    var bs = [];
    for (var p in t.b) { for (var w in t.b[p]) { bs.push([p, w, t.b[p][w]]); } }
    if (bs.length > MAX_B) {
      bs.sort(function (a, b) { return b[2] - a[2]; });
      bs.slice(Math.floor(MAX_B * 0.8)).forEach(function (e) {
        delete t.b[e[0]][e[1]];
        if (!Object.keys(t.b[e[0]]).length) { delete t.b[e[0]]; }
      });
    }
    return t;
  }
  function flushLearned() {
    flushTimer = null;
    var d = pending;
    pending = { u: {}, b: {} };
    storageGet({ learned: null }, function (r) {   // merge with other tabs' writes
      var t = prune(addInto(copyLearned(r && r.learned), d));
      try { API.storage.local.set({ learned: t }); } catch (e) {}
    });
  }
  function learnWord(prev, word) {
    if (!LEARN_ON || INCOGNITO) { return; }
    word = norm(word || "");
    if (!BN_WORD.test(word)) { return; }
    prev = norm(prev || "");
    var d = { u: {}, b: {} };
    d.u[word] = 1;
    if (BN_WORD.test(prev)) { d.b[prev] = {}; d.b[prev][word] = 1; }
    addInto(learned, d);
    addInto(pending, d);
    if (!flushTimer) { flushTimer = setTimeout(flushLearned, 2000); }
  }
  function prevWordIn(before) {
    var m = before.match(/(\S+)\s+$/);
    return m ? m[1] : "";
  }
  // the user's frequent words after `prev`, most used first
  function learnedNext(prev) {
    if (!LEARN_ON) { return []; }
    var row = learned.b[prev] || {};
    return Object.keys(row).filter(function (w) { return row[w] >= LEARN_MIN; })
      .sort(function (a, b) { return row[b] - row[a]; });
  }
  // the user's frequent words starting with `pfx`, best for this context first
  function learnedWith(pfx, prev) {
    if (!LEARN_ON) { return []; }
    var row = learned.b[prev] || {}, u = learned.u;
    return Object.keys(u).filter(function (w) { return u[w] >= LEARN_MIN && w !== pfx && w.indexOf(pfx) === 0; })
      .sort(function (a, b) { return ((row[b] || 0) - (row[a] || 0)) || (u[b] - u[a]); });
  }

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
    var info = beforeCaret(el);
    var prev = info ? prevWordIn(info.before.slice(0, info.before.length - (sg.rr ? sg.rr.roman.length : 0))) : "";
    if (sg.rr) { sg.rr.replaceRun(word + " "); }
    learnWord(prev, word);
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
    var seen = {};
    function add(list, filter) {
      for (var i = 0; i < list.length && items.length < 6; i++) {
        var w = list[i];
        if (!seen[w] && (!filter || filter(w))) { seen[w] = 1; items.push(w); }
      }
    }
    if (rr && rr.roman && ROMAN.test(rr.roman)) {
      // completing a word: your words, then what usually follows the previous
      // word, then the most frequent words overall
      var pfx = parse(rr.roman);
      var info = beforeCaret(el);
      var prev = info ? norm(prevWordIn(info.before.slice(0, info.before.length - rr.roman.length))) : "";
      var starts = function (w) { return w !== pfx && w.indexOf(pfx) === 0; };
      how = "roman='" + rr.roman + "'->'" + pfx + "' prev='" + prev + "'";
      add(learnedWith(pfx, prev));
      if (prev) { add(corpusNextOf(prev), starts); }
      add(DICT, starts);
    } else {
      // after a finished word: your usual next words, hand-picked replies, corpus
      var lw = norm(lastBanglaWord(el));
      how = "nextword last='" + lw + "'";
      if (lw) { add(learnedNext(lw)); add(NEXT[lw] || []); add(corpusNextOf(lw)); }
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

    // Ctrl+Space fallback when the browser didn't assign the shortcut (see background.js)
    if (SHORTCUT_FALLBACK && e.ctrlKey && !e.altKey && !e.shiftKey && (e.code === "Space" || e.key === " ")) {
      if (!ENABLED) { return; }
      e.preventDefault();
      toggleLang(el);
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

  // Toggle shortcut (default Ctrl+Space, user-changeable) is a browser command:
  // background.js receives it and messages every frame of the tab. Only the
  // frame that has focus in a text box acts, so exactly one toggle happens.
  function toggleLang(el) {
    var st = stateOf(el);
    st.lang = (st.lang === "bn") ? "en" : "bn";
    if (st.lang !== "bn") { sgHide(); }
    showBadge(el, st.lang);
    saveSiteLang(st.lang);
  }
  try {
    API.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== "mphony-toggle" || !ENABLED) { return; }
      if (!document.hasFocus()) { return; }
      var el = document.activeElement;
      if (!isEditable(el)) { return; }
      toggleLang(el);
    });
  } catch (e) {}

  // Remind which mode the site is in when you enter a box in Bangla mode,
  // since the mode now carries over from earlier visits.
  document.addEventListener("focusin", function (e) {
    if (!ENABLED || siteState.lang !== "bn") { return; }
    if (!isEditable(e.target)) { return; }
    showBadge(e.target, "bn");
  }, true);

  document.addEventListener("focusout", function (e) {
    if (!ENABLED) { return; }
    var el = e.target;
    if (!isEditable(el)) { return; }
    if (siteState.lang === "bn") { convertWord(el); }
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
