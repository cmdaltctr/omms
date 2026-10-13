"""Build the AI-draft confirm page for the 140 test cases."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP05 = HERE.parent / "05-retrieval-qwen-label-decisions-2026-10-10"
EXP05_PIN = "3b58ff46edf2d3e5fbb93a524f0dbbcd158ce4c984961cceb1331f67a90b241d"
CORPUS_PINS = {
    "corpus/ground-truth.json": "8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c",
    "corpus/catalogue.json": "3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc",
    "corpus/candidates.json": "c783b5522d44e33c86c1b6969790118b875c35f3c6d96c21bbbe151c4c7d9560",
    "corpus/test-manifest.json": "9572035106415d4c60d608c7948185fa08b030c18c79fa386f53f2935b8bbefd",
}

if hashlib.file_digest(EXP05.joinpath("run_eval.py").open("rb"), "sha256").hexdigest() != EXP05_PIN:
    raise ValueError("input_hash_drift")
_spec = importlib.util.spec_from_file_location("experiment05_readonly", EXP05 / "run_eval.py")
b = importlib.util.module_from_spec(_spec)
_previous = sys.dont_write_bytecode
sys.dont_write_bytecode = True
try:
    _spec.loader.exec_module(b)
finally:
    sys.dont_write_bytecode = _previous

STORAGE_KEY = "omms-experiment-10-confirm"
FORBIDDEN_KEYS = ("expected", "reference", "choice", "answer", "baseline", "classifier")
SPECIAL = {"none_fit", "uncertain"}


def page_data():
    """Blind case list: description, section and every same-section option."""
    for name, expected in CORPUS_PINS.items():
        b.require(b.file_hash(b.path_in(b.SOURCE, name)) == expected, "input_hash_drift")
    refs = b.read_json(b.path_in(b.SOURCE, "corpus/ground-truth.json"))
    catalogue = b.read_json(b.path_in(b.SOURCE, "corpus/catalogue.json"))
    cases = [c for c in refs if c["split"] == "test"]
    b.require(len(cases) == 140, "split_shape")
    blind = []
    for case in cases:
        options = [{"id": l["id"], "definition": l["definition"], "aliases": l.get("aliases", [])}
                   for l in catalogue if l["section"] == case["section"]]
        b.require(len(options) in (19, 22), "section_shape")
        blind.append({"id": case["id"], "description": case["description"],
                      "section": case["section"], "options": options})
    return blind


def draft_data(data):
    """Load the agent draft and validate it against the blind case list."""
    path = b.path_in(HERE, "corpus/agent-draft-decisions.json")
    if not path.exists():
        return {}
    entries = b.read_json(path).get("answers")
    b.require(isinstance(entries, list) and len(entries) == len(data), "draft_shape")
    draft = {}
    for entry in entries:
        b.require(isinstance(entry, dict) and set(entry) <= {"key", "label", "note"},
                  "draft_shape")
        b.require(entry.get("key") not in draft, "draft_duplicate_case")
        note = entry.get("note", "")
        b.require(not note or (isinstance(note, str) and len(note) <= 200), "draft_note")
        draft[entry["key"]] = {"label": entry.get("label"), "note": note}
    case_map = {c["id"]: c for c in data}
    b.require(set(draft) == set(case_map), "draft_selection")
    for key, item in draft.items():
        valid = {o["id"] for o in case_map[key]["options"]} | SPECIAL
        b.require(item["label"] in valid, "draft_invalid_choice")
    return draft


def verdicts_data():
    path = b.path_in(HERE, "corpus/agent-judge-verdicts.json")
    if not path.exists():
        return {}
    entries = b.read_json(path).get("verdicts")
    b.require(isinstance(entries, list), "verdicts_shape")
    verdicts = {}
    for entry in entries:
        b.require(isinstance(entry, dict) and set(entry) <= {"key", "judge", "agree", "note"},
                  "verdicts_shape")
        b.require(entry.get("key") not in verdicts, "verdicts_duplicate_case")
        verdicts[entry["key"]] = {"judge": entry.get("judge"), "agree": entry.get("agree")}
    return verdicts


def response_data():
    path = b.path_in(HERE, "corpus/agent-draft-response.json")
    if not path.exists():
        return {}
    entries = b.read_json(path).get("responses")
    b.require(isinstance(entries, list), "response_shape")
    responses = {}
    for entry in entries:
        b.require(isinstance(entry, dict) and set(entry) <= {"key", "draft", "judge", "final",
                                                             "position", "note"}, "response_shape")
        b.require(entry.get("key") not in responses, "response_duplicate_case")
        responses[entry["key"]] = {"final": entry.get("final"), "position": entry.get("position"),
                                   "note": entry.get("note", "")}
    return responses


def consensus(data, draft, verdicts, responses):
    """Post-reconsideration label per case, with an agreement badge."""
    if not verdicts:
        return {}
    b.require(set(verdicts) == {c["id"] for c in data}, "verdicts_selection")
    result = {}
    for case in data:
        key = case["id"]
        valid = {o["id"] for o in case["options"]} | SPECIAL
        verdict = verdicts[key]
        b.require(verdict["judge"] in valid, "verdicts_invalid_choice")
        labels_agree = key in draft and draft[key]["label"] == verdict["judge"]
        b.require(verdict["agree"] == labels_agree, "verdict_flag_inconsistent")
        if key in responses:
            response = responses[key]
            b.require(response["final"] in valid, "response_invalid_choice")
            b.require(response["position"] in ("keep", "concede", "other"), "response_position")
            settled = response["final"] == verdict["judge"]
            result[key] = {"label": response["final"], "status": "settled" if settled else "disputed"}
        elif labels_agree:
            result[key] = {"label": verdict["judge"], "status": "agreed"}
        else:
            raise ValueError("missing_response_for_disputed_case")
    return result


def build():
    data = page_data()
    draft = draft_data(data)
    verdicts = verdicts_data()
    responses = response_data()
    consensus_map = consensus(data, draft, verdicts, responses)
    display = consensus_map or {c["id"]: {"label": (draft.get(c["id"]) or {}).get("label"),
                                          "status": "draft"} for c in data}
    serialised = json.dumps([data, draft, verdicts, responses, display], ensure_ascii=False)
    for key in FORBIDDEN_KEYS:
        b.require(f'"{key}"' not in serialised, "blindness_leak")
    html = (HTML.replace("__CASES__", json.dumps(data, ensure_ascii=False))
            .replace("__DRAFT__", json.dumps(display, ensure_ascii=False))
            .replace("__DRAFT_DETAIL__", json.dumps(
                {key: {"draft": (draft.get(key) or {}).get("label"),
                       "note": (draft.get(key) or {}).get("note", ""),
                       "judge": verdicts.get(key, {}).get("judge"),
                       "position": (responses.get(key) or {}).get("position"),
                       "response_note": (responses.get(key) or {}).get("note", "")}
                 for key in display}, ensure_ascii=False))
            .replace("__STORAGE_KEY__", STORAGE_KEY))
    output = b.path_in(HERE, "output")
    output.mkdir(parents=True, exist_ok=True)
    (output / "adjudication.html").write_text(html)
    badges = {status: sum(1 for v in display.values() if v["status"] == status)
              for status in ("agreed", "settled", "disputed", "draft")}
    print(f"Built output/adjudication.html: {len(data)} cases, badges {badges}, "
          f"sha256 {hashlib.sha256(html.encode()).hexdigest()[:16]}…", flush=True)


HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Experiment 10: confirm the label reference</title>
<style>
  :root { --ink:#1c2333; --muted:#6b7385; --line:#d9dde8; --bg:#f4f5f9; --card:#fff;
          --accent:#0f6b5c; --chip:#eef1f7; --ok:#177245; --warn:#8a6d1a; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.55 -apple-system, "Segoe UI", sans-serif; color:var(--ink);
         background:var(--bg); }
  header { position:sticky; top:0; z-index:10; background:var(--card); border-bottom:1px solid var(--line);
           padding:10px 16px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0 12px 0 0; }
  #progress { font-weight:700; background:var(--chip); border-radius:999px; padding:4px 12px; }
  #progress.done { background:#d9f2e4; color:var(--ok); }
  header button { font:inherit; padding:6px 12px; border:1px solid var(--line); border-radius:8px;
                  background:var(--card); cursor:pointer; }
  header button:hover { border-color:var(--accent); }
  #filter { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:8px;
            background:var(--card); }
  main { max-width:940px; margin:0 auto; padding:16px; }
  .intro { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px;
           margin-bottom:14px; }
  details.case { background:var(--card); border:1px solid var(--line); border-radius:10px;
                 margin-bottom:10px; overflow:hidden; }
  details.case[open] { border-color:var(--accent); }
  details.case > summary { display:flex; gap:10px; align-items:center; padding:10px 14px; cursor:pointer;
                           list-style:none; }
  details.case > summary::-webkit-details-marker { display:none; }
  .case-id { font-family:ui-monospace, monospace; font-size:13px; color:var(--muted); }
  .status { margin-left:auto; font-size:13px; color:var(--muted); }
  .status.done { color:var(--ok); font-weight:600; }
  .status.pending { color:var(--warn); }
  .status.disputed { color:#a03a26; font-weight:700; }
  .body { padding:4px 14px 14px; border-top:1px solid var(--line); }
  .description { font-size:16px; margin:10px 0 6px; }
  .section-chip { display:inline-block; background:var(--chip); border-radius:999px; padding:2px 10px;
                  font-size:12px; color:var(--muted); margin-bottom:6px; }
  .draft-box { background:#faf6ea; border:1px dashed #d8c99a; border-radius:8px; padding:8px 10px;
               margin:0 0 10px; font-size:13.5px; color:var(--warn); }
  .draft-box.agreed, .draft-box.settled { background:#eef8f1; border:1px solid #a9d8bd;
                                          color:#1c5c3f; }
  .draft-box.disputed { background:#fdf0ee; border:1px solid #e0b3aa; color:#8a3a2a; }
  .draft-box b { font-family:ui-monospace, monospace; font-size:12.5px; }
  label.opt { display:flex; gap:10px; align-items:flex-start; border:1px solid var(--line);
              border-radius:8px; padding:8px 10px; margin:6px 0; cursor:pointer; }
  label.opt:hover { border-color:var(--accent); }
  label.opt.selected { border-color:var(--accent); background:#eaf4f1; }
  label.opt.drafted { border-style:dashed; }
  .opt .id { font-weight:600; font-size:13.5px; }
  .opt .def { color:var(--muted); font-size:13.5px; }
  .special { border-style:dotted; }
  .note { width:100%; margin-top:8px; font:inherit; padding:8px; border:1px solid var(--line);
          border-radius:8px; }
  .actions { display:flex; gap:10px; align-items:center; margin-top:8px; }
  .confirm { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 14px;
             font:inherit; font-weight:600; cursor:pointer; }
  .confirm[disabled] { background:#9dbbb3; cursor:default; }
  .clear { color:var(--muted); font-size:13px; cursor:pointer; text-decoration:underline;
           background:none; border:none; padding:4px 0; }
</style>
</head>
<body>
<header>
  <h1>Confirm the label reference</h1>
  <span id="progress"></span>
  <select id="filter">
    <option value="all">All cases</option>
    <option value="disputed">Disputed first</option>
    <option value="label">Pre-selections with a label</option>
    <option value="none_fit">Pre-selections: none_fit</option>
    <option value="todo">Unconfirmed only</option>
  </select>
  <button id="next">Next unconfirmed</button>
  <button id="collapse">Collapse all</button>
  <button id="download">Download JSON</button>
</header>
<main>
  <div class="intro">
    Two independent AI passes drafted every label from the definitions alone; neither saw the old
    reference or the classifier's answers, and a reconsideration round resolved most of their
    disagreements. Green boxes: both agents now agree (one-click confirm). Red boxes: still
    disputed — read both positions and decide. Confirm, pick a different option (including
    <strong>none_fit</strong> or <strong>uncertain</strong>), and note anything worth recording.
    A case counts as done only once you confirm or change it. Answers autosave in this browser;
    download the JSON when all 140 are done. Start with the <strong>Disputed first</strong> filter.
  </div>
  <div id="cases"></div>
</main>
<script>
const CASES = __CASES__;
const DRAFT = __DRAFT__;
const DETAIL = __DRAFT_DETAIL__;
const KEY = "__STORAGE_KEY__";
let answers = {};
try { answers = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
try { localStorage.setItem(KEY, JSON.stringify(answers)); }
catch (e) { document.querySelector(".intro").insertAdjacentHTML("beforeend",
  "<p><strong>Autosave unavailable: download often.</strong></p>"); }

const casesEl = document.getElementById("cases");
for (const c of CASES) {
  const current = DRAFT[c.id] || null;
  const det = document.createElement("details");
  det.className = "case"; det.id = "case-" + c.id;
  const sum = document.createElement("summary");
  sum.innerHTML = '<span class="case-id">' + c.id + '</span><span class="status"></span>';
  det.appendChild(sum);
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = '<div class="section-chip">' + c.section + '</div>' +
    '<div class="description"></div>';
  body.querySelector(".description").textContent = c.description;
  if (current) {
    const box = document.createElement("div");
    box.className = "draft-box " + current.status;
    const strong = document.createElement("strong");
    const detail = DETAIL[c.id] || {};
    if (current.status === "agreed") strong.textContent = "Two agents agree: ";
    else if (current.status === "settled") strong.textContent = "Disputed, then resolved: ";
    else if (current.status === "disputed") strong.textContent = "Still disputed — your call: ";
    else strong.textContent = "AI draft: ";
    box.appendChild(strong);
    const id = document.createElement("b"); id.textContent = current.label;
    box.appendChild(id);
    let line = "";
    if (current.status === "settled" || current.status === "disputed")
      line = "  (draft: " + (detail.draft || "?") + " · judge: " + (detail.judge || "?") + ")";
    if (detail.note && current.status !== "settled" && current.status !== "disputed")
      line = " — " + detail.note;
    if (detail.response_note && (current.status === "settled" || current.status === "disputed"))
      line += " — " + detail.response_note;
    if (line) box.appendChild(document.createTextNode(line));
    body.appendChild(box);
  }
  const options = c.options.map(o => ({...o, special: false}))
    .concat([{id: "none_fit", definition: "No suitable existing label.", aliases: [], special: true},
             {id: "uncertain", definition: "Two or more labels genuinely tie; cannot decide.",
              aliases: [], special: true}]);
  for (const opt of options) {
    const lab = document.createElement("label");
    lab.className = "opt" + (opt.special ? " special" : "");
    const input = document.createElement("input");
    input.type = "radio"; input.name = c.id; input.value = opt.id;
    input.addEventListener("change", () => select(c.id, opt.id));
    lab.appendChild(input);
    const text = document.createElement("div");
    const idEl = document.createElement("div");
    idEl.className = "id"; idEl.textContent = opt.id;
    const defEl = document.createElement("div");
    defEl.className = "def";
    defEl.textContent = opt.definition +
      (opt.aliases && opt.aliases.length ? " (aliases: " + opt.aliases.join("; ") + ")" : "");
    text.appendChild(idEl); text.appendChild(defEl);
    lab.appendChild(text);
    if (current && current.label === opt.id) lab.classList.add("drafted");
    body.appendChild(lab);
  }
  const note = document.createElement("input");
  note.className = "note"; note.placeholder = "Your optional note";
  note.value = (answers[c.id] && answers[c.id].note) || "";
  note.addEventListener("input", () => {
    answers[c.id] = answers[c.id] || {label: null, confirmed: false};
    answers[c.id].note = note.value; save();
  });
  body.appendChild(note);
  const actions = document.createElement("div");
  actions.className = "actions";
  const confirm = document.createElement("button");
  confirm.className = "confirm"; confirm.textContent = "Confirm draft";
  confirm.addEventListener("click", () => {
    const label = (answers[c.id] && answers[c.id].label)
      || (DRAFT[c.id] ? DRAFT[c.id].label : null)
      || null;
    if (label) select(c.id, label);
  });
  actions.appendChild(confirm);
  const clear = document.createElement("button");
  clear.className = "clear"; clear.textContent = "Reset to unconfirmed";
  clear.addEventListener("click", () => select(c.id, null));
  actions.appendChild(clear);
  body.appendChild(actions);
  det.appendChild(body);
  det.addEventListener("toggle", () => { if (det.open) oneOpen(det); });
  casesEl.appendChild(det);
}

function oneOpen(me) {
  for (const d of document.querySelectorAll("details.case[open]"))
    if (d !== me) d.open = false;
}
function select(caseId, label) {
  if (label === null) {
    answers[caseId] = {label: null, confirmed: false, note: (answers[caseId] || {}).note || ""};
  } else {
    answers[caseId] = Object.assign({label: null, confirmed: false, note: ""},
                                    answers[caseId] || {}, {label: label, confirmed: true});
  }
  save(); refresh();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch (e) {} }
function done(id) { return answers[id] && answers[id].confirmed && answers[id].label; }
function shown(id) {
  if (done(id)) return answers[id].label;
  return (DRAFT[id] && DRAFT[id].label) || null;
}
function refresh() {
  let completed = 0;
  for (const c of CASES) {
    if (done(c.id)) completed++;
    const det = document.getElementById("case-" + c.id);
    const status = det.querySelector(".status");
    if (done(c.id)) { status.textContent = "✓ confirmed: " + answers[c.id].label;
                      status.className = "status done"; }
    else if (DRAFT[c.id] && DRAFT[c.id].status === "agreed")
      { status.textContent = "two agents agree — pending"; status.className = "status pending"; }
    else if (DRAFT[c.id] && DRAFT[c.id].status === "settled")
      { status.textContent = "settled after dispute — pending"; status.className = "status pending"; }
    else if (DRAFT[c.id] && DRAFT[c.id].status === "disputed")
      { status.textContent = "DISPUTED — needs you"; status.className = "status disputed"; }
    else { status.textContent = "unreviewed"; status.className = "status"; }
    const active = shown(c.id);
    for (const input of det.querySelectorAll("input[type=radio]"))
      input.checked = active === input.value;
    for (const lab of det.querySelectorAll("label.opt")) {
      lab.classList.toggle("selected", !!done(c.id) && answers[c.id].label === lab.querySelector("input").value);
    }
    const confirmBtn = det.querySelector(".confirm");
    if (confirmBtn) confirmBtn.disabled = !!done(c.id);
  }
  const pill = document.getElementById("progress");
  pill.textContent = "Confirmed " + completed + " / " + CASES.length;
  pill.className = completed === CASES.length ? "done" : "";
}
document.getElementById("filter").addEventListener("change", applyFilter);
function applyFilter() {
  const mode = document.getElementById("filter").value;
  for (const c of CASES) {
    const det = document.getElementById("case-" + c.id);
    const entry = DRAFT[c.id] || {};
    let show = true;
    if (mode === "label") show = entry && !["none_fit", "uncertain"].includes(entry.label);
    else if (mode === "none_fit") show = entry && entry.label === "none_fit";
    else if (mode === "disputed") show = entry && entry.status === "disputed";
    else if (mode === "todo") show = !done(c.id);
    det.style.display = show ? "" : "none";
  }
}
document.getElementById("collapse").addEventListener("click", () => {
  for (const d of document.querySelectorAll("details.case")) d.open = false;
});
document.getElementById("next").addEventListener("click", () => {
  const visible = CASES.filter(c => document.getElementById("case-" + c.id).style.display !== "none");
  const next = visible.find(c => !done(c.id)) || visible[0] || CASES[0];
  const det = document.getElementById("case-" + next.id);
  det.open = true; det.scrollIntoView({behavior: "smooth", block: "start"});
});
document.getElementById("download").addEventListener("click", () => {
  const confirmed = CASES.filter(c => done(c.id));
  if (confirmed.length < CASES.length)
    alert("Only confirmed cases are included: " + confirmed.length + " of " + CASES.length +
          ". Finish the rest before handing this file over.");
  const blob = new Blob([JSON.stringify({answers: confirmed.map(c => ({
    key: c.id, label: answers[c.id].label, note: (answers[c.id] && answers[c.id].note) || ""}))},
    null, 2)], {type: "application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "adjudication-download.json"; a.click();
  URL.revokeObjectURL(a.href);
});
refresh();
applyFilter();
document.getElementById("next").click();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
