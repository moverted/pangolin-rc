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

- `Comment` copy is scope-generic. Card scope (episode/season/series) is already handled by
  `buildReflectionCard`.
- Season wrap: "next" = next season's E1 → the `Next season` branch. Series end: no next → `Done`.
- The audio clip anchors to the finale episode for season/series (as today).

## Staging
1. **Chip flow (visible)** — the Step 1–4 chips + next-action branches, scope-aware. Prototype
   first (`flow.html`), then wire into the real reflection flow.
2. **Deferred commit + `Journal` private store.**
3. **Share-from-logs** affordance.

## Open
- `Journal` private store: a new note table, or a `private=1` flag on the existing reflection +
  exclude from co-view? (leaning: a flag — less surface.)
- Recorded + `Journal`: keep the audio (private) or transcript-only? (leaning: keep the audio,
  private, so it can become `Share audio` later.)
- Exact `Remind me` wording per WoW drop label.
