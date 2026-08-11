# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import re
from dataclasses import dataclass
from genlayer import *
import genlayer.gl as gl


# ======================================================================
# Constants
# ======================================================================

# --- bounty lifecycle -------------------------------------------------
STATUS_DRAFT_UNUSED = "DRAFT"  # off-chain only; a bounty only exists on-chain once funded
STATUS_OPEN = "OPEN"
STATUS_EVALUATING = "EVALUATING"
STATUS_EVALUATED = "EVALUATED"
STATUS_RESOLVED = "RESOLVED"
STATUS_CANCELLED = "CANCELLED"
STATUS_TIMED_OUT = "TIMED_OUT"

# --- testimony lifecycle ----------------------------------------------
TESTIMONY_SUBMITTED = "SUBMITTED"
TESTIMONY_CORROBORATED = "CORROBORATED"
TESTIMONY_DISPUTED = "DISPUTED"
TESTIMONY_REJECTED = "REJECTED"

# --- evaluation verdicts -------------------------------------------------
VERDICT_PASSED = "PASSED"
VERDICT_FAILED = "FAILED"
VERDICT_PARTIAL_PASS = "PARTIAL_PASS"
VERDICT_NEEDS_HUMAN_REVIEW = "NEEDS_HUMAN_REVIEW"

# --- timing window bounds, expressed in virtual epochs. Defaults for
# create_bounty's submission_window_epochs/evaluation_timeout_epochs
# parameters are plain int literals (20 / 40) directly on the method
# signature rather than referencing these — GenVM's calldata schema
# generator requires default values to be simple literals, not module-level
# constant expressions. -----------------------------------------------
MIN_SUBMISSION_WINDOW_EPOCHS = u256(1)
MAX_SUBMISSION_WINDOW_EPOCHS = u256(2000)
MAX_EVALUATION_TIMEOUT_EPOCHS = u256(4000)

# --- basis-point knobs (1 bps = 0.01%) ---------------------------------
BPS_DENOMINATOR = u256(10000)
# A testimony is considered "corroborating" the accepted narrative once its
# consistency score clears this boundary. Kept comfortably away from the
# extremes (0 / 10000) so ordinary scoring noise near the edges doesn't flip
# the accept/reject boundary between leader and validator runs.
CORROBORATION_THRESHOLD_BPS = 4000
# Overall bounty verdict thresholds.
PASS_CONFIDENCE_THRESHOLD_BPS = 6500
PARTIAL_CONFIDENCE_THRESHOLD_BPS = 3500

# --- validator tolerance gates (the "don't just check JSON shape" gates) ---
# These intentionally mirror the pattern used by a sibling GenLayer contract
# (Meme Olympics) that judges image submissions: the validator re-derives
# the ENTIRE nondeterministic outcome independently (its own web fetch, its
# own LLM call) and only accepts agreement if the substantive judgment is
# close enough on every axis below. Tolerances are wide on purpose: too
# tight and ordinary LLM sampling variance forces constant leader rotation
# or an UNDETERMINED consensus result; too loose and the validator stops
# meaning anything. These values are a deliberate middle ground.
CONFIDENCE_TOLERANCE_BPS = 1500
PAYOUT_TOLERANCE_BPS = 1500
PER_TESTIMONY_SCORE_TOLERANCE_BPS = 1800
PER_TESTIMONY_AGREEMENT_MIN_FRACTION_BPS = 7000  # >=70% of testimonies must be within tolerance

# --- structured error classification, so leader/validator disagreement is
# meaningful rather than "any exception = disagree" -------------------------
ERROR_EXPECTED = "[EXPECTED]"    # deterministic business-logic rejection — exact match required
ERROR_EXTERNAL = "[EXTERNAL]"    # evidence source returned a 4xx — exact match required
ERROR_TRANSIENT = "[TRANSIENT]"  # network/5xx flakiness — both sides being transient counts as agreement
ERROR_LLM = "[LLM_ERROR]"        # LLM produced unusable output — always disagree, forces rotation

MAX_TESTIMONIES_PER_EVALUATION = 25
MAX_EVIDENCE_URLS_PER_TESTIMONY = 6
MAX_STATEMENT_HASH_LEN = 128
MAX_EVIDENCE_URL_LEN = 500
MAX_TEXT_FIELD_LEN = 4000


# ======================================================================
# Small generic helpers
# ======================================================================

def _tm_get(tree_map, key, default):
    """TreeMap has no `.get(key, default)` in GenVM's storage API — this is
    the explicit `in`-check wrapper used everywhere instead."""
    if key in tree_map:
        return tree_map[key]
    return default


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise gl.vm.UserError(message)


def _bps_clamp(value: int) -> int:
    return max(0, min(int(BPS_DENOMINATOR), int(value)))


def _parse_json_object(text: str):
    """Defensive JSON extraction for LLM output: strips prose around a
    JSON object, tolerates trailing commas, and returns None (never raises)
    on anything that still doesn't parse as an object so callers can treat
    that as an [LLM_ERROR] condition explicitly."""
    if not text:
        return None
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1 or last <= first:
        return None
    snippet = text[first : last + 1]
    snippet = re.sub(r",(\s*[}\]])", r"\1", snippet)
    try:
        parsed = json.loads(snippet)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _pick(obj: dict, key: str, aliases: tuple):
    if key in obj:
        return obj[key]
    for alias in aliases:
        if alias in obj:
            return obj[alias]
    return None


