"""Build the approved supplemental challenge cases for separate blind review.

The production snapshot cannot supply conflict positives (every conflict-band
pair is already selected and none sits at cosine 0.9 or above), so the user
approved a clearly-marked synthetic challenge set: 20 clear duplicates,
20 related-but-distinct facts, 24 genuine contradictions and 16 compatible
preferences. The intended outcome is recorded beside each case for a design
diagnostic only; the blind reviewer's outcome is the ground truth. Challenge
cases carry no centroids or cosine scores, never join the production-band
benchmark or its gates, and are reported as a separate diagnostic. No model
call is made.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from checkpoint import atomic_json
from pairs import blind_review
from safety import output_path, require_redacted

# Each case: (A, B, intended outcome). The reviewer never sees the intent.
DUPLICATES = [
    ("Prefer using the terminal for all Git operations.", "Use the command line instead of a graphical client when working with Git."),
    ("Always run the full test suite before pushing changes.", "Never push without first running the complete test suite."),
    ("Write commit messages in the imperative mood.", "Commit messages should use imperative wording."),
    ("Prefer small pull requests that review quickly.", "Keep pull requests small so they can be reviewed fast."),
    ("Use TypeScript strict mode in every new project.", "Enable strict TypeScript settings for all new projects."),
    ("Keep functions under forty lines where possible.", "Functions should stay short, ideally below forty lines."),
    ("Prefer dark theme in editors and terminals.", "Use dark colour schemes for the editor and the terminal."),
    ("Always cite the documentation version when quoting API behaviour.", "When quoting API behaviour, reference the documentation version used."),
    ("Prefer native OS keyboard shortcuts over in-app remapping.", "Use the operating system's keyboard shortcuts instead of remapping them inside apps."),
    ("Run database migrations in a transaction when the engine supports it.", "When the database engine allows it, wrap migrations in a transaction."),
    ("Prefer explicit type annotations on public function signatures.", "Public functions should have their parameter and return types written out."),
    ("Cache expensive build artefacts between pipeline runs.", "Reuse costly build artefacts across pipeline runs instead of rebuilding."),
    ("Write release notes in plain British English.", "Release notes should use plain British English."),
    ("Prefer reading error messages fully before searching the web.", "Read the entire error message before turning to web search."),
    ("Delete feature branches immediately after merge.", "Once a branch is merged, remove it straight away."),
    ("Prefer adding tests alongside each bug fix.", "Every bug fix should arrive together with a test covering it."),
    ("Use a single linter configuration per repository.", "Each repository should keep exactly one linter configuration."),
    ("Prefer scheduled focused work sessions over open-ended ones.", "Work in planned, time-boxed sessions rather than open-ended ones."),
    ("Keep dependency updates separate from feature changes.", "Dependency bumps belong in their own changes, away from feature work."),
    ("Prefer screenshots with annotated callouts in bug reports.", "Bug reports are clearer with screenshots that mark the problem."),
]

RELATED_BUT_DISTINCT = [
    ("Prefer using the terminal for Git operations.", "Prefer using the terminal for Git operations, except for interactive rebase, where a graphical client is clearer."),
    ("Always run the full test suite before pushing changes.", "Always run the unit tests before pushing changes; the full suite runs nightly."),
    ("Write commit messages in the imperative mood.", "Write commit messages in the imperative mood and keep the subject line under 50 characters."),
    ("Prefer small pull requests that review quickly.", "Prefer small pull requests, but allow large ones when they touch generated code only."),
    ("Use TypeScript strict mode in every new project.", "Use TypeScript strict mode in every new library project; application projects stay on the default settings."),
    ("Keep functions under forty lines where possible.", "Keep functions under forty lines in production code; test helpers may be longer."),
    ("Prefer dark theme in editors and terminals.", "Prefer dark theme in editors, but light theme in terminals for daytime screenshots."),
    ("Always cite the documentation version when quoting API behaviour.", "Always cite the documentation URL when quoting API behaviour."),
    ("Prefer native OS keyboard shortcuts over in-app remapping.", "Prefer in-app keyboard shortcuts over native OS ones when the app runs full screen."),
    ("Run database migrations in a transaction when the engine supports it.", "Run database migrations in a transaction on PostgreSQL; on MySQL run them statement by statement."),
    ("Prefer explicit type annotations on public function signatures.", "Prefer explicit type annotations on public function signatures and inferred types everywhere else."),
    ("Cache expensive build artefacts between pipeline runs.", "Cache build artefacts between pipeline runs and clear the cache weekly."),
    ("Write release notes in plain British English.", "Write release notes in plain British English and translate them into Malay for regional releases."),
    ("Prefer reading error messages fully before searching the web.", "Prefer searching the web immediately for unfamiliar error codes rather than reading them fully."),
    ("Delete feature branches immediately after merge.", "Delete feature branches one week after merge, once the release is confirmed."),
    ("Prefer adding tests alongside each bug fix.", "Prefer reproducing each bug manually before writing the fix; tests come later in the release cycle."),
    ("Use a single linter configuration per repository.", "Use a single linter configuration per organisation, shared across repositories."),
    ("Prefer scheduled focused work sessions over open-ended ones.", "Prefer scheduled focused sessions in the morning and open-ended exploration in the evening."),
    ("Keep dependency updates separate from feature changes.", "Keep dependency updates separate from feature changes, except for security fixes, which may ride along."),
    ("Prefer screenshots with annotated callouts in bug reports.", "Prefer short screen recordings over screenshots in bug reports."),
]

CONTRADICTIONS = [
    ("Always squash-merge pull requests.", "Never squash-merge pull requests; preserve every individual commit."),
    ("Prefer tabs for indentation.", "Prefer spaces for indentation; never use tabs."),
    ("Commit directly to the main branch for small fixes.", "Never commit directly to the main branch, regardless of change size."),
    ("Always write unit tests before the implementation.", "Never write tests first; tests come after the implementation is done."),
    ("Prefer synchronous pair programming for hard problems.", "Never pair program; solve hard problems alone in silence."),
    ("All discussion happens in the issue tracker.", "All discussion happens in chat; the issue tracker is for tickets only."),
    ("Keep the changelog updated by hand with every change.", "Generate the changelog automatically from commit history; never edit it by hand."),
    ("Always rebase onto the target branch before opening a pull request.", "Never rebase; merge the target branch into the feature branch instead."),
    ("Prefer verbose logging in development builds.", "Keep logging minimal in every build, including development."),
    ("Ship behind a feature flag by default.", "Never use feature flags; release changes fully or not at all."),
    ("Prefer long-lived branches with frequent integration.", "Keep branches alive for at most one day before merging or deleting."),
    ("Always require two approvals before merging.", "One approval is enough to merge; two approvals slow everything down."),
    ("Store configuration in environment variables.", "Never use environment variables; configuration belongs in a checked-in file."),
    ("Prefer semantic versioning for all packages.", "Use calendar versioning for all packages; semantic versioning is banned."),
    ("Delete stale branches weekly.", "Never delete branches; archive them indefinitely for audit reasons."),
    ("Prefer video calls for all technical discussions.", "Never use video calls; technical discussions happen in writing."),
    ("Run migrations automatically on deployment.", "Never run migrations automatically; a human runs each migration by hand."),
    ("Always write documentation before the code.", "Never write documentation before the code exists."),
    ("Prefer monorepo tooling for every service.", "Keep every service in its own repository; monorepos are prohibited."),
    ("Enable auto-merge when checks pass.", "Never enable auto-merge; a human merges every change."),
    ("Prefer breaking changes behind major versions only.", "Ship breaking changes in minor releases; major versions are reserved for rebrands."),
    ("Always keep a local development database seeded with production data.", "Never copy production data into development databases."),
    ("Prefer GUI database clients for data inspection.", "Inspect data exclusively through the terminal; GUI database clients are banned."),
    ("Silence all linter warnings in generated code.", "Treat linter warnings in generated code as blocking errors."),
]

COMPATIBLE = [
    ("Prefer using the terminal for Git operations.", "Prefer a GUI client for Mercurial operations."),
    ("Always run the full test suite before pushing changes.", "Lint the code before committing."),
    ("Write commit messages in the imperative mood.", "Keep the commit body wrapped at 72 characters."),
    ("Prefer small pull requests that review quickly.", "Add screenshots to pull requests that change the interface."),
    ("Use TypeScript strict mode in every new project.", "Prefer Vitest for unit tests in TypeScript projects."),
    ("Keep functions under forty lines where possible.", "Avoid more than three levels of nesting in functions."),
    ("Prefer dark theme in editors and terminals.", "Increase the font size in code reviews on large screens."),
    ("Always cite the documentation version when quoting API behaviour.", "Link to the upstream issue when a workaround is needed."),
    ("Prefer native OS keyboard shortcuts over in-app remapping.", "Disable animations in the editor for accessibility."),
    ("Run database migrations in a transaction when the engine supports it.", "Back up the database before each deployment."),
    ("Prefer explicit type annotations on public function signatures.", "Export a single public entry point per module."),
    ("Cache expensive build artefacts between pipeline runs.", "Cancel superseded pipeline runs automatically."),
    ("Write release notes in plain British English.", "Tag releases with the ISO date."),
    ("Prefer reading error messages fully before searching the web.", "Reproduce bugs in isolation before reporting them."),
    ("Delete feature branches immediately after merge.", "Require branch names to start with the ticket number."),
    ("Prefer scheduled focused work sessions over open-ended ones.", "Take notes in the issue tracker during each work session."),
]

EXPECTED = {"duplicate": 20, "conflict-related": 20, "contradiction": 24, "compatible": 16}


def build_cases():
    """Return the challenge cases with their intended outcomes."""
    cases = []
    for a, b in DUPLICATES:
        cases.append({"decision": "duplicate", "intended": "same", "A": a, "B": b})
    for a, b in RELATED_BUT_DISTINCT:
        cases.append({"decision": "duplicate", "intended": "different", "A": a, "B": b})
    for a, b in CONTRADICTIONS:
        cases.append({"decision": "conflict", "intended": "contradict", "A": a, "B": b})
    for a, b in COMPATIBLE:
        cases.append({"decision": "conflict", "intended": "compatible", "A": a, "B": b})
    return cases


def main():
    default = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default)
    args = parser.parse_args()
    root = args.root.absolute()
    try:
        from manifest import digest
        cases = build_cases()
        counts = {"same": 0, "different": 0, "contradict": 0, "compatible": 0}
        records = []
        for case in cases:
            require_redacted(case["A"])
            require_redacted(case["B"])
            counts[case["intended"]] += 1
            records.append({"id": digest(["challenge", case["decision"], case["A"], case["B"]])[:24],
                            "decision": case["decision"], "A": case["A"], "B": case["B"],
                            "outcome": "", "reason": ""})
        if len({record["id"] for record in records}) != len(records):
            raise ValueError("challenge case ids must be unique")
        if counts != {"same": EXPECTED["duplicate"], "different": EXPECTED["conflict-related"],
                      "contradict": EXPECTED["contradiction"], "compatible": EXPECTED["compatible"]}:
            raise ValueError("challenge case counts differ from the approved shape")
        design = [{"id": record["id"], **case} for record, case in zip(records, cases)]
        atomic_json(root / "corpus" / "challenge-design.json", root,
                    {"approved_shape": EXPECTED, "intended_counts": counts, "cases": design,
                     "note": "Intended outcomes are a design diagnostic only; the blind reviewer's outcomes are the ground truth. Challenge cases stay outside the production-band benchmark and gates."})
        atomic_json(root / "corpus" / "challenge-blind-review.json", root, records)
        print(json.dumps({"status": "built", "cases": len(records), "intended": counts}), flush=True)
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f"challenge case build failed: {error}\n")


if __name__ == "__main__":
    main()
