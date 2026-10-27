#!/usr/bin/env python3
"""Verify RFC documents against the codebase they describe.

Structural checks catch malformed markdown. Code-grounded checks catch the more
dangerous failure: an RFC that reads plausibly but describes behavior the code
does not have. The second kind found four factual errors during the 2026-08-26
detail-audit expansion, including an approval flow that could not be built.

Run from the repository root:

    python3 dev/verify-rfcs.py
    python3 dev/verify-rfcs.py --self-test

`--self-test` feeds deliberately broken input to every check and confirms each
one fails. A check that cannot fail proves nothing, so the suite is only
trustworthy if the self-test passes too.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys

RFC_DIR = "docs/rfcs"
# RFCs cite web paths (`lib/...`, `app/...`) relative to the web app.
WEB_DIR = "clients/apps/web"
CATALOG_PATH = os.path.join(RFC_DIR, "catalog.json")
AUDIT = "052-detail-audit-2026-08-26.md"
IMPLEMENTED = ["012-approval-workflow.md", "030-social-publishing.md"]

# Declared as a prerequisite by RFC 020 rather than claimed to exist.
ALLOWED_MISSING_IDENTIFIERS = {"creative:render", "post:schedule"}

PLANNED_SECTION = re.compile(
    r"\*\*This section is a design for planned work.*?(?=\n## )", re.S
)


def read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def rfc_paths() -> list[str]:
    return sorted(glob.glob(os.path.join(RFC_DIR, "*.md")))


def load_catalog() -> dict:
    try:
        value = json.loads(read(CATALOG_PATH))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def catalog_entries(catalog: dict | None = None) -> list[dict[str, str]]:
    entries = (load_catalog() if catalog is None else catalog).get("rfcs", [])
    if not isinstance(entries, list):
        return []
    return [
        entry for entry in entries
        if isinstance(entry, dict)
        and all(isinstance(entry.get(key), str) for key in ("id", "legacyId", "category", "file"))
        and re.fullmatch(r"\d{3}", entry["id"])
        and re.fullmatch(r"\d{3}", entry["legacyId"])
    ]


def check_catalog(docs: dict[str, str], catalog: dict) -> list[str]:
    """Canonical IDs, file titles, index order and the legacy map must agree."""
    entries = catalog_entries(catalog)
    if catalog.get("schemaVersion") != 1 or not entries or len(entries) != len(catalog.get("rfcs", [])):
        return ["RFC catalog is missing, malformed or has no valid entries"]
    groups = ["active", "conditional", "foundation", "deferred", "historical"]
    if catalog.get("groupOrder") != groups:
        return ["catalog must order active, conditional, foundation, deferred and historical work"]
    problems = []
    ids = [entry["id"] for entry in entries]
    files = [entry["file"] for entry in entries]
    legacy = [entry["legacyId"] for entry in entries]
    if ids != [f"{n:03}" for n in range(1, len(entries) + 1)]:
        problems.append("catalog IDs must be unique, contiguous and ascending from 001")
    if len(set(files)) != len(files) or len(set(legacy)) != len(legacy):
        problems.append("catalog filenames and previous IDs must each be unique")
    if not {f"{n:03}" for n in range(52)}.issubset(set(legacy)):
        problems.append("catalog is missing one of the 52 original RFC identities")
    categories = [entry["category"] for entry in entries]
    if any(category not in groups for category in categories):
        problems.append("catalog has an unknown priority category")
    elif categories != sorted(categories, key=groups.index):
        problems.append("catalog entries are out of priority-category order")
    numbered = {name for name in docs if re.match(r"\d{3}-.*\.md$", name)}
    if numbered != set(files):
        problems.append(f"catalog/files disagree: {sorted(numbered ^ set(files))}")
    for entry in entries:
        name, number = entry["file"], entry["id"]
        text = docs.get(name, "")
        if not re.fullmatch(re.escape(number) + r"-[a-z0-9-]+\.md", name):
            problems.append(f"invalid canonical filename: {name}")
        if not text.startswith(f"# RFC {number}:"):
            problems.append(f"{name} title does not match RFC {number}")
        if not re.search(rf"^\*\*Priority:\*\* {number} — ", text, re.M):
            problems.append(f"{name} is missing its priority header")
        if not re.search(rf"^\*\*Previous ID:\*\* {entry['legacyId']} ", text, re.M):
            problems.append(f"{name} has an incorrect previous-ID header")
    index = docs.get("README.md", "").split("## Complete RFC inventory", 1)
    inventory = re.findall(r"\]\((\d{3}-[a-z0-9-]+\.md)\)", index[1]) if len(index) == 2 else []
    if inventory != files:
        problems.append("RFC index must list every canonical file once in catalog priority order")
    mapping = docs.get("renumbering-2026-10-24.md", "")
    actual_mapping = re.findall(r"^\| (\d{3}) \| \[(\d{3}) — [^\]]+\]\(([^)]+)\) \| ([a-z]+) \|$", mapping, re.M)
    expected_mapping = [(e["legacyId"], e["id"], e["file"], e["category"]) for e in entries]
    if sorted(actual_mapping) != sorted(expected_mapping):
        problems.append("renumbering table must map every previous ID to its canonical file/category once")
    for name, text in docs.items():
        for label, target in re.findall(r"\[((?:RFC )?\d{3})(?:[^\]]*)\]\((\d{3}-[^)]+\.md)(?:#[^)]*)?\)", text):
            if label[-3:] != target[:3]:
                problems.append(f"{name} labels {target} as {label}")
    return problems


def lib_sources() -> str:
    """Concatenated tracked sources (web TypeScript, Go product code, schema SQL),
    used for symbol existence. Product data models live in the Go backend."""
    result = subprocess.run(
        [
            "bash",
            "-c",
            "cat $(git ls-files 'clients/apps/web/lib/**/*.ts' "
            "'clients/apps/web/app/**/*.ts' 'clients/apps/web/app/**/*.tsx' "
            "'server/internal/**/*.go' 'server/ent/schema/*.go' "
            "'server/platformmigrations/sql/*.sql') 2>/dev/null",
        ],
        capture_output=True,
        text=True,
    )
    return result.stdout


def shipped_prose(text: str) -> str:
    """Only the parts of a document that claim to describe shipped behavior."""
    text = text.split("## Planned refinements")[0]
    return PLANNED_SECTION.sub("", text)


# --- structural checks -------------------------------------------------------


def check_links(docs: dict[str, str]) -> list[str]:
    """Every relative Markdown link must resolve to a real file.

    An earlier version only matched targets starting with a digit-zero, which
    silently skipped `./`-prefixed and parent-directory links. A link check that
    cannot see a whole class of links is worse than none, because it reports
    success over unexamined text.
    """
    problems = []
    for name, text in docs.items():
        for link in re.findall(r"\]\(([^)\s#]+\.md)(?:#[^)]*)?\)", text):
            if link.startswith(("http://", "https://", "/")):
                continue
            if not os.path.exists(os.path.normpath(os.path.join(RFC_DIR, link))):
                problems.append(f"{name} links to missing {link}")
    return problems


def check_fences(docs: dict[str, str]) -> list[str]:
    return [f"{n} has an unclosed code fence" for n, t in docs.items() if t.count("\n```") % 2]


def check_tables(docs: dict[str, str]) -> list[str]:
    problems = []
    for name, text in docs.items():
        lines = text.split("\n")
        in_fence = False
        for i, line in enumerate(lines):
            if line.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence or not re.match(r"^\s*\|[\s:|-]+\|\s*$", line) or "-" not in line:
                continue
            if not i or not lines[i - 1].strip().startswith("|"):
                continue
            width = line.count("|")
            if lines[i - 1].count("|") != width:
                problems.append(f"{name}:{i} header/separator column mismatch")
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith("|"):
                if lines[j].count("|") != width:
                    problems.append(f"{name}:{j + 1} row column mismatch")
                j += 1
    return problems


def check_coverage(docs: dict[str, str]) -> list[str]:
    audit = docs.get(AUDIT)
    if not audit or "## Coverage" not in audit:
        return ["audit document is missing its Coverage section"]
    section = audit.split("## Coverage")[1]

    def listed(label: str) -> set[str]:
        return set(re.findall(r"\d{3}", section.split(label)[1].split("\n")[0])) if label in section else set()

    high = listed("**High priority:**")
    medium = listed("**Medium priority:**")
    sufficient = listed("**Sufficient for current purpose:**")
    problems = []
    for a, b, label in (
        (high, medium, "high/medium"),
        (high, sufficient, "high/sufficient"),
        (medium, sufficient, "medium/sufficient"),
    ):
        if a & b:
            problems.append(f"RFCs classified twice ({label}): {sorted(a & b)}")
    expected = {entry["id"] for entry in catalog_entries() if 1 <= int(entry["legacyId"]) <= 33}
    if len(expected) != 33:
        return ["catalog must resolve all 33 RFCs in the original audit scope"]
    if missing := expected - (high | medium | sufficient):
        problems.append(f"RFCs absent from coverage: {sorted(missing)}")
    if extra := (high | medium | sufficient) - expected:
        problems.append(f"RFCs outside the historical audit scope: {sorted(extra)}")
    return problems


def check_enum_casing(docs: dict[str, str]) -> list[str]:
    """Status literals must match the Prisma enum, which is uppercase."""
    return [
        f"{n} uses lowercase status literal"
        for n, t in docs.items()
        if re.search(r"`(ready_for_review|needs_changes|approved|rejected)`", t)
    ]


def check_acceptance(docs: dict[str, str]) -> list[str]:
    problems = []
    expanded = [
        entry for entry in catalog_entries()
        if 10 <= int(entry["legacyId"]) <= 32 or 45 <= int(entry["legacyId"]) <= 51
    ]
    if len(expanded) != 30:
        return ["catalog must resolve all 30 expanded RFCs"]
    for entry in expanded:
        name = entry["file"]
        if name not in docs:
            # A missing document must fail loudly. Skipping it would let a
            # deleted or renamed RFC pass this check silently.
            problems.append(f"RFC {entry['id']} not found; expected an expanded document")
            continue
        section = re.search(
            r"## .*Acceptance criteria(.*?)(\n## |\Z)", docs[name], re.S | re.I
        )
        count = len(re.findall(r"^\d+\. ", section.group(1), re.M)) if section else 0
        if count < 5:
            problems.append(f"{name} has {count} numbered acceptance criteria, expected >= 5")
    return problems


# --- code-grounded checks ----------------------------------------------------


def known_identifiers() -> set[str]:
    sources = [
        "lib/auth/permissions.ts",
        "lib/auth/api-key-scopes.ts",
        "lib/billing/plans.ts",
    ]
    sources = [os.path.join(WEB_DIR, path) for path in sources]
    found: set[str] = set()
    for path in sources:
        if os.path.exists(path):
            found |= set(re.findall(r"'([a-z\-]+:[a-z\-:]+)'", read(path)))
    return found


def evaluate_observability(name: str, text: str) -> list[str]:
    """Pure core: an audited RFC needs an observability section naming one metric.

    The house style asks each document to elevate a single metric that actually
    matters, because a bullet list of signals says what could be measured, not
    what would tell you the feature failed. Phrasings vary ("is the headline",
    "is the number that matters"), so this looks for prose that elevates one
    signal rather than for a fixed sentence. Bullets and table rows are dropped
    first; bold lead-ins are kept, since that is how several sections open.
    """
    section = re.search(
        r"^## (?:Observability|Measurement|Tracing and observability)\b(.*?)(?=^## |\Z)",
        text,
        re.M | re.S,
    )
    if not section:
        return [f"{name} has no observability section"]
    prose = "\n".join(
        line
        for line in section.group(1).split("\n")
        if not line.strip().startswith(("- ", "| "))
    )
    elevated = re.search(
        r"metric that actually matters|is the (?:earliest|product|health|real|key|headline|"
        r"primary|one|value|user-visible|false)\b|are the only metrics|is the one that matters"
        r"|is the number that matters|are the number that matters|decides whether"
        r"|is the metric|which is the false-positive measure",
        prose,
        re.I,
    )
    if not elevated:
        return [f"{name} lists signals but never names the metric that matters"]
    return []


def check_observability(docs: dict[str, str]) -> list[str]:
    """Every RFC the audit flagged must carry a usable observability section."""
    audit = docs.get("052-detail-audit-2026-08-26.md", "")
    if not audit:
        return ["audit document missing; observability check would be meaningless"]
    flagged = sorted(set(re.findall(r"^\| \[(\d{3})\]", audit, re.M)))
    if not flagged:
        return ["no flagged RFCs parsed; observability check would be meaningless"]
    problems = []
    for number in flagged:
        match = [n for n in docs if n.startswith(f"{number}-")]
        if not match:
            problems.append(f"RFC {number} is audited but its document is missing")
            continue
        problems += evaluate_observability(match[0], docs[match[0]])
    return problems


def check_identifiers(docs: dict[str, str]) -> list[str]:
    known = known_identifiers()
    if len(known) < 20:
        # The permission sources moved or failed to parse. An empty or tiny
        # allowlist would flag everything, or an over-broad one would flag
        # nothing; either way the result is not trustworthy.
        return [f"identifier allowlist resolved to {len(known)} entries; expected the full set"]
    known |= ALLOWED_MISSING_IDENTIFIERS
    problems = []
    for name, text in docs.items():
        for ident in sorted(set(re.findall(r"`([a-z]+:[a-z\-]+)`", text))):
            if ident not in known:
                problems.append(f"{name} cites undefined permission/scope/feature `{ident}`")
    return problems


def check_paths(docs: dict[str, str]) -> list[str]:
    pattern = r"`((?:lib|app|prisma|components)/[\w\-./]+\.(?:ts|tsx|prisma))`"
    problems = []
    for name, text in docs.items():
        for path in sorted(set(re.findall(pattern, text))):
            if not os.path.exists(os.path.join(WEB_DIR, path)):
                problems.append(f"{name} cites nonexistent path `{path}`")
    return problems


def check_transition_table(docs: dict[str, str]) -> list[str]:
    """RFC 012's table is normative; compare it field-by-field to the code."""
    source_path = os.path.join(WEB_DIR, "lib/tenant/campaign-status.ts")
    doc = docs.get("012-approval-workflow.md")
    if not doc or not os.path.exists(source_path):
        return ["cannot compare transition table: file missing"]
    code = read(source_path)
    rows = re.findall(
        r"^\| `(\w+)`\s*\|\s*([^|]+?)\s*\|\s*`(\w+)`\s*\|\s*`([\w:]+)`\s*\|\s*([^|]+?)\s*\|",
        doc,
        re.M,
    )
    problems = []
    if len(rows) != 4:
        problems.append(f"transition table has {len(rows)} rows, expected 4")
    for decision, from_cell, to_state, permission, actors in rows:
        match = re.search(
            rf"{decision}: \{{\s*from: \[([^\]]+)\],\s*permission: '([\w:]+)',\s*to: '(\w+)'",
            code,
            re.S,
        )
        if not match:
            problems.append(f"decision `{decision}` documented but absent from code")
            continue
        if set(re.findall(r"'(\w+)'", match.group(1))) != set(re.findall(r"`(\w+)`", from_cell)):
            problems.append(f"`{decision}` from-set disagrees with code")
        if match.group(3) != to_state:
            problems.append(f"`{decision}` to-state is `{to_state}`, code says `{match.group(3)}`")
        if match.group(2) != permission:
            problems.append(
                f"`{decision}` permission is `{permission}`, code says `{match.group(2)}`"
            )
        # Every decision routes through requireActiveSessionOrganization.
        if "session only" not in actors:
            problems.append(f"`{decision}` claims a non-session actor; no API-key path exists")
    return problems


