# Mphony — Banglish → Bangla browser extension

By **Md Mehedi Hasan** · stoicmehedi@gmail.com

Type English by default in any text box. Press **Ctrl + Space** to switch the site
to **Bangla** (Avro phonetic); press it again to switch back to English. A word
suggestion dropdown appears while you type in Bangla, and predicts the next word
after you finish one.

Works in `<input>`, `<textarea>`, and `contenteditable` boxes (incl. WhatsApp/YouTube).

## How it works

- Default mode is **English** — keystrokes pass through untouched.
- **Ctrl + Space** (changeable) toggles the site between English and Bangla (a small
  badge shows the current mode, and flashes when you enter a box in Bangla mode).
- In Bangla mode, each word is transliterated with the **OmicronLab Avro Phonetic**
  engine (`avro-lib.js`, jsAvroPhonetic by Rifat Nabi, MPL-1.1) when you press
  space / Enter / punctuation, or when you leave the field.
- **Suggestions**: while typing a word, completions ranked by your own words, then
  what usually follows the previous word, then overall frequency. After a word,
  next-word predictions from your own habits, a few hand-picked chat replies, then
  a word-pair table built from Bangla subtitles and Wikipedia (`next-bn.js`).
- **Learning**: words you commit in Bangla mode are counted in `storage.local`
  (this browser only; never synced or sent; not in incognito). A word is suggested
  after you've used it twice. Turn off or clear it from the popup.
- The whole extension can be toggled off from the toolbar popup.

## Load it (unpacked, for development)

### Google Chrome / Edge / Brave
1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `dhoni-extension` folder.
4. Open any site, click a text box, press **Ctrl+Space** (change it in `chrome://extensions/shortcuts`), then type `ami kemon acho`.
   The mode is remembered per website: new tabs and reloads of that site open in the last mode you used there (other sites are unaffected).

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
| `dict-bn.js` | ~29k frequency-ranked Bangla words for completions |
| `next-bn.js` | Next-word table (word-pair counts, indexes into `dict-bn.js`) |
| `background.js` | Relays the toggle shortcut to the page |
| `popup.html` / `popup.js` | Toolbar popup: enable, learning, shortcut, debug |
| `icons/` | Toolbar icons |

## Known limits (prototype)

- **Rich editors** (Google Docs, Slack, Draft.js/ProseMirror-based boxes) may not
  work — they manage their own DOM/canvas. Plain inputs, textareas, and basic
  chat/comment boxes work.
- Conversion happens at word boundaries (space/Enter/punctuation/blur), so you see
  roman letters until the word is finished.

## Attribution

Transliteration by **jsAvroPhonetic** (Rifat Nabi, OmicronLab), licensed under the
Mozilla Public License 1.1. See the header inside `avro-lib.js`.

Word list from **hermitdave/FrequencyWords** (OpenSubtitles 2018, Bengali), MIT License —
filtered to clean Bangla words, most-frequent-first.

Next-word table derived from word-pair counts in **OPUS OpenSubtitles 2018** (Bengali
monolingual; P. Lison and J. Tiedemann, 2016, *OpenSubtitles2016: Extracting Large
Parallel Corpora from Movie and TV Subtitles*, LREC) and **Bangla Wikipedia**
(text CC BY-SA 4.0, Wikimedia Foundation). Only counts are kept, no text.

## Rebuilding the next-word table

`tools/build_next.py` rebuilds `next-bn.js` (and re-normalises `dict-bn.js`) from
`bn-subs.txt.gz` (https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/mono/bn.txt.gz)
and `bnwiki.xml.bz2` (https://dumps.wikimedia.org/bnwiki/latest/bnwiki-latest-pages-articles.xml.bz2)
placed in a corpus folder: `python3 -I tools/build_next.py . /path/to/corpus` (~4 min).
`node tools/peek.js . আমি শুভ` prints the suggestions for some words.
