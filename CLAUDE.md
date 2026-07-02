# pangolinRC — Core Remote-Control Mechanics

> **What this is.** The content-free mechanical spine for pangolinRC: the actors, state machine, lifecycle, control surfaces, and access rules that govern how a payload moves from *submitted* to *revealed* to *revoked*. Everything domain-specific (subject matter, labels, copy, links, endpoints, and policy defaults) is intentionally left out and marked as a `SEAM`. This document describes *mechanism*; instances supply *content and policy*.
>
> **What this is NOT.** Not a database schema, not wiring, not the build for any one product. Connections and tables are deliberately deferred — the seams below mark exactly where they attach.

---

## Cube map (canonical vocabulary)

The instance UI is a 3D cube; each of its six faces is a self-contained page loaded into an iframe, hosted and routed by the shell. This table is the single source of truth for face naming — all docs, comments, and prompts defer to it. Filenames follow `cube_<name>_face.html` (lowercase). Face label is the label shown on the cube in the UI.

| Face label | Filename | Job |
|---|---|---|
| FEED | `public/cube_feed_face.html` | The latest drops — the surfaced feed of new content. |
| WATCH | `public/cube_watch_face.html` | The show list — decide what to watch. |
| PIERRE | `public/cube_pierre_face.html` | Your host — the keyboard-driven chat face. |
| PROFILE | `public/cube_profile_face.html` | That's you — account, devices, and profile. |
| LOG | `public/cube_log_face.html` | Your viewing log — track and log your progress. |
| BROWSE | `public/cube_browse_face.html` | Get in on it — the join/browse face. UI label JOIN, filename browse, label/file reconciliation pending product decision. |
| _(shell — not a face)_ | `public/index.html` | Root shell (Pages site root). Bootstraps the cube: face loading, iframe wiring, flag passing. |
| _(nav surface — not a face)_ | `public/clickwheel.*` | Click-wheel nav interaction surface, extracted from the shell. **In active development.** |

> Note: the shell is `public/index.html` (the Pages site root) and stays that name — it is deliberately not renamed to the face pattern, and renaming the root would change serving behavior. The click-wheel interaction is being extracted out of the shell into `clickwheel.*` (`.html` if it carries markup, `.js` if script-only), loaded by `index.html`; until that lands the code still lives inline in `index.html`. `WATCH`/`LOG` labels are intentionally swapped relative to their historical filenames (`cube_watch_face.html` was `cube_face_log.html`; `cube_log_face.html` was `pangolin_episodes_face_v5.html`).

---

## 0. First principle

> **Anyone permitted may submit. Only the authority may reveal.**

Capture/submission and reveal/publish are *decoupled*. A payload can exist, be grouped, and be processed long before — or without ever — being revealed. This asymmetry is the spine of the remote control and the one thing that should never become configurable.

Everything else (who counts as "permitted," what "reveal" exposes, how long things live) is parameterized.

---

## 1. Actors

| Actor | Can | Cannot |
|---|---|---|
| **Submitter** | create, upload, and group a payload; access *their own* raw payload until purge | reveal, see others' payloads, alter state |
| **Authority** | advance/reject state, reveal, revoke, purge, configure policy for resources they own | bypass audit log |
| **Consumer** | access a payload *only* in revealed state, per the access matrix | see anything unrevealed |
| **System** | run async processing, enforce limits, emit integration events | reveal (reveal is always an authority act) |

`SEAM:identity` — who maps to which role, and how affiliation is determined, is supplied by the instance.

---

## 2. Entities

- **Resource** — the logical slot that submissions attach to. Server-authoritative; identified by stable keys, never device clocks.
- **Submission** — one submitter's payload attached to a Resource. Multiple submissions per Resource is expected and supported.
- **Payload** — the raw bytes (+ a canonical/derived copy once revealed).
- **Policy** — the per-tenant/per-resource config that gates everything. `SEAM:policy`.
- **AuditEntry** — append-only record of every state transition and reveal/revoke/purge.

---

## 3. State machine

```
        submit            process            reveal
draft ──────────▶ pending ───────▶ ready ──────────▶ revealed
                     │               │                  │
                     │ reject        │ reject           │ revoke
                     ▼               ▼                  ▼
                  rejected        rejected          unrevealed ──▶ (re-reveal allowed)
                                                       │
                                                       │ purge
                                                       ▼
                                                    purged
```

- `draft` exists only on the client (local-first). Server first sees `pending`.
- `reject` purges the raw payload.
- `reveal` and `revoke` are authority-only and always audited.
- `purge` is terminal and irreversible.

Visibility is a pure function of state — see the access matrix (§6).

---

## 4. Lifecycle / pipeline