# Promise words that describe a document's shape rather than a topic, or that
# routinely appear in a different grammatical form than the audit uses.
PROMISE_STOPWORDS = {
    "and",
    "the",
    "for",
    "with",
    "plus",
    "its",
    "their",
    "that",
    "from",
    "rules",
    "defenses",
    "behavior",
    "handling",
    "model",
    "models",
    "semantics",
    "contracts",
    "limits",
    "boundaries",
    "states",
    "concrete",
    "measurable",
    "formal",
    "supported",
    "architecture",
    "constraints",
    "policy",
    "schema",
    "resumability",
    "budgets",
    "protection",
    "authentication",
    "translation",
    "versioning",
    "measurement",
    "approving",
    "generating",
    "reading",
    "scheduling",
    "timezone",
    "fallback",
    "hashing",
    "rollback",
    "normalization",
    "deduplication",
}


def check_audit_promises(docs: dict[str, str]) -> list[str]:
    """Each audit row promises specific detail; the target must deliver it.

    Word matching is deliberately lenient, because the audit and the documents
    use different grammatical forms. It exists to catch a wholly absent topic,
    which is how the missing cancellation and reconciliation sections were
    found, not to police vocabulary.
    """
    audit = docs.get("052-detail-audit-2026-08-26.md")
    if not audit:
        return ["audit document not found; cannot verify its promises"]
    rows = re.findall(r"^\| \[(\d{3})\][^|]*\|\s*(.+?)\s*\|$", audit, re.M)
    if len(rows) < 20:
        return [f"audit promise tables parsed {len(rows)} rows; expected >= 20"]
    problems = []
    for number, promise in rows:
        targets = [v for k, v in docs.items() if k.startswith(f"{number}-")]
        if not targets:
            problems.append(f"RFC {number} promised detail but the document is missing")
            continue
        body = targets[0].lower().replace("-", " ")
        for word in promise.split():
            word = word.lower().strip(".,()").replace("-", " ")
            if len(word) < 6 or word in PROMISE_STOPWORDS:
                continue
            if word.rstrip("s") not in body:
                problems.append(f"RFC {number} promised '{word}' but the document omits it")
    return problems