def _coerce_bps(value, default: int = 0) -> int:
    try:
        number = int(round(float(str(value).strip())))
    except Exception:
        return default
    return _bps_clamp(number)


def _coerce_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1")
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def _coerce_str(value, default: str = "") -> str:
    if value is None:
        return default
    # Always copy calldata/LLM-derived strings before they end up stored in a
    # fresh @allow_storage dataclass instance — passing a reference through
    # directly has been observed to corrupt other fields on that instance.
    return str(value)


# ======================================================================
# Escrow: the single GEN emission point
# ======================================================================

@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


def _send_gen(to_address: Address, amount: u256) -> None:
    """The only place GEN ever leaves this contract. Every payout in every
    exit path funnels through here, so auditing "can this contract move
    funds anywhere unexpected" is a single-function review."""
    if to_address == Address("0x0000000000000000000000000000000000000000"):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Missing recipient address")
    if amount <= u256(0):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Transfer amount must be positive")
    _Recipient(to_address).emit_transfer(value=amount)


# ======================================================================
# Storage records
# ======================================================================

@allow_storage
@dataclass
class BountyRecord:
    bounty_id: str
    creator: Address
    title: str
    description: str
    evidence_requirements: str

    status: str

    # --- escrow ledger: agreed terms vs actual custody, kept separate ---
    reward_wei: u256
    reward_deposited: u256
    witness_bond_wei: u256

    testimony_count: u256

    created_epoch: u256
    submission_deadline_epoch: u256
    evaluation_timeout_epoch: u256

    # --- evaluation outcome, populated once EVALUATED -------------------
    verdict: str
    confidence_bps: u256
    payout_bps: u256
    rationale: str
    corroboration_json: str
    evaluated_epoch: u256

    reward_claimed: bool


@allow_storage
@dataclass
class TestimonyRecord:
    testimony_id: str
    bounty_id: str
    submitter: Address
    statement_hash: str
    evidence_urls_json: str
    is_anonymous: bool

    bond_wei: u256
    bond_deposited: u256
    bond_claimed: bool

    status: str
    consistency_bps: u256

    submitted_epoch: u256


# ======================================================================
# Nondeterministic evaluation helpers (module-level, not methods, so
# leader_fn/validator_fn closures inside evaluate_bounty() never hold a
# live reference to contract storage across the nondet boundary)
# ======================================================================


def _fetch_evidence_note(url: str) -> tuple:
    """Returns (text_note, image_bytes_or_None). Never raises for
    ordinary fetch failures — those are folded into the note itself so
    one bad evidence link can't abort the whole evaluation; genuine
    upstream errors are still classified so the validator can compare
    them meaningfully."""
    try:
        response = gl.nondet.web.get(url)
    except Exception as exc:
        return f"(evidence URL could not be retrieved: {exc})", None

    status = getattr(response, "status", None)
    if status is None:
        status = getattr(response, "status_code", 0)
    if status and 400 <= status < 500:
        return f"(evidence URL returned HTTP {status})", None
    if status and status >= 500:
        return f"(evidence URL's server returned HTTP {status})", None

    body = getattr(response, "body", None)
    content_type = ""
    try:
        headers = getattr(response, "headers", {}) or {}
        content_type = str(headers.get("content-type", "")).lower()
    except Exception:
        content_type = ""

    is_image = "image" in content_type or url.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))
    if is_image and isinstance(body, (bytes, bytearray)):
        return "(image evidence attached below)", bytes(body)

    try:
        rendered = gl.nondet.web.render(url, mode="text")
    except Exception:
        rendered = None
    if rendered:
        return str(rendered)[:2500], None
    if isinstance(body, (bytes, bytearray)):
        try:
            return body.decode("utf-8", errors="replace")[:2500], None
        except Exception:
            pass
    return "(evidence URL returned no readable content)", None

