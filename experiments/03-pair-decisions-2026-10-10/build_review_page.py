"""Build the self-contained local page for blind pair review."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manifest import digest
from safety import output_path, require_redacted

FIELDS = ("id", "decision", "A", "B", "outcome", "reason")

# The page shows one pair at a time and keeps all state in the browser.
# No external assets, no network requests, and no score or model data.
PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="corpus-hash" content="__CORPUS_HASH__">
<title>Blind pair review</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 44rem; padding: 1rem; }
blockquote { border-left: 4px solid #8884; margin: 0.4rem 0; padding: 0.4rem 1rem; white-space: pre-wrap; }
#choices button { display: block; width: 100%; margin: 0.3rem 0; padding: 0.6rem; font: inherit; text-align: left; }
#choices .selected { border: 2px solid seagreen; font-weight: 600; }
textarea { width: 100%; box-sizing: border-box; font: inherit; }
label { display: block; margin-top: 0.8rem; }
footer button { font: inherit; padding: 0.5rem 0.9rem; margin: 0.4rem 0.4rem 0 0; }
#warning { color: crimson; margin-bottom: 0.4rem; }
.note, #notice { color: #666; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
<h1>Blind pair review</h1>
<p id="counter"></p>
<p id="notice" hidden></p>
<h2 id="kind"></h2>
<p class="label"><strong>A</strong></p>
<blockquote id="text-a"></blockquote>
<p class="label"><strong>B</strong></p>
<blockquote id="text-b"></blockquote>
<div id="choices"></div>
<label for="reason">Reason (required once you choose an outcome)</label>
<textarea id="reason" rows="3"></textarea>
<p id="warning" hidden></p>
<footer>
<button id="prev" type="button">Previous</button>
<button id="next" type="button">Next</button>
<button id="jump" type="button">Jump to first unreviewed</button>
<button id="export" type="button">Export review-export.json</button>
</footer>
<p class="note">This page runs locally in your browser and sends nothing anywhere. Progress is kept only in this browser. Keys: 1, 2 and 3 pick an outcome; the left and right arrow keys move between pairs.</p>
</main>
<script type="application/json" id="pair-data">__PAIR_DATA__</script>
<script>
(function () {
  "use strict";
  var PAIRS = JSON.parse(document.getElementById("pair-data").textContent);
  var HASH = document.querySelector('meta[name="corpus-hash"]').content;
  // One key per pair list, so review pages opened in the same browser never touch each other's progress.
  var KEY = "omms-blind-review-progress:" + HASH;
  var OUTCOMES = {
    duplicate: [["same", "Same meaning"], ["different", "Different meaning"], ["uncertain", "Unsure"]],
    conflict: [["contradict", "Contradictory"], ["compatible", "Compatible"], ["uncertain", "Unsure"]]
  };
  var HEADINGS = { duplicate: "Duplicate check", conflict: "Conflict check" };
  var answers = {};
  var index = 0;

  function answer(id) {
    return answers[id] || { outcome: "", reason: "" };
  }

  function reviewed(id) {
    var current = answer(id);
    return current.outcome !== "" && current.reason.trim() !== "";
  }

  function countReviewed() {
    return PAIRS.filter(function (pair) { return reviewed(pair.id); }).length;
  }

  function notice(text) {
    var element = document.getElementById("notice");
    element.textContent = text;
    element.hidden = false;
  }

  function loadProgress() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (error) {
      saved = null;
    }
    if (!saved || typeof saved !== "object") {
      return;
    }
    if (saved.hash !== HASH) {
      // Refuse progress recorded against a different pair list, but keep it stored.
      notice("Stored progress ignored: the pair list has changed.");
      return;
    }
    answers = saved.answers || {};
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ hash: HASH, answers: answers }));
  }

  function warn() {
    var element = document.getElementById("warning");
    var current = answer(PAIRS[index].id);
    var text = "";
    if (current.outcome !== "" && current.reason.trim() === "") {
      text = "A reason is required once you choose an outcome.";
    } else if (current.outcome === "" && current.reason.trim() !== "") {
      text = "Pick an outcome to go with this reason.";
    }
    element.textContent = text;
    element.hidden = text === "";
  }

  function choose(outcome) {
    var id = PAIRS[index].id;
    answers[id] = { outcome: outcome, reason: answer(id).reason };
    save();
    render();
  }

  function render() {
    var pair = PAIRS[index];
    var current = answer(pair.id);
    document.getElementById("kind").textContent = HEADINGS[pair.decision];
    document.getElementById("text-a").textContent = pair.A;
    document.getElementById("text-b").textContent = pair.B;
    document.getElementById("counter").textContent =
      "Pair " + (index + 1) + " of " + PAIRS.length + " | reviewed " + countReviewed() + "/" + PAIRS.length;
    var choices = document.getElementById("choices");
    choices.textContent = "";
    OUTCOMES[pair.decision].forEach(function (option, position) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = (position + 1) + ". " + option[1];
      if (current.outcome === option[0]) {
        button.className = "selected";
      }
      button.addEventListener("click", function () { choose(option[0]); });
      choices.appendChild(button);
    });
    document.getElementById("reason").value = current.reason;
    warn();
  }

  function move(step) {
    index = Math.min(Math.max(index + step, 0), PAIRS.length - 1);
    render();
  }

  function jump() {
    for (var position = 0; position < PAIRS.length; position += 1) {
      if (!reviewed(PAIRS[position].id)) {
        index = position;
        render();
        return;
      }
    }
    notice("Every pair is reviewed.");
  }

  function exportAll() {
    var records = PAIRS.map(function (pair) {
      var current = answer(pair.id);
      return { id: pair.id, decision: pair.decision, A: pair.A, B: pair.B,
               outcome: current.outcome, reason: current.reason };
    });
    var blob = new Blob([JSON.stringify(records, null, 2) + "\\n"], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "review-export.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    var missing = PAIRS.length - countReviewed();
    if (missing > 0) {
      notice(missing + " pair(s) are not fully reviewed yet; the export keeps their fields empty.");
    }
  }

  document.getElementById("reason").addEventListener("input", function (event) {
    var id = PAIRS[index].id;
    answers[id] = { outcome: answer(id).outcome, reason: event.target.value };
    save();
    warn();
  });
  document.getElementById("prev").addEventListener("click", function () { move(-1); });
  document.getElementById("next").addEventListener("click", function () { move(1); });
  document.getElementById("jump").addEventListener("click", jump);
  document.getElementById("export").addEventListener("click", exportAll);

  document.addEventListener("keydown", function (event) {
    // Leave the keyboard alone while the reviewer types a reason.
    if (event.target && event.target.id === "reason") {
      return;
    }
    if (event.key === "ArrowLeft") {
      move(-1);
    } else if (event.key === "ArrowRight") {
      move(1);
    } else if (event.key === "1" || event.key === "2" || event.key === "3") {
      var option = OUTCOMES[PAIRS[index].decision][Number(event.key) - 1];
      if (option) {
        choose(option[0]);
      }
    }
  });

  loadProgress();
  index = PAIRS.length - 1;
  for (var position = 0; position < PAIRS.length; position += 1) {
    if (!reviewed(PAIRS[position].id)) {
      index = position;
      break;
    }
  }
  render();
})();
</script>
</body>
</html>
"""


