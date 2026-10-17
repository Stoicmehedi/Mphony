#!/usr/bin/env python3
"""Build Mphony's next-word table (next-bn.js) and a cleaned dict-bn.js.

Usage: python3 -I build_next.py EXT_DIR CORPUS_DIR [--wiki-tokens N]

Sources (in CORPUS_DIR):
  bn-subs.txt.gz   OPUS OpenSubtitles 2018, Bangla monolingual (conversational)
  bnwiki.xml.bz2   Bangla Wikipedia articles dump (formal), optional
Scores blend per-corpus conditional probabilities, weighted toward subtitles
so suggestions sound like chat rather than encyclopedia prose.
"""
import bz2, gzip, json, re, sys, collections

EXT, CORPUS = sys.argv[1], sys.argv[2]
WIKI_TOKENS = int(sys.argv[sys.argv.index("--wiki-tokens") + 1]) if "--wiki-tokens" in sys.argv else 40_000_000
TOP_K = 12                     # next words kept per word
MIN_COUNT = 3                  # per-corpus minimum pair count
WEIGHTS = {"subs": 0.7, "wiki": 0.3}

# ---- normalisation: Avro emits precomposed য় ড় ঢ় ----
NUKTA = {"য়": "য়", "ড়": "ড়", "ঢ়": "ঢ়"}
def norm(w):
    for a, b in NUKTA.items():
        w = w.replace(a, b)
    return w.replace("‌", "")

# ---- words never offered as suggestions (user can still type them) ----
BAD_SUBSTR = ["চোদ", "চুদ", "চোদা", "খানকি", "খানকী", "মাগি", "মাগী", "বেশ্যা", "হারামজাদ",
              "হারামি", "হারামী", "শুয়োর", "শুওর", "ভোদা", "পুটকি", "বাইনচ", "বোকাচ"]
BAD_EXACT = {"বাল", "বালের", "বালটা", "বালডা", "ধোন", "গুদ", "পোঁদ", "বাঁড়া", "শালা", "শালার",
             "শালী", "শালি", "হোগা", "কুত্তার", "কুত্তা", "খিচ্চা", "বাস্টার্ড", "বিচ"}
def bad(w):
    return w in BAD_EXACT or any(s in w for s in BAD_SUBSTR)

# ---- dictionary (frequency-ranked) ----
src = open(f"{EXT}/dict-bn.js", encoding="utf8").read()
header = src.split("\n", 1)[0]
words = json.loads(src[src.index("["): src.rindex("]") + 1])
seen, DICT = set(), []
for w in words:
    w = norm(w)
    if w and w not in seen and not bad(w):
        seen.add(w); DICT.append(w)
IDX = {w: i for i, w in enumerate(DICT)}
print(f"dict: {len(words)} -> {len(DICT)} after normalise/dedupe/filter", file=sys.stderr)

# ---- tokenising: a pair counts only if two Bangla words are separated by whitespace alone ----
TOK = re.compile(r"[ঀ-৥ৰ-৿‌‍]+|[^\sঀ-৥ৰ-৿‌‍]+")
BN = re.compile(r"[ঀ-৥ৰ-৿]")
def pairs(line):
    prev = None
    for m in TOK.finditer(line):
        t = m.group()
        if BN.match(t):
            i = IDX.get(norm(t))
            if prev is not None and i is not None:
                yield prev, i
            prev = i
        else:
            prev = None

def count(lines, cap=None):
    c = collections.Counter(); n = 0
    for line in lines:
        for a, b in pairs(line):
            c[a * 100000 + b] += 1
            n += 1
        if cap and n >= cap:
            break
    print(f"  {n:,} pairs, {len(c):,} distinct", file=sys.stderr)
    return c

def subs_lines():
    with gzip.open(f"{CORPUS}/bn-subs.txt.gz", "rt", encoding="utf8", errors="ignore") as f:
        yield from f

WIKI_LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]")
WIKI_TPL = re.compile(r"\{\{[^{}]*\}\}")
WIKI_TAG = re.compile(r"<[^>]+>|&[a-z]+;")
def wiki_lines():
    in_text = False
    with bz2.open(f"{CORPUS}/bnwiki.xml.bz2", "rt", encoding="utf8", errors="ignore") as f:
        for line in f:
            if "<text" in line:
                in_text = True
            if in_text:
                s = line
                for _ in range(3):
                    s = WIKI_TPL.sub(" | ", s)
                s = WIKI_LINK.sub(r"\1", s)
                s = WIKI_TAG.sub(" | ", s)
                if not s.lstrip().startswith(("{", "|", "!", "=", "*[[", "[[")):
                    yield s
            if "</text>" in line:
                in_text = False

corpora = {}
print("subtitles:", file=sys.stderr); corpora["subs"] = count(subs_lines())
try:
    print("wikipedia:", file=sys.stderr); corpora["wiki"] = count(wiki_lines(), WIKI_TOKENS)
except FileNotFoundError:
    print("  (no wiki dump, subtitles only)", file=sys.stderr)

# ---- blend: score(b|a) = sum_c w_c * count_c(a,b) / total_c(a) ----
score = collections.defaultdict(dict)
for name, c in corpora.items():
    tot = collections.Counter()
    for k, v in c.items():
        if v >= MIN_COUNT:
            tot[k // 100000] += v
    for k, v in c.items():
        if v < MIN_COUNT:
            continue
        a, b = divmod(k, 100000)
        score[a][b] = score[a].get(b, 0.0) + WEIGHTS[name] * v / tot[a]

out = []
for a in sorted(score):
    best = sorted(score[a].items(), key=lambda kv: -kv[1])[:TOP_K]
    out.append(f"{a:x}:" + ",".join(f"{b:x}" for b, _ in best))
print(f"next-word table: {len(out):,} words", file=sys.stderr)

# ---- write ----
with open(f"{EXT}/dict-bn.js", "w", encoding="utf8") as f:
    f.write(header + "\n")
    f.write("var DHONI_DICT = " + json.dumps(DICT, ensure_ascii=False, separators=(",", ":")) + ";\n")
with open(f"{EXT}/next-bn.js", "w", encoding="utf8") as f:
    f.write("/* Next-word table: \"wordIndex:next1,next2,...\" (hex indexes into DHONI_DICT), best first.\n"
            "   Built from OPUS OpenSubtitles 2018 (bn) and Bangla Wikipedia (CC BY-SA 4.0) word-pair counts. */\n")
    f.write("var DHONI_NEXT = " + json.dumps("|".join(out)) + ";\n")
