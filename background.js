// Relays the toggle shortcut (chrome://extensions/shortcuts or Firefox's
// "Manage Extension Shortcuts") to the content scripts in the active tab.
var API = (typeof browser !== "undefined") ? browser : chrome;

function sendToggle(tab) {
  if (!tab || tab.id == null) { return; }
  try {
    var p = API.tabs.sendMessage(tab.id, { type: "mphony-toggle" });
    if (p && typeof p.catch === "function") { p.catch(function () {}); } // no content script (e.g. chrome:// pages)
  } catch (e) {}
}

API.commands.onCommand.addListener(function (command, tab) {
  if (command !== "toggle-language") { return; }
  syncFallback();                                   // a shortcut fired, so one is assigned
  if (tab) { sendToggle(tab); return; }
  var q = API.tabs.query({ active: true, currentWindow: true }, function (tabs) { sendToggle(tabs && tabs[0]); });
  if (q && typeof q.then === "function") { q.then(function (tabs) { sendToggle(tabs && tabs[0]); }); }
});

// Ctrl+Space is only *suggested* in the manifest: the browser leaves the command
// unassigned if the extension was already installed when it was added, or if
// another extension holds the key. In that case content.js handles Ctrl+Space
// itself; once the user assigns any shortcut, it steps aside.
function syncFallback() {
  function apply(cmds) {
    var c = (cmds || []).filter(function (x) { return x.name === "toggle-language"; })[0];
    try { API.storage.local.set({ shortcutFallback: !(c && c.shortcut) }); } catch (e) {}
  }
  try {
    var p = API.commands.getAll(apply);
    if (p && typeof p.then === "function") { p.then(apply); }
  } catch (e) {}
}
syncFallback();                                     // every time the background starts
API.runtime.onInstalled.addListener(syncFallback);
if (API.runtime.onStartup) { API.runtime.onStartup.addListener(syncFallback); }
if (API.commands.onChanged) { API.commands.onChanged.addListener(syncFallback); } // Firefox