1. **Capture (local-first).** Payload is created and persisted on the client *before* any connectivity; survives app kill, network loss, offline. `SEAM:capture` — what a payload *is* (audio, text, file, event) is instance-defined; the pipeline treats it as bytes + metadata.
2. **Submit.** `POST {resource}/submissions` → returns `{submission_id, upload_targets}`. Creates a Submission in `pending`, attached to a Resource (server resolves/creates the Resource from confirmed identifiers, not client clocks).
3. **Upload (resumable, hostile-network-tolerant).** Chunked, retryable, resumes from last confirmed chunk. Idempotent on `submission_id`.
4. **Group.** All submissions sharing a Resource attach to the same slot. Grouping is server-authoritative and coordination-safe (one writer per Resource).
5. **Process.** Async jobs run post-upload (validation, derivation, quality scoring, etc.). `SEAM:processing` — the actual jobs are instance-defined; the mechanic is "queue work, advance to `ready` on success, `rejected` on failure."
6. **Reveal.** Authority publishes a Submission (or the Resource). Canonical copy written to the distribution path; revocable short-lived access opens.
7. **Revoke.** One action → purge distribution copy + rotate access keys + delist + emit event. Target propagation fast (sub-minute). Audited.
8. **Purge.** Terminal deletion of raw + derived bytes.

---

## 5. Control surfaces (the "remote control")

The RC exposes four surfaces. Each is a thin command layer over the state machine — no surface mutates state except through audited commands.

| Surface | Commands |
|---|---|
| **Submitter** | `submit`, `upload`, `read_own`, `withdraw` |
| **Authority** | `advance`, `reject`, `reveal`, `revoke`, `purge`, `configure_policy` |
| **Consumer** | `access` (gated by state + access matrix) |
| **Integration** | subscribe to events; read-only revealed data |

Sensitive control surfaces (reveal/revoke/policy) stay on the core domain and are never delegated to external surfaces. `SEAM:routes` — concrete route prefixes/hosts supplied by the instance; keep them out of this doc.

---

## 6. Access-control matrix

| State | Submitter | Consumer | Integration | Authority |
|---|---|---|---|---|
| pending / ready | own payload only | — | — | full |
| revealed (open) | ✓ | ✓ | ✓ | full |
| revealed (restricted) | ✓ (if permitted) | gated by `SEAM:policy` | metadata only, no stream URL | full |
| unrevealed / rejected | own (until purge) / — | — | — | full |
| purged | — | — | — | audit only |

Invariants:
- Access to revealed payloads is always **short-lived + revocable** (versioned signed access). No permanent public object URLs, ever.
- A submitter always retains access to *their own raw payload* until purge.

---

## 7. Cloudflare primitive mapping

Now that Cloudflare is connected, the mechanics land on these primitives. (Bindings are seams — names/IDs are instance config.)

| Mechanic | Primitive |
|---|---|
| App shell / site | **Pages** |
| Control plane / command API | **Workers** |
| Relational state (Resource, Submission, Policy, Audit) | **D1** `SEAM:db` |
| Payload storage (raw + canonical) | **R2** `SEAM:bucket` |
| Signed-access key versions, revocation flags, cached revealed metadata | **KV** |
| Post-upload processing | **Queues** `SEAM:jobs` |
| Per-Resource coordination (grouping, single-writer, locks) | **Durable Objects** |
| Identity / abuse at the edge | **Access / Turnstile** `SEAM:identity` |
| Media derivation (only if payloads are media) | **Stream** (optional) |

The Durable Object per Resource is what makes "many submitters, one slot" safe without clock-based reconciliation.

---

## 8. Policy & gating (`SEAM:policy`)

Policy is read *before* surfaces render. Defaults are NOT baked into the core — these are the dials an instance sets:

- capability on/off per tenant (off → control does not render)
- who counts as a permitted submitter
- reveal model: per-item / auto-reveal-with-cancel-window / restricted-visibility tier
- retention / purge timing
- abuse caps (per-actor rate, payload size, quarantine for unaffiliated submitters)

If a value would differ between two products pangolinRC drives, it belongs here, not in mechanism.

---

## 9. Integration surface

- Emit events on transitions: `submission.revealed`, `submission.revoked`, etc. `SEAM:events`
- External surfaces get **read-only revealed data**; never a control embed.
- All outbound integration is event-driven; no synchronous external reveal path.

---

## 10. Abuse & integrity

- Trust **server receipt + confirmed identifiers**, never device clocks.
- Per-actor caps + payload-size caps enforced at submit.
- Unaffiliated submissions quarantined (visible to authority, flagged), not silently dropped. `SEAM:policy`
- Every reveal/revoke/purge is append-only audited.

---

## 11. Build order (with Cloudflare live)

Wire in this sequence so each layer is testable before the next:

1. Workers control plane + D1 state machine (no payloads yet) — exercise `draft → … → revealed → unrevealed` with stub records.
2. R2 + resumable upload + idempotent submit.
3. Durable Object per Resource for grouping/single-writer.
4. KV signed-access + revocation; prove sub-minute revoke propagation.
5. Queues processing → `ready`/`rejected`.
6. Events / integration surface last.

**Spike first:** local-first capture survival (kill/offline/resume), and revoke propagation latency. These are the two mechanics most likely to bite.

---

## 12. Deliberately deferred (the seams, collected)

`identity` · `policy` · `capture` (what a payload is) · `processing` (the jobs) · `routes/hosts` · `db` · `bucket` · `jobs` · `events` — plus all copy, labels, and links.

These are intentionally unbuilt. Fill them per-instance; do not let any of them leak upward into the mechanics above.