def check_grounded_paragraphs(docs: dict[str, str], source: str) -> list[str]:
    """Any paragraph citing a real source file must not invent symbols.

    The `Implemented RFCs cite only real symbols` check covers RFCs 012 and 030.
    This one applies the same standard to every document: citing a concrete file
    is a claim about real code, so every symbol named alongside it must exist.
    Proposed schema fields in `ts` blocks are untouched, because those describe
    work to be done rather than code that is there.
    """
    if not source.strip():
        return ["cannot read sources; grounded-paragraph check would be meaningless"]
    file_ref = re.compile(r"`(?:lib|app|prisma)/[\w\-./]+\.(?:ts|tsx|prisma)`")
    problems = []
    for name in sorted(docs):
        for paragraph in docs[name].split("\n\n"):
            if paragraph.lstrip().startswith("```") or not file_ref.search(paragraph):
                continue
            for symbol in sorted(set(re.findall(r"`([a-z][a-zA-Z0-9]{6,})`", paragraph))):
                if symbol not in source:
                    problems.append(
                        f"{name} names `{symbol}` beside a real file path; not found in sources"
                    )
    return problems


def check_cross_references(docs: dict[str, str]) -> list[str]:
    """Every RFC reference and dependency must point at a document that exists."""
    problems = []
    for name in sorted(docs):
        text = docs[name]
        own = name[:3]
        for number in sorted(set(re.findall(r"\bRFC (\d{3})\b", text))):
            if number == own:
                continue  # the document's own title line
            if not any(k.startswith(f"{number}-") for k in docs):
                problems.append(f"{name} references RFC {number}, which does not exist")
        for header in re.finditer(r"\*\*(?:Depends on|Reuses|Historical dependencies):\*\*\s*(.+)", text):
            for number in sorted(set(re.findall(r"RFC (\d{3})", header.group(1)))):
                if not any(k.startswith(f"{number}-") for k in docs):
                    problems.append(f"{name} declares a dependency on missing RFC {number}")
    return problems


