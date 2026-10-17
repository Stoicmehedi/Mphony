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
  function showLearned(v) {
    var n = (v && v.u) ? Object.keys(v.u).length : 0;
    countEl.textContent = n ? n + " learned word" + (n === 1 ? "" : "s") : "No learned words yet";
    clearBtn.disabled = !n;
  }
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
    if (!c || !c.shortcut) { shortcutEl.textContent = "(not set)"; return; }
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