def _run_evaluation(bounty_context: dict, snapshot: list) -> dict:
    """The actual nondeterministic judgment. Runs identically whether
    called as the leader or independently re-run by a validator."""
    enriched = []
    collected_images = []
    for item in snapshot:
        notes = []
        for url in item["evidence_urls"][:MAX_EVIDENCE_URLS_PER_TESTIMONY]:
            note, image_bytes = _fetch_evidence_note(url)
            notes.append({"url": url, "note": note})
            if image_bytes is not None and len(collected_images) < 4:
                collected_images.append(image_bytes)
        enriched.append(
            {
                "testimony_id": item["testimony_id"],
                "statement_hash": item["statement_hash"],
                "evidence": notes,
            }
        )

    prompt = (
        "You are an impartial adjudicator for WitnessWeave, evaluating independent witness "
        "testimony about a real-world dispute. You are given the dispute description and, for "
        "each witness, the evidence they referenced (already fetched for you below as text "
        "summaries and/or attached images) — you do NOT have the witnesses' own written "
        "statements, only their referenced evidence, since statement text is kept private "
        "off-chain. Judge purely from the fetched evidence, the dispute description, and "
        "cross-referencing between witnesses.\n\n"
        f"DISPUTE TITLE: {bounty_context['title']}\n"
        f"DISPUTE DESCRIPTION: {bounty_context['description']}\n"
        f"EVIDENCE REQUIREMENTS: {bounty_context['evidence_requirements']}\n\n"
        "WITNESS EVIDENCE:\n"
        f"{json.dumps(enriched)}\n\n"
        "For EACH testimony_id, assign a consistency_bps score from 0 to 10000 measuring how "
        "well that witness's evidence corroborates a single coherent, plausible account of what "
        "happened (10000 = strongly corroborates the majority account; 0 = contradicts it or is "
        "unsupported/irrelevant). Then determine an overall outcome:\n"
        "- overall_confidence_bps (0-10000): how confident you are that a credible consensus "
        "account of the incident can be established at all from this evidence.\n"
        "- accepted_narrative: a 2-4 sentence factual summary of the most credible account.\n"
        "- rationale: 2-4 sentences explaining your reasoning, referencing specific evidence.\n\n"
        "Respond ONLY as strict JSON with this exact shape, no prose outside the JSON:\n"
        '{"scores": {"<testimony_id>": {"consistency_bps": <int>}, ...}, '
        '"overall_confidence_bps": <int>, "accepted_narrative": "...", "rationale": "..."}'
    )

    def _run_prompt(images):
        return gl.nondet.exec_prompt(prompt, response_format="json", images=images)

    try:
        raw = _run_prompt(collected_images if collected_images else None)
    except Exception as exc:
        # A bad image (wrong content-type detection, a redirect page mistaken
        # for image bytes, a format/size the vision model rejects) must not
        # take down the whole evaluation — that would let one malformed
        # evidence link block a bounty from ever resolving. Retry once,
        # text-only, before treating this as a genuine [LLM_ERROR]. If there
        # were no images in the first place, there's nothing to fall back
        # from, so it's a real LLM failure immediately.
        if collected_images:
            try:
                raw = _run_prompt(None)
            except Exception as exc2:
                raise gl.vm.UserError(f"{ERROR_LLM} exec_prompt failed even without images: {exc2}")
        else:
            raise gl.vm.UserError(f"{ERROR_LLM} exec_prompt failed: {exc}")

    parsed = raw if isinstance(raw, dict) else _parse_json_object(str(raw))
    if parsed is None:
        raise gl.vm.UserError(f"{ERROR_LLM} Model output was not parseable JSON")

    scores_raw = _pick(parsed, "scores", ("testimony_scores", "corroboration"))
    scores = {}
    if isinstance(scores_raw, dict):
        for tid, entry in scores_raw.items():
            if isinstance(entry, dict):
                scores[str(tid)] = {"consistency_bps": _coerce_bps(_pick(entry, "consistency_bps", ("score", "consistency")))}
            else:
                scores[str(tid)] = {"consistency_bps": _coerce_bps(entry)}

    # Any testimony the model silently omitted is treated as unscored
    # (0) rather than dropped — every submitted testimony must appear
    # in the final corroboration record.
    for item in snapshot:
        if item["testimony_id"] not in scores:
            scores[item["testimony_id"]] = {"consistency_bps": 0}

    return {
        "scores": scores,
        "overall_confidence_bps": _coerce_bps(_pick(parsed, "overall_confidence_bps", ("confidence_bps", "confidence"))),
        "accepted_narrative": _coerce_str(_pick(parsed, "accepted_narrative", ("narrative", "summary"))),
        "rationale": _coerce_str(_pick(parsed, "rationale", ("reasoning", "explanation"))),
    }

def _results_agree(leader: dict, mine: dict) -> bool:
    """The substantive-outcome comparison gate — this is what makes
    consensus mean something beyond "the JSON parsed"."""
    leader_conf = _coerce_bps(leader.get("overall_confidence_bps", 0))
    my_conf = _coerce_bps(mine.get("overall_confidence_bps", 0))
    if abs(leader_conf - my_conf) > CONFIDENCE_TOLERANCE_BPS:
        return False

    leader_scores = leader.get("scores", {}) or {}
    my_scores = mine.get("scores", {}) or {}
    all_ids = set(leader_scores.keys()) | set(my_scores.keys())
    if not all_ids:
        return True

    agreeing = 0
    for tid in all_ids:
        l_entry = leader_scores.get(tid, {})
        m_entry = my_scores.get(tid, {})
        l_score = _coerce_bps(l_entry.get("consistency_bps", 0) if isinstance(l_entry, dict) else l_entry)
        m_score = _coerce_bps(m_entry.get("consistency_bps", 0) if isinstance(m_entry, dict) else m_entry)

        # The accept/reject boundary must agree even more strictly than
        # the raw score, since it drives payout — but exact numeric
        # values are allowed to differ by up to the tolerance.
        l_side = l_score >= CORROBORATION_THRESHOLD_BPS
        m_side = m_score >= CORROBORATION_THRESHOLD_BPS
        close_enough = abs(l_score - m_score) <= PER_TESTIMONY_SCORE_TOLERANCE_BPS
        boundary_ok = (l_side == m_side) or close_enough
        if boundary_ok:
            agreeing += 1

    agreement_fraction_bps = (agreeing * 10000) // max(1, len(all_ids))
    return agreement_fraction_bps >= PER_TESTIMONY_AGREEMENT_MIN_FRACTION_BPS

