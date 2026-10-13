# Mphony — Banglish → Bangla browser extension

By **Md Mehedi Hasan** · stoicmehedi@gmail.com

Type English by default in any text box. Press **Ctrl + Space** to switch that field
to **Bangla** (Avro phonetic); press it again to switch back to English. A word
suggestion dropdown appears while you type in Bangla.

Works in `<input>`, `<textarea>`, and `contenteditable` boxes (incl. WhatsApp/YouTube).

## How it works

- Default mode is **English** — keystrokes pass through untouched.
- **Ctrl + Space** toggles the focused field between English and Bangla (a small
  badge shows the current mode).
- In Bangla mode, each word is transliterated with the **OmicronLab Avro Phonetic**
  engine (`avro-lib.js`, jsAvroPhonetic by Rifat Nabi, MPL-1.1) when you press
  space / Enter / punctuation, or when you leave the field.
- The whole extension can be toggled off from the toolbar popup.

## Load it (unpacked, for development)

### Google Chrome / Edge / Brave
1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `dhoni-extension` folder.
4. Open any site, click a text box, press **Ctrl+Space**, then type `ami kemon acho`.

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select the `manifest.json` file in this folder.
4. Test the same way. (Temporary add-ons are removed when Firefox restarts;
   permanent install requires signing at addons.mozilla.org.)

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (Chrome + Firefox) |
| `content.js` | Injected into every page; the English/Bangla logic + suggestions |
| `avro-lib.js` | The Avro phonetic engine (MPL-1.1) |
| `dict-bn.js` | ~30k frequency-ranked Bangla words for completions |
| `popup.html` / `popup.js` | Toolbar popup: enable toggle + trigger word |
| `icons/` | Toolbar icons |

## Known limits (prototype)

- **Rich editors** (Google Docs, Slack, Draft.js/ProseMirror-based boxes) may not
  work — they manage their own DOM/canvas. Plain inputs, textareas, and basic
  chat/comment boxes work.
- The trigger is a **word**, so you can't type the literal English word that equals
  your trigger — that's the inherent cost of a word trigger. Use Ctrl+Space as the
  reliable switch.
- Conversion happens at word boundaries (space/Enter/punctuation/blur), so you see
  roman letters until the word is finished.

## Attribution

Transliteration by **jsAvroPhonetic** (Rifat Nabi, OmicronLab), licensed under the
Mozilla Public License 1.1. See the header inside `avro-lib.js`.

Word list from **hermitdave/FrequencyWords** (OpenSubtitles 2018, Bengali), MIT License —
filtered to clean Bangla words, most-frequent-first.
