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

  if (debug) {
    debug.addEventListener("change", function () {
      API.storage.local.set({ debug: debug.checked });
    });
  }
})();