def _handle_leader_error(leaders_res, bounty_context: dict, snapshot: list, leader_fn) -> bool:
    """Mirrors the leader's failure/success classification scheme so
    that "both sides transiently failed the same way" counts as
    agreement, while "leader failed but validator succeeded" (or a
    model-quality failure) always forces rotation."""
    leader_msg = getattr(leaders_res, "message", None) or str(leaders_res)
    try:
        leader_fn()
        return False  # leader failed but the validator's own run succeeded -> disagree
    except gl.vm.UserError as exc:
        validator_msg = str(exc)
        if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
            return validator_msg == leader_msg
        if validator_msg.startswith(ERROR_TRANSIENT) and ERROR_TRANSIENT in str(leader_msg):
            return True
        return False
    except Exception:
        return False

def _finalize_verdict(result: dict, snapshot: list) -> tuple:
    confidence_bps = _coerce_bps(result.get("overall_confidence_bps", 0))
    scores = result.get("scores", {}) or {}

    corroborated = 0
    total = max(1, len(snapshot))
    for item in snapshot:
        entry = scores.get(item["testimony_id"], {})
        score = _coerce_bps(entry.get("consistency_bps", 0) if isinstance(entry, dict) else entry)
        if score >= CORROBORATION_THRESHOLD_BPS:
            corroborated += 1
    corroboration_fraction_bps = (corroborated * 10000) // total

    rationale = _coerce_str(result.get("rationale", "")) or _coerce_str(result.get("accepted_narrative", ""))

    if confidence_bps >= PASS_CONFIDENCE_THRESHOLD_BPS and corroboration_fraction_bps >= CORROBORATION_THRESHOLD_BPS:
        verdict = VERDICT_PASSED
        payout_bps = 10000
    elif confidence_bps < PARTIAL_CONFIDENCE_THRESHOLD_BPS or corroboration_fraction_bps == 0:
        verdict = VERDICT_FAILED
        payout_bps = 0
    elif confidence_bps >= PARTIAL_CONFIDENCE_THRESHOLD_BPS:
        verdict = VERDICT_PARTIAL_PASS
        # Payout scales with how much of the reward-eligible testimony
        # actually corroborated, weighted by overall confidence — never
        # all-or-nothing once we're in the ambiguous middle band.
        payout_bps = (confidence_bps * corroboration_fraction_bps) // 10000
    else:
        verdict = VERDICT_NEEDS_HUMAN_REVIEW
        payout_bps = 0

    corroboration = {
        "scores": scores,
        "corroboration_fraction_bps": corroboration_fraction_bps,
        "accepted_narrative": _coerce_str(result.get("accepted_narrative", "")),
    }
    return verdict, confidence_bps, payout_bps, rationale, corroboration

