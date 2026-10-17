// node peek.js OUTDIR word...  — show next-word suggestions from a built table
const fs = require("fs"), vm = require("vm"), dir = process.argv[2], ctx = {};
vm.runInNewContext(fs.readFileSync(dir + "/dict-bn.js", "utf8") + fs.readFileSync(dir + "/next-bn.js", "utf8"), ctx);
const D = ctx.DHONI_DICT, M = {};
for (const e of ctx.DHONI_NEXT.split("|")) { const [a, r] = e.split(":"); M[D[parseInt(a, 16)]] = r.split(",").map((x) => D[parseInt(x, 16)]); }
const norm = (w) => w.replace(/\u09AF\u09BC/g, "\u09DF").replace(/\u09A1\u09BC/g, "\u09DC").replace(/\u09A2\u09BC/g, "\u09DD");
for (const w0 of process.argv.slice(3)) { const w = norm(w0); console.log(w.padEnd(10), "→", (M[w] || ["(none)"]).slice(0, 7).join("  ")); }
