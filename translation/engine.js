// NekoRPG translation engine
//
// Substitutes Chinese text in the DOM using the fixed table in dictionary.js.
// Upstream source files are never modified, so `git pull upstream main` merges
// cleanly forever. New upstream content simply appears in Chinese until a line
// is added to the dictionary -- nothing breaks.
//
// Console helpers once running:
//   NEKO_TL.missing()  -> untranslated Chinese currently on screen, longest first
//   NEKO_TL.off()      -> pause substitution (shows raw Chinese)
//   NEKO_TL.on()       -> resume
//   NEKO_TL.stats()    -> dictionary size and nodes processed

(function () {
  "use strict";

  var DICT = window.NEKO_DICT || {};
  var keys = Object.keys(DICT).filter(function (k) { return k && DICT[k]; });
  if (!keys.length) { console.warn("[NEKO_TL] dictionary empty or not loaded"); return; }

  // Longest-first: "秘银头盔" must be tried before "秘银", or names get shredded
  // into partial matches. This ordering is the whole correctness argument.
  keys.sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });

  var RE = new RegExp(keys.map(function (k) {
    return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|"), "g");

  var CJK = /[\u4e00-\u9fff]/;

  // The Chinese fast-reject below skips any text node with no CJK, which would
  // silently ignore ASCII dictionary keys. Keep a second pattern for those so
  // the fast path stays cheap without losing them.
  var asciiKeys = keys.filter(function (k) { return !CJK.test(k); });
  var ASCII_RE = asciiKeys.length ? new RegExp(asciiKeys.map(function (k) {
    return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|")) : null;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1 };

  // display.js:1101 does parseInt on .item_count innerText to read stack sizes.
  // Counts are digits so the dictionary cannot match them, but excluding the
  // class outright means a future dictionary entry can never break inventory.
  var SKIP_CLASSES = ["item_count"];

  var processed = 0;

  function shouldSkip(node) {
    for (var el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.isContentEditable) return true;
      if (el.classList) {
        for (var i = 0; i < SKIP_CLASSES.length; i++) {
          if (el.classList.contains(SKIP_CLASSES[i])) return true;
        }
      }
    }
    return false;
  }

  function translateNode(n) {
    var t = n.nodeValue;
    if (!t) return;
    // cheap reject: nothing this dictionary can match
    if (!CJK.test(t) && !(ASCII_RE && ASCII_RE.test(t))) return;
    if (shouldSkip(n)) return;
    var out = t.replace(RE, function (m) { return DICT[m]; });
    if (out !== t) { n.nodeValue = out; processed++; }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateNode(root); return; }
    if (root.nodeType !== 1) return;
    var it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var batch = [], n;
    while ((n = it.nextNode())) batch.push(n);   // collect before mutating
    for (var i = 0; i < batch.length; i++) translateNode(batch[i]);
  }

  var OPTS = { childList: true, subtree: true, characterData: true };
  var observer, queued = false, pending = [];

  // Our own writes would retrigger the observer, so disconnect while mutating.
  // Batching via rAF keeps this cheap even though the game repaints every tick.
  function flush() {
    queued = false;
    observer.disconnect();
    try {
      for (var i = 0; i < pending.length; i++) walk(pending[i]);
      stampBuild();
    } finally {
      pending.length = 0;
      observer.observe(document.body, OPTS);
    }
  }

  observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "characterData") pending.push(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) pending.push(m.addedNodes[j]);
    }
    if (pending.length && !queued) { queued = true; requestAnimationFrame(flush); }
  });

  // Appends window.NEKO_BUILD to the version button (index.html sets it via
  // innerHTML on #changelog_button). Done here rather than by editing
  // game_version.js so no upstream file is touched -- and unlike a dictionary
  // entry keyed to a literal version string, this keeps working after btly0711
  // bumps the upstream version.
  var stamped = false;
  function stampBuild() {
    if (stamped || !window.NEKO_BUILD) return;
    var box = document.getElementById("changelog_button");
    var link = box && box.children[0];
    if (!link) return;
    var base = (link.textContent || "").trim();
    if (!base) return;
    link.textContent = base + "." + window.NEKO_BUILD;
    stamped = true;
  }

  function start() {
    walk(document.body);
    stampBuild();
    observer.observe(document.body, OPTS);

    window.NEKO_TL = {
      off: function () { observer.disconnect(); return "paused"; },
      on: function () { observer.observe(document.body, OPTS); return "running"; },
      stats: function () { return { entries: keys.length, replacements: processed }; },
      missing: function () {
        var it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        var seen = {}, n, runs, i;
        while ((n = it.nextNode())) {
          if (shouldSkip(n)) continue;
          runs = n.nodeValue.match(/[\u4e00-\u9fff]+/g);
          if (runs) for (i = 0; i < runs.length; i++) seen[runs[i]] = (seen[runs[i]] || 0) + 1;
        }
        return Object.keys(seen)
          .sort(function (a, b) { return b.length - a.length || seen[b] - seen[a]; })
          .map(function (k) { return { text: k, seen: seen[k] }; });
      }
    };

    window.addEventListener("load", function () { stampBuild(); walk(document.body); });

    console.log("[NEKO_TL] active -", keys.length, "entries. NEKO_TL.missing() to find gaps.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
