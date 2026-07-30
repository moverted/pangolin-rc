# COMMENT_CLIP_SHARE.md — the reflection → comment → clip/share/journal flow

> One global flow for finishing an **episode**, **season**, or **series**. Replaces the
> current "Tell me what you made of it → Skip/Spoiler → Share" path. Walkthrough prototype:
> `http://localhost:8792/flow.html`.

## The flow

**Step 1 — after a finish, two chips:** `Comment` · `‹next action›`

The next-action chip adapts to what's actually next (reuses the WoW/finale logic):

| Situation | Chip | Then |
|---|---|---|
| Next episode is available now | `Watch next episode` | → the next episode's log face |
| Caught up; next airs later | `Next episode Thursday` (air day) | → `Remind me` · `Done` |
| Season done; another season coming | `Next season` | → `Remind me` · `Done` |
| Series over | `Done` | → back to the Watch face |

`Remind me` = the existing notify/WoW drop reminder. `Done` = dismiss (series → Watch face).

**Step 2 — `Comment`** → blink the 🎙️ mic + the chat box (cue to record or type). The member
records a voice clip **or** types.

**Step 3 — after the input lands:** `Spoiler` · `No spoiler` (an explicit choice, not a toggle).

**Step 4 — save/share:**
- **Typed** → `Share` · `Journal`
- **Recorded** → `Share text` · `Share audio` · `Journal`
  - `Share text` = the still card (uses the transcript).
  - `Share audio` = the 9:16 video with the voice clip.
  - **If `Spoiler` was chosen, drop `Share audio`** — the audio would speak the spoiler aloud
    even though the card hides the quote. (Recorded + spoiler → `Share text` · `Journal`.)

## What the choices mean (data)

- **`Share` / `Share text` / `Share audio`** → committed as a **co-view comment** (friends hear
  it at the right moment) **and** an external share card/clip is offered.
- **`Journal`** → **private to the member**, saved in their **logs**, **NOT** a co-view comment
  friends hear. It stays **shareable later** from the logs.

## Two parts that are more than chips

1. **Deferred commit (the private-journal path).** Today a recorded reflection is uploaded as a
   co-view comment the instant recording stops — before any spoiler/share choice. For `Journal`
   to be private, the commit must move to **after** Step 4: record/type → choose spoiler →
   choose share/journal → *then* persist as either a public co-view comment (Share*) or a
   private log note (Journal). Needs: hold the clip/text client-side; a private-note store
   (or a `private` flag on the reflection that keeps it out of the co-view feed).

2. **Share-from-logs, later.** "Shareable at a later time" → the log face needs a **Share**
   affordance on past reflections (public or journaled) that **regenerates the card/video on
   demand** (the earlier "attach the card to the show" idea, folded in here).

## Scope notes

- `Comment` copy is scope-generic. Card scopes: **episode / movie / season / series** in
  `buildReflectionCard`.
- **Movie** (a single film): card reads "just watched ‹Movie›" + "N comments on this movie"
  + the hidden-times list (like an episode). Keyed on `'🎬'` (the movie comment key), so the
  count + recorded reflection line up. `pierreFinishedNote` sends `scope:'movie'`, `ep:'🎬'`.
  **Next-action = `Done` for now.**
  - **TODO(sequels):** a movie's "next" will eventually be a sequel / same-universe pick
    (a franchise ordering). Until then every movie is `Done`. Marked in
    `nextActionChip` and `pierreFinishedNote`.
- Season wrap: "next" = next season's E1 → the `Next season` branch. Series end: no next → `Done`.
- The audio clip anchors to the finale episode for season/series (as today).

## Staging
1. ✅ **Chip flow (visible)** — DONE + deployed (Step 1–4 chips + next-action branches).
2. ✅ **Private `Journal` store** — DONE + deployed. `watch_comment.private` (migration 0025);
   recorded reflections upload `private=1`; `Share` flips them public via
   `POST /transcribe/comments/:id/publish`; co-view feed excludes `private=1`. Chose the
   flag-flip over a full deferred commit (mic still uploads on stop, just private).
   Resolved opens: flag (not a new table); recorded+Journal keeps the audio (private).
