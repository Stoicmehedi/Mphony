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
  if (tab) { sendToggle(tab); return; }
  var q = API.tabs.query({ active: true, currentWindow: true }, function (tabs) { sendToggle(tabs && tabs[0]); });
  if (q && typeof q.then === "function") { q.then(function (tabs) { sendToggle(tabs && tabs[0]); }); }
});