def load_review(path: Path) -> list:
    """Read the corpus and refuse records that could break the page."""
    records = json.loads(path.read_text())
    if not isinstance(records, list) or not records:
        raise ValueError("review corpus must be a non-empty JSON array")
    for record in records:
        if not isinstance(record, dict) or not all(field in record for field in FIELDS):
            raise ValueError("missing record keys")
        if not isinstance(record["id"], str) or not record["id"]:
            raise ValueError("non-empty record id required")
        if record["decision"] not in ("duplicate", "conflict"):
            raise ValueError("unknown decision")
        if not all(isinstance(record[field], str) for field in ("A", "B", "outcome", "reason")):
            raise ValueError("record text must be strings")
    return records


def build_page(review: Path, out: Path, root: Path) -> int:
    """Write one self-contained HTML page and return the pair count."""
    records = load_review(review)
    target = output_path(out, root)
    data = json.dumps(records)
    # Refuse corpus text the redaction pass would still change.
    require_redacted(data)
    corpus_hash = digest(records)
    # Encode "<" as a JSON escape so pair text cannot open or close markup.
    page = PAGE.replace("__PAIR_DATA__", data.replace("<", "\\u003c")).replace("__CORPUS_HASH__", corpus_hash)
    temporary = output_path(target.with_suffix(target.suffix + ".tmp"), root)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as stream:
        stream.write(page)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(target)
    return len(records)


def main():
    default = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, default=default / "corpus/blind-review.json")
    parser.add_argument("--out", type=Path, default=default / "corpus/review.html")
    args = parser.parse_args()
    try:
        # The corpus and the page both stay inside the experiment directory.
        count = build_page(args.review, args.out, default)
    except (ValueError, OSError, TypeError) as error:
        parser.exit(1, f"review page build failed: {error}\n")
    print(json.dumps({"status": "built", "pairs": count}), flush=True)


if __name__ == "__main__":
    main()