3. ✅ **Share-from-logs** — DONE. Each of the member's own reflections + audio comments in
   the WATCH-face archive gets a `Share` button (`.rf-share`) → `reshareFromLog` routes to
   Pierre `intent:'reshare'` → `enterReshareFlow` rebuilds the card from the existing text
   (+ audio URL / comment id) and runs the spoiler → Share/Journal step. Publishing a
   journaled one is `publishReflection` (no-op if already public), so no Worker change.
   **Bug fix (step 0):** recorded reflections no longer double-save (a `/reflection` row is
   only written for TYPED reflections now — the recorded one lives as its `watch_comment`);
   existing dupes de-duped on prod D1 (44 → 40 rows, 0 dupes).

## Open
- `Journal` private store: a new note table, or a `private=1` flag on the existing reflection +
  exclude from co-view? (leaning: a flag — less surface.)
- Recorded + `Journal`: keep the audio (private) or transcript-only? (leaning: keep the audio,
  private, so it can become `Share audio` later.)
- Exact `Remind me` wording per WoW drop label.

---

# Revision — 2026-07-29: end-notes, the guided fork, and the one-reply lock

> This section is authoritative and supersedes the parts of the flow above that it
> contradicts (the reflection's minute-anchored comment, the `Spoiler` toggle, the
> `Share text` label on the spoiler branch, and the mic/input living in the shell band).
> **Freeze is deliberately broken here** — no testers are in yet (see CLAUDE.md freeze
> rule). Any Worker/D1/deploy touch logs to BACKEND.md same-session.

## Vocabulary

- **In-episode comment** — a scrub-anchored comment made *while watching*. Labeled with a
  timecode (`S03E05 0:19 …`). Always treated as a spoiler; revealed to a friend once they
  pass that mark. Capped at **5 originals per episode** (unchanged).
- **End-note** — the *end-of-episode* reflection made from the Pierre finish flow. This is a
  new, distinct kind (`watch_comment.is_endnote = 1`). **Capped at 1 per episode**, counted
  **separately** from the 5-cap. It is labeled with an explicit spoiler tag instead of a
  timecode, and it is **not repliable**.

## 1. End-note label (replaces the minute marker)

An end-note renders `S03E05  SPLR  …` or `S03E05  NOSP  …` — episode-level, no timecode. The
old `0:29` (runtime minute) is dropped from the display. The comment is still stored so it can
sort after in-episode comments, but the **reveal gate is the finish event, not a minute**
(episode runtimes drift, so a computed minute is unreliable):

- `watch_comment.reveal_on = 'finish'` — the end-note reveals to a friend when *they* mark the
  episode finished (`epDone`), regardless of timecode.
- **Both SPLR and NOSP reveal in-app on finish — identical gate.** NOSP's "safe" quality only
  matters on the *external* share card (NOSP is a calling card for the episode; SPLR hides the
  quote on the card). Neither reveals earlier in-app.
- `reveal_on` is stored as an explicit marker (not a derived minute) so a **later pass** can
  change reveal semantics per-kind without a migration or touching existing rows.

## 2. The guided finish flow (Pierre)

The whole point of the redesign: at each decision point, show **only the choices that matter**
— hide the text box, the send arrow, and the mic — and guide the member chip-by-chip.

**Step 0 — mic relocation (structural).** The Pierre mic moves **out of the shell console band
and into the face composer**, at the send-arrow position (`[ input ][ mic | send ]`). This makes
input + mic + send one hideable unit in the face (atomic show/hide on every branch) and removes
the blink-then-settle jump (the mic no longer lives in the band). The chat-picker stays in the
band, re-centered between the device picker and the floating cube, and is **hidden for the whole
finish flow**.

**Step 1 — the fork.** `You finished ‹X›.` with exactly two chips: `Comment` · `‹next action›`.
**Input, mic, and arrow are hidden here** — the member picks a chip, nothing else.

**Step 2 — `Comment`.** Reveal the composer (input + mic) and cue it. Record audio or type.
**No LLM turn** — the reflection is *not* sent to Pierre as a chat turn (that was the source of
the "signal was dropped, say that again?" misfire). Go straight to Step 3 when the input lands.