def evaluate_script_allowlist(scripts: list[str], ignored: list[str]) -> list[str]:
    """Pure core of the allowlist check, so it can be tested without a repo."""
    if not scripts:
        return ["no tracked scripts found; allowlist check would be meaningless"]
    return [
        f"{script} is tracked but would be ignored if re-added"
        for script in scripts
        if script in ignored
    ]


def evaluate_inside_out(deps: dict[str, list[str]], implemented: set[str]) -> list[str]:
    """Pure core: a proposal must not hard-depend on later, unbuilt work.

    The current index orders new work. Reused foundations are separate from
    unbuilt prerequisites; historical dependency cycles do not define that order.
    """
    problems = []
    for number in sorted(deps):
        for dependency in sorted(deps[number]):
            if dependency == number:
                problems.append(f"RFC {number} cannot depend on itself")
            elif dependency > number and dependency not in implemented:
                problems.append(
                    f"RFC {number} depends on later RFC {dependency}, which is not implemented; "
                    "this inverts the current RFC priority order"
                )
    return problems


WORD_NUMBERS = {
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20,
}


def evaluate_documented_check_count(text: str, actual: int) -> list[str]:
    """Pure core: the audit's written check count must match reality.

    This number already drifted once, silently, when a check was added. Prose
    that counts something is a claim about code, so it gets verified like one.
    """
    match = re.search(r"It runs (\w+) checks", text)
    if not match:
        return ["audit does not state how many checks the script runs"]
    word = match.group(1).lower()
    if word not in WORD_NUMBERS:
        return [f"audit states an unrecognized check count: {word!r}"]
    claimed = WORD_NUMBERS[word]
    if claimed != actual:
        return [f"audit says {word} ({claimed}) checks, but the script runs {actual}"]
    return []


