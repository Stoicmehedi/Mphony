/*
  Mphony helper for Google Docs, run in the page's own JS world (manifest
  "world": "MAIN"). Docs draws text on a canvas and reads typing from key events
  on a hidden box inside an iframe (.docs-texteventtarget-iframe). Key codes set
  from the extension's isolated world are invisible to Docs' code, so content.js
  asks this script, via a "mphony-docs" DOM event, to send the keys instead:
  detail = JSON {del: <backspaces>, text: <string to type>}.
*/
(function () {
  "use strict";

  function target() {
    var f = document.querySelector("iframe.docs-texteventtarget-iframe");
    var d = f && f.contentDocument;
    if (!d) { return null; }
    return (d.activeElement && d.activeElement !== d.body) ? d.activeElement
      : (d.querySelector("[contenteditable=true]") || d.body);
  }

  function send(t, type, keyCode, key, charCode) {
    var KE = t.ownerDocument.defaultView.KeyboardEvent;
    var e = new KE(type, { key: key, bubbles: true, cancelable: true });
    Object.defineProperty(e, "keyCode", { get: function () { return keyCode; } });
    Object.defineProperty(e, "which", { get: function () { return keyCode; } });
    Object.defineProperty(e, "charCode", { get: function () { return charCode; } });
    t.dispatchEvent(e);
  }

  document.addEventListener("mphony-docs", function (ev) {
    var d;
    try { d = JSON.parse(ev.detail); } catch (e) { return; }
    var t = target();
    if (!t || !d) { return; }
    for (var i = 0; i < (d.del || 0); i++) {
      send(t, "keydown", 8, "Backspace", 0);
      send(t, "keyup", 8, "Backspace", 0);
    }
    var s = String(d.text || "");
    for (var j = 0; j < s.length; j++) {
      var c = s.charCodeAt(j);
      send(t, "keypress", c, s.charAt(j), c);
    }
  });
})();