class WitnessWeave(gl.Contract):
    owner: Address

    # -- virtual epoch clock -------------------------------------------
    epoch_counter: u256
    last_heartbeat_epoch: TreeMap[Address, u256]

    # -- id sequencing ----------------------------------------------------
    next_bounty_seq: u256
    next_testimony_seq: u256

    # -- primary storage ----------------------------------------------------
    bounties: TreeMap[str, BountyRecord]
    testimonies: TreeMap[str, TestimonyRecord]

    # -- compound-key child index: "{bounty_id}:{n}" -> testimony_id.
    # DynArray cannot be constructed by user code inside a dataclass field,
    # so per-bounty testimony lists are rebuilt from this index instead. ---
    bounty_testimony_index: TreeMap[str, str]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.epoch_counter = u256(0)
        self.next_bounty_seq = u256(0)
        self.next_testimony_seq = u256(0)

    # ------------------------------------------------------------------
    # Virtual epoch clock
    # ------------------------------------------------------------------

    @gl.public.write
    def heartbeat(self) -> u256:
        """Permissionlessly advances the contract's virtual clock by one
        epoch. GenVM contract code has no trusted timestamp primitive, so
        submission windows and evaluation timeouts are measured in epochs
        rather than wall-clock time. Anyone may call this at the cost of
        their own gas; a caller bumping twice within the same epoch is a
        cheap no-op (their own last-bump marker is updated either way), so
        no single caller can advance the shared clock more than once per
        epoch on their own."""
        caller = gl.message.sender_address
        last = _tm_get(self.last_heartbeat_epoch, caller, u256(0))
        if last < self.epoch_counter:
            self.last_heartbeat_epoch[caller] = self.epoch_counter
            return self.epoch_counter
        self.epoch_counter = self.epoch_counter + u256(1)
        self.last_heartbeat_epoch[caller] = self.epoch_counter
        return self.epoch_counter

    @gl.public.view
    def get_current_epoch(self) -> int:
        return int(self.epoch_counter)

    # ------------------------------------------------------------------
    # ID generation
    # ------------------------------------------------------------------

    def _next_bounty_id(self) -> str:
        seq = self.next_bounty_seq
        self.next_bounty_seq = seq + u256(1)
        return f"bounty:{int(seq)}"

    def _next_testimony_id(self) -> str:
        seq = self.next_testimony_seq
        self.next_testimony_seq = seq + u256(1)
        return f"testimony:{int(seq)}"

    # ------------------------------------------------------------------
    # Bounty creation / cancellation
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def create_bounty(
        self,
        title: str,
        description: str,
        evidence_requirements: str,
        witness_bond_wei: int,
        submission_window_epochs: int = 20,
        evaluation_timeout_epochs: int = 40,
    ) -> str:
        """Escrows the GEN reward (via gl.message.value) and opens a new
        Testimony Bounty. The reward is only ever released through settle(),
        claim_timeout_refund(), or cancel_bounty() — never anywhere else.

        Money-shaped parameters are typed as plain `int` here rather than
        `u256`, and list-shaped data is never accepted as a parameter at
        all (see submit_testimony) — GenVM's calldata schema generator only
        supports primitive parameter types (str / int / bool) on public
        methods; `u256` and `list`/`dict` are safe as internal storage and
        return types, but not as incoming parameter types."""
        _require(gl.message.value > u256(0), f"{ERROR_EXPECTED} Bounty must be funded with a positive GEN reward")
        _require(len(title) > 0 and len(title) <= 200, f"{ERROR_EXPECTED} Title must be 1-200 characters")
        _require(
            len(description) > 0 and len(description) <= MAX_TEXT_FIELD_LEN,
            f"{ERROR_EXPECTED} Description must be 1-{MAX_TEXT_FIELD_LEN} characters",
        )
        _require(
            len(evidence_requirements) <= MAX_TEXT_FIELD_LEN,
            f"{ERROR_EXPECTED} Evidence requirements too long",
        )
        _require(witness_bond_wei >= 0, f"{ERROR_EXPECTED} witness_bond_wei cannot be negative")
        _require(
            submission_window_epochs >= int(MIN_SUBMISSION_WINDOW_EPOCHS)
            and submission_window_epochs <= int(MAX_SUBMISSION_WINDOW_EPOCHS),
            f"{ERROR_EXPECTED} submission_window_epochs out of allowed range",
        )
        _require(
            evaluation_timeout_epochs > 0 and evaluation_timeout_epochs <= int(MAX_EVALUATION_TIMEOUT_EPOCHS),
            f"{ERROR_EXPECTED} evaluation_timeout_epochs out of allowed range",
        )

        bounty_id = self._next_bounty_id()
        now = self.epoch_counter
        deadline = now + u256(submission_window_epochs)

        self.bounties[bounty_id] = BountyRecord(
            bounty_id=bounty_id,
            creator=gl.message.sender_address,
            title=_coerce_str(title),
            description=_coerce_str(description),
            evidence_requirements=_coerce_str(evidence_requirements),
            status=STATUS_OPEN,
            reward_wei=gl.message.value,
            reward_deposited=gl.message.value,
            witness_bond_wei=u256(witness_bond_wei),
            testimony_count=u256(0),
            created_epoch=now,
            submission_deadline_epoch=deadline,
            evaluation_timeout_epoch=deadline + u256(evaluation_timeout_epochs),
            verdict="",
            confidence_bps=u256(0),
            payout_bps=u256(0),
            rationale="",
            corroboration_json="",
            evaluated_epoch=u256(0),
            reward_claimed=False,
        )
        return bounty_id

    @gl.public.write
    def cancel_bounty(self, bounty_id: str) -> None:
        """Creator-only, and only before any testimony has been submitted —
        once witnesses have started contributing evidence in good faith the
        bounty can no longer be silently pulled."""
        bounty = self._get_bounty_or_raise(bounty_id)
        _require(
            gl.message.sender_address == bounty.creator,
            f"{ERROR_EXPECTED} Only the bounty creator can cancel it",
        )
        _require(bounty.status == STATUS_OPEN, f"{ERROR_EXPECTED} Bounty is not cancellable in its current status")
        _require(bounty.testimony_count == u256(0), f"{ERROR_EXPECTED} Cannot cancel after testimony was submitted")

        refund = bounty.reward_deposited
        _require(refund > u256(0), f"{ERROR_EXPECTED} No reward deposited to refund")

        # zero the ledger, persist, THEN transfer — reentrancy-safe ordering
        bounty.reward_deposited = u256(0)
        bounty.status = STATUS_CANCELLED
        self.bounties[bounty_id] = bounty

        _send_gen(bounty.creator, refund)

    # ------------------------------------------------------------------
    # Testimony submission
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def submit_testimony(
        self,
        bounty_id: str,
        statement_hash: str,
        evidence_urls_json: str,
        is_anonymous: bool,
    ) -> str:
        """Registers a witness's testimony reference. The full statement
        text never touches the chain — only its hash (computed off-chain
        and re-derivable by anyone who has the original text) plus the
        public evidence URLs the contract will itself fetch during
        evaluation. If the bounty requires a witness bond, this call must
        carry exactly that amount as gl.message.value; otherwise it must
        carry none.

        `evidence_urls_json` is a JSON-encoded array of URL strings rather
        than a native `list` parameter — GenVM's calldata schema generator
        only supports primitive parameter types (str / int / bool) on
        public methods, so structured/collection data is always passed as
        a JSON string and parsed on this side, the same pattern used for
        every other list-shaped input in this contract."""
        bounty = self._get_bounty_or_raise(bounty_id)
        _require(bounty.status == STATUS_OPEN, f"{ERROR_EXPECTED} Bounty is not accepting testimony")
        _require(
            self.epoch_counter <= bounty.submission_deadline_epoch,
            f"{ERROR_EXPECTED} Submission window has closed",
        )
        _require(
            bounty.testimony_count < u256(MAX_TESTIMONIES_PER_EVALUATION),
            f"{ERROR_EXPECTED} This bounty has reached its maximum number of testimonies",
        )
        _require(
            len(statement_hash) > 0 and len(statement_hash) <= MAX_STATEMENT_HASH_LEN,
            f"{ERROR_EXPECTED} Invalid statement hash",
        )

        try:
            evidence_urls = json.loads(evidence_urls_json) if evidence_urls_json else []
        except Exception:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} evidence_urls_json must be a JSON array of URL strings")
        _require(isinstance(evidence_urls, list), f"{ERROR_EXPECTED} evidence_urls_json must be a JSON array")
        _require(
            len(evidence_urls) <= MAX_EVIDENCE_URLS_PER_TESTIMONY,
            f"{ERROR_EXPECTED} Too many evidence URLs (max {MAX_EVIDENCE_URLS_PER_TESTIMONY})",
        )
        for url in evidence_urls:
            _require(
                isinstance(url, str) and 0 < len(url) <= MAX_EVIDENCE_URL_LEN and url.startswith(("http://", "https://")),
                f"{ERROR_EXPECTED} Evidence URLs must be valid http(s) links",
            )

        if bounty.witness_bond_wei > u256(0):
            _require(
                gl.message.value == bounty.witness_bond_wei,
                f"{ERROR_EXPECTED} Must lock exactly the required witness bond",
            )
        else:
            _require(gl.message.value == u256(0), f"{ERROR_EXPECTED} This bounty does not accept a witness bond")

        testimony_id = self._next_testimony_id()
        self.testimonies[testimony_id] = TestimonyRecord(
            testimony_id=testimony_id,
            bounty_id=bounty_id,
            submitter=gl.message.sender_address,
            statement_hash=_coerce_str(statement_hash),
            evidence_urls_json=json.dumps([str(u) for u in evidence_urls]),
            is_anonymous=bool(is_anonymous),
            bond_wei=bounty.witness_bond_wei,
            bond_deposited=gl.message.value,
            bond_claimed=False,
            status=TESTIMONY_SUBMITTED,
            consistency_bps=u256(0),
            submitted_epoch=self.epoch_counter,
        )

        index_key = f"{bounty_id}:{int(bounty.testimony_count)}"
        self.bounty_testimony_index[index_key] = testimony_id
        bounty.testimony_count = bounty.testimony_count + u256(1)
        self.bounties[bounty_id] = bounty

        return testimony_id

    def _list_bounty_testimony_ids(self, bounty_id: str, count: u256) -> list:
        out = []
        for i in range(int(count)):
            key = f"{bounty_id}:{i}"
            if key in self.bounty_testimony_index:
                out.append(self.bounty_testimony_index[key])
        return out

    # ------------------------------------------------------------------
    # Evaluation — the nondeterministic core
    # ------------------------------------------------------------------

    @gl.public.write
    def evaluate_bounty(self, bounty_id: str) -> None:
        """Triggers the Intelligent Contract's evaluation of a bounty's
        testimony. May be called by anyone once the submission window has
        closed (or immediately by the creator, once at least one testimony
        exists) — evaluation is not gate-kept behind a single privileged
        caller, so a bounty can never get stuck waiting on one person.

        The actual judgment happens in a nondeterministic block executed
        via gl.vm.run_nondet_unsafe(leader_fn, validator_fn): the leader
        node fetches evidence and produces a scored judgment; every
        validator node independently re-fetches the SAME evidence and
        re-runs its OWN judgment, then checks the two agree within the
        tolerances defined above. This is what prevents the network from
        merely rubber-stamping "the leader returned syntactically valid
        JSON" as consensus."""
        bounty = self._get_bounty_or_raise(bounty_id)
        _require(
            bounty.status == STATUS_OPEN,
            f"{ERROR_EXPECTED} Bounty must be OPEN to begin evaluation",
        )
        _require(bounty.testimony_count > u256(0), f"{ERROR_EXPECTED} No testimony has been submitted yet")
        can_evaluate_early = gl.message.sender_address == bounty.creator
        _require(
            can_evaluate_early or self.epoch_counter > bounty.submission_deadline_epoch,
            f"{ERROR_EXPECTED} Only the creator may start evaluation before the submission window closes",
        )

        testimony_ids = self._list_bounty_testimony_ids(bounty_id, bounty.testimony_count)
        snapshot = []
        for tid in testimony_ids:
            t = self.testimonies[tid]
            snapshot.append(
                {
                    "testimony_id": t.testimony_id,
                    "statement_hash": t.statement_hash,
                    "evidence_urls": json.loads(t.evidence_urls_json),
                }
            )

        bounty_context = {
            "title": bounty.title,
            "description": bounty.description,
            "evidence_requirements": bounty.evidence_requirements,
        }

        def leader_fn() -> dict:
            return _run_evaluation(bounty_context, snapshot)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, bounty_context, snapshot, leader_fn)
            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False
            mine = leader_fn()
            return _results_agree(leader, mine)

        raw = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        result = raw if isinstance(raw, dict) else json.loads(raw) if isinstance(raw, str) else None
        _require(isinstance(result, dict), f"{ERROR_LLM} Evaluation did not produce a usable result")

        verdict, confidence_bps, payout_bps, rationale, corroboration = _finalize_verdict(result, snapshot)

        # Persist per-testimony corroboration status.
        scores = corroboration.get("scores", {})
        for tid in testimony_ids:
            t = self.testimonies[tid]
            score = _coerce_bps(scores.get(tid, {}).get("consistency_bps", 0))
            t.consistency_bps = u256(score)
            t.status = TESTIMONY_CORROBORATED if score >= CORROBORATION_THRESHOLD_BPS else TESTIMONY_DISPUTED
            self.testimonies[tid] = t

        bounty.status = STATUS_EVALUATED
        bounty.verdict = verdict
        bounty.confidence_bps = u256(confidence_bps)
        bounty.payout_bps = u256(payout_bps)
        bounty.rationale = rationale[:MAX_TEXT_FIELD_LEN]
        bounty.corroboration_json = json.dumps(corroboration)[:8000]
        bounty.evaluated_epoch = self.epoch_counter
        self.bounties[bounty_id] = bounty


    # ------------------------------------------------------------------
    # Settlement — fully deterministic, no nondet work here
    # ------------------------------------------------------------------

    @gl.public.write
    def settle(self, bounty_id: str) -> None:
        """Pays out the bounty according to the verdict already recorded by
        evaluate_bounty(). Deliberately deterministic and separate from the
        nondet evaluation step: money movement should never itself be part
        of a nondeterministic block. Every branch re-derives amounts from
        the stored ledger fields (never a parameter) and follows the
        zero-then-transfer ordering."""
        bounty = self._get_bounty_or_raise(bounty_id)
        _require(bounty.status == STATUS_EVALUATED, f"{ERROR_EXPECTED} Bounty is not ready to settle")
        _require(not bounty.reward_claimed, f"{ERROR_EXPECTED} Reward has already been settled")

        reward = bounty.reward_deposited
        _require(reward > u256(0), f"{ERROR_EXPECTED} No reward deposited")

        if bounty.verdict == VERDICT_NEEDS_HUMAN_REVIEW:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} This bounty needs human review before it can settle; "
                "re-run evaluate_bounty with additional evidence, or wait for claim_timeout_refund."
            )

        # zero the ledger, persist, THEN transfer
        bounty.reward_deposited = u256(0)
        bounty.reward_claimed = True
        bounty.status = STATUS_RESOLVED
        self.bounties[bounty_id] = bounty

        if bounty.verdict == VERDICT_FAILED:
            _send_gen(bounty.creator, reward)
            return

        # PASSED or PARTIAL_PASS: split the reward across corroborating
        # witnesses, proportional to their individual consistency score,
        # scaled by the bounty-level payout_bps. Any remainder (from
        # partial payout or rounding) returns to the creator.
        testimony_ids = self._list_bounty_testimony_ids(bounty_id, bounty.testimony_count)
        corroborating = []
        total_score = 0
        for tid in testimony_ids:
            t = self.testimonies[tid]
            if t.status == TESTIMONY_CORROBORATED:
                corroborating.append(t)
                total_score += int(t.consistency_bps)

        payout_pool = (reward * bounty.payout_bps) // BPS_DENOMINATOR
        distributed = u256(0)

        if corroborating and total_score > 0 and payout_pool > u256(0):
            for t in corroborating:
                share = (payout_pool * u256(int(t.consistency_bps))) // u256(total_score)
                if share > u256(0):
                    _send_gen(t.submitter, share)
                    distributed = distributed + share

        remainder = reward - distributed
        if remainder > u256(0):
            _send_gen(bounty.creator, remainder)

    # ------------------------------------------------------------------
    # Timeout / recovery exits — funds can never be locked forever
    # ------------------------------------------------------------------

    @gl.public.write
    def claim_timeout_refund(self, bounty_id: str) -> None:
        """Permissionless recovery: if a bounty's evaluation timeout has
        passed without reaching RESOLVED, anyone may trigger a full refund
        of the still-deposited reward back to the creator. This is the exit
        path that guarantees funds are never locked forever even if
        evaluation is never triggered or repeatedly fails to reach
        consensus."""
        bounty = self._get_bounty_or_raise(bounty_id)
        _require(
            bounty.status in (STATUS_OPEN, STATUS_EVALUATING, STATUS_EVALUATED),
            f"{ERROR_EXPECTED} Bounty is not eligible for a timeout refund",
        )
        _require(
            self.epoch_counter > bounty.evaluation_timeout_epoch,
            f"{ERROR_EXPECTED} Evaluation timeout has not yet passed",
        )
        _require(not bounty.reward_claimed, f"{ERROR_EXPECTED} Reward has already been settled")

        refund = bounty.reward_deposited
        _require(refund > u256(0), f"{ERROR_EXPECTED} No reward deposited to refund")

        bounty.reward_deposited = u256(0)
        bounty.reward_claimed = True
        bounty.status = STATUS_TIMED_OUT
        self.bounties[bounty_id] = bounty

        _send_gen(bounty.creator, refund)

    @gl.public.write
    def claim_bond_refund(self, testimony_id: str) -> None:
        """Each witness independently reclaims their own bond once the
        parent bounty has reached a terminal state (RESOLVED, TIMED_OUT, or
        CANCELLED). Kept as a separate per-witness claim rather than being
        bundled into settle() so one witness's failed/absent claim can
        never block anyone else's, and so a witness can always recover
        their own bond even if the reward side is still stuck."""
        _require(testimony_id in self.testimonies, f"{ERROR_EXPECTED} Testimony not found")
        t = self.testimonies[testimony_id]
        _require(
            gl.message.sender_address == t.submitter,
            f"{ERROR_EXPECTED} Only the submitting witness can claim their bond",
        )
        _require(not t.bond_claimed, f"{ERROR_EXPECTED} Bond already claimed")

        bounty = self._get_bounty_or_raise(t.bounty_id)
        _require(
            bounty.status in (STATUS_RESOLVED, STATUS_TIMED_OUT, STATUS_CANCELLED),
            f"{ERROR_EXPECTED} Bond cannot be claimed until the bounty reaches a final state",
        )

        bond = t.bond_deposited
        _require(bond > u256(0), f"{ERROR_EXPECTED} No bond deposited for this testimony")

        t.bond_deposited = u256(0)
        t.bond_claimed = True
        self.testimonies[testimony_id] = t

        _send_gen(t.submitter, bond)

    # ------------------------------------------------------------------
    # Internal lookups
    # ------------------------------------------------------------------

    def _get_bounty_or_raise(self, bounty_id: str) -> BountyRecord:
        if bounty_id not in self.bounties:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not found")
        return self.bounties[bounty_id]

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @gl.public.view
    def get_bounty(self, bounty_id: str) -> str:
        if bounty_id not in self.bounties:
            return json.dumps({"error": "not_found"})
        b = self.bounties[bounty_id]
        return json.dumps(
            {
                "bounty_id": b.bounty_id,
                "creator": b.creator.as_hex,
                "title": b.title,
                "description": b.description,
                "evidence_requirements": b.evidence_requirements,
                "status": b.status,
                "reward_wei": str(b.reward_wei),
                "reward_deposited": str(b.reward_deposited),
                "witness_bond_wei": str(b.witness_bond_wei),
                "testimony_count": int(b.testimony_count),
                "created_epoch": int(b.created_epoch),
                "submission_deadline_epoch": int(b.submission_deadline_epoch),
                "evaluation_timeout_epoch": int(b.evaluation_timeout_epoch),
                "verdict": b.verdict,
                "confidence_bps": int(b.confidence_bps),
                "payout_bps": int(b.payout_bps),
                "rationale": b.rationale,
                "corroboration": json.loads(b.corroboration_json) if b.corroboration_json else None,
                "evaluated_epoch": int(b.evaluated_epoch),
                "reward_claimed": b.reward_claimed,
            }
        )

    @gl.public.view
    def get_testimony(self, testimony_id: str) -> str:
        if testimony_id not in self.testimonies:
            return json.dumps({"error": "not_found"})
        t = self.testimonies[testimony_id]
        return json.dumps(
            {
                "testimony_id": t.testimony_id,
                "bounty_id": t.bounty_id,
                "submitter": t.submitter.as_hex,
                "statement_hash": t.statement_hash,
                "evidence_urls": json.loads(t.evidence_urls_json),
                "is_anonymous": t.is_anonymous,
                "bond_wei": str(t.bond_wei),
                "bond_deposited": str(t.bond_deposited),
                "bond_claimed": t.bond_claimed,
                "status": t.status,
                "consistency_bps": int(t.consistency_bps),
                "submitted_epoch": int(t.submitted_epoch),
            }
        )

    @gl.public.view
    def get_bounty_testimonies(self, bounty_id: str) -> str:
        if bounty_id not in self.bounties:
            return json.dumps({"error": "not_found"})
        bounty = self.bounties[bounty_id]
        ids = self._list_bounty_testimony_ids(bounty_id, bounty.testimony_count)
        return json.dumps(ids)

    @gl.public.view
    def get_contract_info(self) -> str:
        return json.dumps(
            {
                "owner": self.owner.as_hex,
                "current_epoch": int(self.epoch_counter),
                "total_bounties": int(self.next_bounty_seq),
                "total_testimonies": int(self.next_testimony_seq),
            }
        )