def check_documented_check_count(docs: dict[str, str], total: int) -> list[str]:
    """The audit must not misstate how many checks exist."""
    audit = docs.get(AUDIT)
    if audit is None:
        return ["audit document not found; its check count cannot be verified"]
    return evaluate_documented_check_count(audit, total)


def check_inside_out_order(docs: dict[str, str]) -> list[str]:
    """Active and conditional prerequisites must follow the canonical order."""
    if not docs:
        return ["no documents; inside-out check would be meaningless"]
    entries = catalog_entries()
    deps, problems = {}, []
    implemented = {entry["id"] for entry in entries if entry["category"] == "foundation"}
    for entry in entries:
        if entry["category"] not in {"active", "conditional"}:
            continue
        name, number = entry["file"], entry["id"]
        text = docs.get(name, "")
        header = re.search(r"\*\*Depends on:\*\*\s*(.+)", text)
        if header:
            deps[number] = re.findall(r"RFC (\d{3})", header.group(1))
        else:
            problems.append(f"{name} must explicitly state new-work dependencies, including None")
    if not deps:
        return ["no dependency headers parsed; inside-out check would be meaningless"]
    return problems + evaluate_inside_out(deps, implemented)


def check_tracked_scripts_survive_reclone() -> list[str]:
    """Every tracked web script must be allowlisted against `/clients/apps/web/scripts/*`.

    `.gitignore` denies `/clients/apps/web/scripts/*` and re-admits specific files. A tracked
    script missing from that allowlist keeps working only because git ignores
    ignore-rules for files already in the index, so the omission stays silent
    until someone re-adds the file and it vanishes. `--no-index` is what makes
    this detectable: plain `check-ignore` reports tracked files as fine.
    """
    listing = subprocess.run(["git", "ls-files", f"{WEB_DIR}/scripts/"], capture_output=True, text=True)
    # A tracked file already deleted from the tree is a pending removal, not a re-clone hazard.
    scripts = [f for f in listing.stdout.split("\n") if f.strip() and os.path.exists(f)]
    ignored = [
        script
        for script in scripts
        if subprocess.run(["git", "check-ignore", "-q", "--no-index", script]).returncode == 0
    ]
    return evaluate_script_allowlist(scripts, ignored)