**Step 3 — spoiler, with a guess.** `Spoiler` · `No spoiler` as an explicit two-chip choice
(not a toggle). Pierre pre-highlights a **guess** and phrases it: *"That sounds like a spoiler —
confirm, or tap No spoiler to overrule."* The guess is a **local heuristic** (offline, instant —
no LLM, so it can't reintroduce the dropped-signal failure). **Fallback when the heuristic has no
signal: neutral `Spoiler` / `No spoiler`, nothing pre-highlighted.** Input/mic/arrow hidden here.

**Step 4 — save/share.** Input/mic/arrow hidden.
- **Spoiler branch:** `Share` · `Journal`. (Recorded-and-spoiler still drops `Share audio` — the
  audio would speak the spoiler.) The user-facing label is **`Share`** because a spoiler card
  hides the quote — you're sharing the milestone, not the words. **Backend label: `shareSpoiler`.**
- **No-spoiler branch:** the full set — `Share text` · `Share audio` (recorded) · `Journal`.
  This branch also gets the **edit controls** (below).

**Edit controls (no-spoiler branch).** Port the in-episode edit popup onto Pierre for
familiarity: **playback · delete · re-record**. Server-side transcript editing stays **edit-once**
(the existing `409 "already corrected once"`); the escape hatch is **delete and start over**, not
a second correction. On **any** change (re-record or retype), re-open the spoiler choice — Pierre
asks *"still No spoiler / Spoiler?"* (dumb: any change re-prompts; no semantic-diff yet).

**Step 5 — after Share (or Journal; Journal is identical minus the toaster):** navigate.

| Situation | Destination after the toaster |
|---|---|
| Next episode available now | LOG face, next episode, ready to start (not started) |
| Season done, next season exists | LOG face, next season's E1 |
| Caught up — next airs later | Watch face (Pierre may offer `Remind me`) |
| Series over | Stay on Pierre — he guides to chat / watch something else (chips or conversational) |

This reuses the existing `nextActionChip` destinations, so the `Comment` path and the
`Watch next episode` path converge on the same place — "comment then go" vs "just go."

## 3. Replies and the one-reply lock (in-episode comments only)

Containment principle: **the Pierre finish flow produces exactly one artifact — your own
end-note (or its journal). Nothing reactive ever enters that flow.** All reply activity lives on
the LOG-face co-view panel using the existing reply machinery (audio via OTT record, or text).

- **End-notes are not repliable.** You react to a friend's end-note by leaving your *own*
  end-note (your 1 per episode), never a reply.
- **In-episode comments take at most one reply, first-come-first-locked.** Once a comment has a
  reply, its reply affordance disappears for everyone. Two friends → the first to reply wins; the
  second is locked out of *that* comment but may reply to any other un-replied comment. A third
  viewer hears the original + the reply and can only reply to comments that have none.
- **Depth-1.** A reply is itself a reply, so it never carries its own reply affordance. Max
  thread size is always 2 (comment + reply).
- **Replies inherit the finish/mark gate** of their parent — no spoiler choice, no Pierre flow,
  no re-trigger of anyone's finish flow. They appear in the co-view panel (+ existing optional
  SMS hand-off).
- Replies stay **audio and/or text** (both existing paths kept).

## 4. Data / schema — migration `0026`

1. **`UNIQUE(reply_to)`.** `reply_to` currently allows many replies per parent in principle.
   Checked prod 2026-07-29: **5 replies, 5 distinct parents — zero multi-reply parents**, so the
   index can be added **directly, no dedupe step**. `CREATE UNIQUE INDEX … ON
   watch_comment(reply_to) WHERE reply_to IS NOT NULL`. The unique index enforces "one reply per
   comment" atomically (first write wins; the second reply is rejected and the client shows
   "already answered"). If prod ever grows a multi-reply parent before this ships, dedupe
   keep-earliest first.
2. **`is_endnote INTEGER NOT NULL DEFAULT 0`** — marks the end-note kind (drives the label, the
   1-cap, non-repliability, and reveal-on-finish).
3. **`spoiler INTEGER NOT NULL DEFAULT 0`** — persists the explicit SPLR/NOSP choice (today the
   spoiler toggle is client-only and unsaved).
4. **`reveal_on TEXT`** — `'finish'` for end-notes; null/`'mark'` for in-episode. The deferred
   flag for a later reveal-semantics pass.

Reply cap needs **no** column or constant — it is structural (the unique index).
