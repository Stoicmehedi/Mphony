(function () {
  "use strict";
  var API = (typeof browser !== "undefined") ? browser : chrome;
  var enabled = document.getElementById("enabled");
  var debug = document.getElementById("debug");

  function storageGet(defaults, cb) {
    try {
      var p = API.storage.local.get(defaults, cb); // Chrome: callback
      if (p && typeof p.then === "function") { p.then(cb); } // Firefox: promise
    } catch (e) { cb(defaults); }
  }
  storageGet({ enabled: true, debug: false }, function (r) {
    enabled.checked = r.enabled !== false;
    if (debug) { debug.checked = !!r.debug; }
  });

  enabled.addEventListener("change", function () {
    API.storage.local.set({ enabled: enabled.checked });
  });

  // learning from the user's typing (data lives only in storage.local)
  var learn = document.getElementById("learn");
  var countEl = document.getElementById("learned-count");
  var clearBtn = document.getElementById("clear-learned");
  var panel = document.getElementById("learned-panel");
  var search = document.getElementById("learned-search");
  var list = document.getElementById("learned-list");
  var LEARN_MIN = 2;          // same threshold content.js uses before suggesting a word
  var SEARCH_FROM = 30;       // show the search box once the list is this long
  var learned = null;

  function avro(s) {
    try { return window.OmicronLab.Avro.Phonetic.parse(s); } catch (e) { return s; }
  }
  function showLearned(v) {
    learned = (v && v.u) ? v : null;
    var words = learned ? Object.keys(learned.u) : [];
    var n = words.length;
    var inUse = words.filter(function (w) { return learned.u[w] >= LEARN_MIN; }).length;
    var open = n && !panel.hidden;
    countEl.textContent = n ? n + " learned word" + (n === 1 ? "" : "s") + " " + (open ? "▴" : "▾") : "No learned words yet";
    if (n) {
      var sub = document.createElement("span");
      sub.className = "sub2";
      sub.textContent = inUse + " in use";
      countEl.appendChild(sub);
    }
    countEl.disabled = !n;
    clearBtn.disabled = !n;
    if (!n) { panel.hidden = true; countEl.setAttribute("aria-expanded", "false"); return; }
    search.hidden = n <= SEARCH_FROM;
    if (open) { renderList(); }
  }
  function renderList() {
    var q = search.hidden ? "" : search.value.trim();
    var qs = q ? [q, avro(q)] : [];
    var words = Object.keys(learned.u)
      .filter(function (w) { return !qs.length || qs.some(function (x) { return w.indexOf(x) !== -1; }); })
      .sort(function (a, b) { return (learned.u[b] - learned.u[a]) || a.localeCompare(b); });
    list.textContent = "";
    if (!words.length) {
      var e = document.createElement("li");
      e.className = "empty";
      e.textContent = "No matches";
      list.appendChild(e);
      return;
    }
    words.forEach(function (w) {
      var c = learned.u[w];
      var li = document.createElement("li");
      var word = document.createElement("span");
      word.className = "lw"; word.textContent = w; word.title = w;
      var count = document.createElement("span");
      count.className = "lc"; count.textContent = c + "×";
      var status = document.createElement("span");
      var on = c >= LEARN_MIN;
      status.className = "ls " + (on ? "on" : "wait");
      status.textContent = on ? "suggested" : (LEARN_MIN - c) + " more use";
      var x = document.createElement("button");
      x.className = "lx"; x.textContent = "✕";
      x.title = "Forget " + w; x.setAttribute("aria-label", "Forget " + w);
      x.addEventListener("click", function () { forget(w); });
      li.appendChild(word); li.appendChild(count); li.appendChild(status); li.appendChild(x);
      list.appendChild(li);
    });
  }
  // remove one word everywhere: its count, its next-word habits, and as a
  // follower of other words
  function forget(w) {
    storageGet({ learned: null }, function (r) {
      var t = r && r.learned;
      if (!t || !t.u) { return; }
      delete t.u[w];
      delete t.b[w];
      for (var p in t.b) {
        delete t.b[p][w];
        if (!Object.keys(t.b[p]).length) { delete t.b[p]; }
      }
      if (Object.keys(t.u).length) { API.storage.local.set({ learned: t }); }
      else { API.storage.local.remove("learned"); }
      showLearned(Object.keys(t.u).length ? t : null);
    });
  }
  countEl.addEventListener("click", function () {
    panel.hidden = !panel.hidden;
    countEl.setAttribute("aria-expanded", String(!panel.hidden));
    showLearned(learned);
    if (!panel.hidden && !search.hidden) { search.focus(); }
  });
  search.addEventListener("input", renderList);
  // stay current if a tab learns words while the popup is open
  try {
    API.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes.learned) { showLearned(changes.learned.newValue); }
    });
  } catch (e) {}
  storageGet({ learn: true, learned: null }, function (r) {
    learn.checked = r.learn !== false;
    showLearned(r.learned);
  });
  learn.addEventListener("change", function () {
    API.storage.local.set({ learn: learn.checked });
  });
  clearBtn.addEventListener("click", function () {
    API.storage.local.remove("learned");
    showLearned(null);
  });

  // current toggle shortcut (user can rebind it in the browser's shortcut settings)
  var shortcutEl = document.getElementById("shortcut");
  function showShortcut(cmds) {
    var c = (cmds || []).filter(function (x) { return x.name === "toggle-language"; })[0];
    shortcutEl.textContent = "";
    var fallback = !c || !c.shortcut;
    try { API.storage.local.set({ shortcutFallback: fallback }); } catch (e) {}
    // unassigned: content.js handles Ctrl+Space itself, so that is the shortcut
    if (fallback) { c = { shortcut: "Ctrl+Space" }; }
    c.shortcut.split("+").forEach(function (k, i) {
      if (i) { shortcutEl.appendChild(document.createTextNode("+")); }
      var kbd = document.createElement("kbd");
      kbd.textContent = k;
      shortcutEl.appendChild(kbd);
    });
  }
  try {
    var p = API.commands.getAll(showShortcut);
    if (p && typeof p.then === "function") { p.then(showShortcut); }
  } catch (e) {}

  document.getElementById("change-shortcut").addEventListener("click", function () {
    // Detect Firefox by URL scheme: newer Chrome also defines `browser`.
    var isFirefox = API.runtime.getURL("").indexOf("moz-extension:") === 0;
    if (isFirefox && API.commands.openShortcutSettings) { API.commands.openShortcutSettings(); } // Firefox 137+
    else if (isFirefox) { API.tabs.create({ url: "about:addons" }); }
    else { API.tabs.create({ url: "chrome://extensions/shortcuts" }); }
    window.close();
  });

  if (debug) {
    debug.addEventListener("change", function () {
      API.storage.local.set({ debug: debug.checked });
    });
  }
})();