def check_shipped_symbols(docs: dict[str, str], source: str) -> list[str]:
    """A doc marked Implemented must not cite symbols that do not exist."""
    problems = []
    if not source.strip():
        # Without sources every symbol would appear absent, or worse, the
        # membership test would be meaningless. Fail rather than guess.
        return ["cannot read lib/ sources; symbol check would be meaningless"]
    for name in IMPLEMENTED:
        if name not in docs:
            problems.append(f"{name} not found; it documents shipped behavior and must exist")
            continue
        prose = shipped_prose(docs[name])
        for symbol in sorted(set(re.findall(r"`([a-z][a-zA-Z0-9]{7,})`", prose))):
            if symbol not in source:
                problems.append(f"{name} cites `{symbol}` in a shipped section; not found in lib/")
    return problems


# --- driver ------------------------------------------------------------------


def run(docs: dict[str, str], source: str) -> list[tuple[str, list[str]]]:
    return [
        ("RFC catalog, priority order and renumbering agree", check_catalog(docs, load_catalog())),
        ("inter-RFC links resolve", check_links(docs)),
        ("code fences balanced", check_fences(docs)),
        ("table columns aligned", check_tables(docs)),
        ("audit classifies every RFC exactly once", check_coverage(docs)),
        ("status literals match the Prisma enum", check_enum_casing(docs)),
        ("every expanded RFC has >= 5 acceptance criteria", check_acceptance(docs)),
        ("permissions, scopes, and features exist in code", check_identifiers(docs)),
        ("cited source paths exist", check_paths(docs)),
        ("RFC 012 table matches campaignPostTransitions", check_transition_table(docs)),
        ("Implemented RFCs cite only real symbols", check_shipped_symbols(docs, source)),
        ("audit promises are substantiated", check_audit_promises(docs)),
        ("every doc citing a real file names real symbols", check_grounded_paragraphs(docs, source)),
        ("cross-RFC references resolve", check_cross_references(docs)),
        ("audited RFCs name the metric that matters", check_observability(docs)),
        ("proposals do not depend on later unbuilt work", check_inside_out_order(docs)),
        ("tracked scripts survive a re-clone", check_tracked_scripts_survive_reclone()),
    ]


def self_test(docs: dict[str, str], source: str) -> int:
    """Confirm each check fails on input it is supposed to reject."""
    approval_doc = docs["012-approval-workflow.md"]
    autonomy_doc = docs["044-autonomy-modes.md"]
    catalog = load_catalog()
    entries = catalog_entries(catalog)
    first = entries[0]["file"]
    cases = [
        ("catalog (missing)", lambda: check_catalog(docs, {})),
        ("catalog (duplicate ID)", lambda: check_catalog(docs, {**catalog, "rfcs": [entries[0], entries[0], *entries[2:]]})),
        ("catalog (missing document)", lambda: check_catalog({n: t for n, t in docs.items() if n != first}, catalog)),
        ("catalog (wrong title)", lambda: check_catalog({**docs, first: docs[first].replace("# RFC 001:", "# RFC 099:")}, catalog)),
        ("catalog (reversed inventory)", lambda: check_catalog({**docs, "README.md": docs["README.md"].replace(
            "](" + first + ")", "](" + entries[1]["file"] + ")")}, catalog)),
        ("catalog (missing legacy mapping)", lambda: check_catalog({**docs, "renumbering-2026-10-24.md": ""}, catalog)),
        ("catalog (wrong category order)", lambda: check_catalog(docs, {**catalog, "groupOrder": list(reversed(catalog["groupOrder"]))})),
        ("links", lambda: check_links({"x.md": autonomy_doc + "\n[x](099-nope.md)\n"})),
        # The original case used a bare `099-` target, which the old digit-anchored
        # regex happened to match, so the check passed its self-test while blind to
        # every `./` and `../` link. Pin both shapes.
        ("links (dot-slash target)", lambda: check_links({"x.md": "[x](./099-nope.md)"})),
        ("links (parent-dir target)", lambda: check_links({"x.md": "[x](../nope.md)"})),
        ("links (anchor suffix)", lambda: check_links({"x.md": "[x](./099-nope.md#s)"})),
        ("fences", lambda: check_fences({"x.md": autonomy_doc + "\n```ts\n"})),
        ("tables", lambda: check_tables({"x.md": "\n| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n"})),
        (
            "coverage",
            lambda: check_coverage(
                {
                    "052-detail-audit-2026-08-26.md": docs[
                        "052-detail-audit-2026-08-26.md"
                    ].replace("**Medium priority:**", "**Medium priority:** 020,", 1)
                }
            ),
        ),
        ("enum casing", lambda: check_enum_casing({"x.md": "state `ready_for_review` here"})),
        (
            "acceptance",
            lambda: check_acceptance(
                {
                    **docs,
                    "020-programmable-creative-engine.md": re.sub(
                        r"## Acceptance criteria.*?(?=\n## )",
                        "## Acceptance criteria\n\n1. one\n\n",
                        docs["020-programmable-creative-engine.md"],
                        flags=re.S,
                    )
                }
            ),
        ),
        ("identifiers", lambda: check_identifiers({"x.md": "needs `channel:forge`"})),
        ("paths", lambda: check_paths({"x.md": "see `lib/tenant/ghost-file.ts`"})),
        (
            "transition table",
            lambda: check_transition_table(
                {"012-approval-workflow.md": approval_doc.replace("`release:create`", "`publish:manage`")}
            ),
        ),
        (
            "shipped symbols",
            lambda: check_shipped_symbols(
                {"012-approval-workflow.md": "## S\n\nCalls `fabricatedHelper`.\n\n## T\n"}, source
            ),
        ),
        # A check that passes when its input is missing is worse than no check.
        # These three confirm each fails loudly rather than silently skipping.
        ("acceptance (missing RFC)", lambda: check_acceptance({})),
        ("acceptance (active RFC)", lambda: check_acceptance({**docs, first: "# RFC 001: No criteria\n"})),
        ("shipped symbols (missing doc)", lambda: check_shipped_symbols({}, source)),
        ("shipped symbols (no sources)", lambda: check_shipped_symbols(docs, "")),
        (
            "audit promises (topic absent)",
            lambda: check_audit_promises(
                {
                    **docs,
                    "041-recurring-campaign-generation.md": re.sub(
                        r"(?i)freshness", "xxxx", docs["041-recurring-campaign-generation.md"]
                    ),
                }
            ),
        ),
        ("audit promises (audit missing)", lambda: check_audit_promises({})),
        (
            "grounded paragraphs (invented symbol)",
            lambda: check_grounded_paragraphs(
                {"x.md": "The `phantomResolver` in `lib/tenant/campaigns.ts` does this."}, source
            ),
        ),
        ("grounded paragraphs (no sources)", lambda: check_grounded_paragraphs(docs, "")),
        (
            "observability (no section)",
            lambda: evaluate_observability("x.md", "## Decision\n\ntext\n"),
        ),
        (
            "observability (bullets, no elevated metric)",
            lambda: evaluate_observability("x.md", "## Observability\n\n- a signal\n- another\n"),
        ),
        ("observability (audit missing)", lambda: check_observability({})),
        (
            "inside-out (depends on later unbuilt RFC)",
            lambda: evaluate_inside_out({"018": ["019"]}, set()),
        ),
        ("inside-out (no documents)", lambda: check_inside_out_order({})),
        ("inside-out (self dependency)", lambda: evaluate_inside_out({"002": ["002"]}, set())),
        ("inside-out (active depends on conditional)", lambda: check_inside_out_order({**docs, first: docs[first].replace(
            "**Depends on:** None — start the assisted pilot program now.", "**Depends on:** RFC 007")})),
        (
            "documented check count (stale number)",
            lambda: evaluate_documented_check_count("It runs fifteen checks:", 16),
        ),
        (
            "documented check count (no claim)",
            lambda: evaluate_documented_check_count("no count here", 16),
        ),
        (
            "script allowlist (tracked but ignored)",
            lambda: evaluate_script_allowlist(["scripts/a.ts"], ["scripts/a.ts"]),
        ),
        ("script allowlist (no scripts found)", lambda: evaluate_script_allowlist([], [])),
        (
            "cross references (missing RFC)",
            lambda: check_cross_references({"x.md": "See RFC 099 for details."}),
        ),
    ]
    failures = 0
    positive_cases = [
        ("catalog accepts the current numbering", lambda: check_catalog(docs, catalog)),
        ("historical coverage survives renumbering", lambda: check_coverage(docs)),
        ("all expanded RFCs retain acceptance gates", lambda: check_acceptance(docs)),
        ("current active dependencies are valid", lambda: check_inside_out_order(docs)),
        ("a reused foundation may have a later number", lambda: evaluate_inside_out({"002": ["011"]}, {"011"})),
    ]
    for label, case in positive_cases:
        problems = case()
        print(f"  [{'PASS' if not problems else 'FAIL'}] {label}")
        failures += bool(problems)
    print("Self-test: every check must reject known-bad input\n")
    for label, case in cases:
        caught = bool(case())
        print(f"  [{'PASS' if caught else 'FAIL'}] {label} rejects bad input")
        failures += not caught
    return failures


def main() -> int:
    if not os.path.isdir(RFC_DIR):
        print(f"error: run from the repository root; {RFC_DIR} not found", file=sys.stderr)
        return 2

    docs = {os.path.basename(p): read(p) for p in rfc_paths()}
    source = lib_sources()

    if "--self-test" in sys.argv:
        failures = self_test(docs, source)
        print("\nSelf-test passed" if not failures else f"\n{failures} check(s) cannot fail")
        return 1 if failures else 0

    results = run(docs, source)
    # +1 counts this check itself, which is appended below.
    results.append(
        (
            "audit states the real number of checks",
            check_documented_check_count(docs, len(results) + 1),
        )
    )
    failures = 0
    for label, problems in results:
        print(f"[{'PASS' if not problems else 'FAIL'}] {label}")
        for problem in problems[:10]:
            print(f"       {problem}")
        if len(problems) > 10:
            print(f"       ... and {len(problems) - 10} more")
        failures += bool(problems)

    print(f"\n{len(results) - failures}/{len(results)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
