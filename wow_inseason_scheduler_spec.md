# WoW_inSeason_scheduler — Discovery

**Spec v1.0** | July 26, 2026

*Design record for the in-season scheduler. Not a cube face: the first shared service the faces read. Portable note, same method as the Episodes face doc.*

Versioning: this doc is the spec version (1.0.x for tweaks, 1.x for model changes). Build log entries below are drafts (d1 to d4), internal to this doc. Product ship scope is separate: v1 is in-app for Lanterns, v1.1 adds push.

Target: live for Lanterns (HBO Max, Sundays 9pm ET, Aug 16 to Oct 4, 8 episodes, weekly). Ship by Aug 13 so the premiere RAMP is the cohort recruitment moment. SNW S4 is in season now and is the free live testbed.

---

## Job

For any followed show with a future airstamp, derive where the week is in the drop cycle and how this user watches this show, and set the mood of every surface accordingly. It is not a notification system and not a face. It is a shared clock plus a per-user, per-show watch profile. The user drives; the app is a tool to help them watch the way they want to watch.

---

## Spec

### The weekly cycle (airWindow x timeNow)

All phases derived from TVMaze `airstamp` (exact datetime, tz-aware) in the user's local time.

| Phase | Window | Feel |
|---|---|---|
| LIVE | T0 to T+3h | Drop night. Live logging, Cooler at max heat, spoiler gate at its loudest |
| FRESH | T+3h to T+48h | Post-air reactions, completion-gated. Laggards see "episode is out, X of your cohort has watched" |
| SETTLED | T+48h to T-72h | Quiet middle. Digest of cohort takes for the caught-up |
| RAMP | T-72h to T-2h | Anticipation. Countdown, next-ep tease (number and title only), catch-up nudges |
| PRE-SHOW | T-2h to T0 | "Tonight." Pre-air speculation thread, spoiler-safe by definition |

- In-season means a future episode airstamp exists within 14 days.
- Finale transitions to a one-week SEASON WRAP state, then dormant.
- Dormant shows never activate anything. Binge drops never enter the cycle, which is the point.

### watchMode (userWatchBehavior, per user AND show)

Not a user trait. A user can be LIVE for Lanterns and MORE! for Slow Horses; both are correct. Derived from the delta between each watch timestamp and the episode airstamp, plus session clustering (the existing 3-in-24h binge flag).

| Mode | Meaning | Origin |
|---|---|---|
| LIVE | Deltas consistently inside the LIVE window | Derived or chosen |
| FRESH | Consistently inside 48h | Derived or chosen |
| CASUAL | Consistent but offset. A pattern, not a problem | Derived or chosen |
| MORE! | Followed, saving up, watches in bursts. A demand, not a description | Derived or chosen |
| UNSAMPLED | 0 or 1 episodes logged. Never classify, never nudge | Derived only, renders blank |
| DECLINED | User explicitly cleared the chip. "Stop guessing" | Chosen only, renders blank |

Every claimable name is a stance the user would own, never a grade the app assigns.

### The mode chip (single control point)

- Lives on the show card on the watch face. Always visible when a mode is set or claimable.
- Tap to cycle LIVE / FRESH / CASUAL / MORE! / blank. Explicit blank stores DECLINED.
- Hidden while UNSAMPLED. An empty chip is a question the user did not ask.
- Manual set always beats the classifier and freezes it for that show until cleared.
- Every nudge deep-links to this chip. No nudge carries its own settings UI.

### Nudge law

1. Maximum one nudge per show per weekly cycle.
2. Nudges fire only during RAMP.
3. Silence is the default for MORE!, UNSAMPLED, and DECLINED.
4. No nudge ever fires without the mode-correction affordance attached.
5. Urgency is earned by the user's own pattern, never by the calendar alone.

Per-mode copy:

- LIVE or FRESH, one behind, night before drop: "You have tonight to watch S1E5 before S1E6 drops!"
- CASUAL: spoiler-deadline framing only, no urgency.
- MORE!: silent all season. One message at wrap: "MORE! is ready. All 8 episodes."

### The two-strike consent rule

- DECLINED is a hard signal. The second explicit DECLINED, ever, turns the classifier off globally: chips gone, nudges stopped.
- One-time message: "You can turn this back on in your profile, but Pierre won't guess your watch habits anymore."
- Exception: if the user has interacted with the feature in other positive ways (manually set a mode on another show, shared a badge, acted on a nudge), DECLINED is treated as per-show preference and does not count toward the global kill.
- Re-enable lives in profile. The classifier restarts against the full existing log, since watch logging never stopped; accurate modes return immediately.

### Badges (retroactive recognition, never targets)

- LIVEwatcher: 6 of 8 episodes watched inside the LIVE window. Per user, show, season.
- BINGEwatcher: season completed in 2 or fewer sittings, or a finale-week run.
- Awarded at SEASON WRAP. The app never says "watch live tonight to keep your streak." Badges celebrate what the log already proves; manufacturing behavior is the thing the measurement thesis stands against.
- Private by default, shareable per badge. Sharing surfaces to mutual follows only, consistent with the comment-visibility rule. The share action is itself a logged signal (self-identified broadcast-worthy fan; feeds the relationship-tiers thread).
- Badges keep compiling silently even when the classifier is off. They compile toward a 2027 Wrapped.

### Season Sentry

- Any dormant show in the user's log is watched for a new future airstamp on the same TVMaze poll.
- Date announced: one message. "Yellowjackets S4 has a date: Oct 1."
- Premiere in MORE! mode: silence until wrap.
- Cap: one Sentry message per show per state change, ever.
- Survives the kill switch. It reports facts (a new season exists), not guesses about habits. The off-message wording covers this: Pierre stops guessing habits, not stating facts.

### What each surface reads

- **Episodes face**: right slot under the bar becomes a live countdown during RAMP; the next grey segment gets an amber warm-up tick approaching T0. The anticipation counterpart to the popcorn.
- **Cooler / Feed**: phase sets thread state. Two threads per episode: pre-air (speculation, open to all followers) and post-air (gated on completion).
- **Pierre**: templated per-phase, per-mode prompts, cohort-aware. "Two days to Lanterns E4. Anne's caught up, you're one behind, and Sunday is your spoiler deadline."
- **Log**: laggard detection feeds the catch-up nudge, filtered through watchMode.

---

## Data

- **TVMaze** `airstamp` per episode: the spine. Free, no key, CORS-open. Phase boundaries computed client-side against timeNow in local time.
- **Watch log** (existing): timestamps, binge flags. watchMode is derived from deltas against airstamps.
- Poll cadence: on app open plus a daily check is enough; airstamps do not move often. Sentry rides the same poll.
- Nothing scraped, nothing new stored raw.

## State and interactions

- **Stored**: follow flag, watch log (exists), manual mode choices, DECLINED events and counter, positive-interaction flags, badge awards, Sentry sent-state, nudge sent-state, global kill state.
- **Derived**: phase, countdown, watchMode (when not manual), cohort caught-up counts, badge eligibility, in-season status, everything on screen.

## Decisions and vetoable defaults

Decided (Ted, this session):

- Mode names: LIVE, FRESH, CASUAL, MORE!. UNSAMPLED renders blank. No judgment-axis names anywhere.
- Chip hidden while UNSAMPLED.
- Badges private by default, shareable per badge.
- Two-strike global kill, with the positive-interaction exception.
- Badges compile silently through a kill for the 2027 Wrapped.
- Sentry survives the kill switch.

Still vetoable:

- v1 is in-app states only. No push. APNs plus review risk inside a 3-week window is the wrong trade; countdown and Pierre carry anticipation. Push is v1.1.
- Phase boundary numbers (3h, 48h, 72h, 2h, 14-day in-season window) are first guesses. Tune against SNW behavior.
- Spoiler-safety invariant: any scheduler-driven surface shown to a non-watcher is content-free (number, title, date; never synopsis or stills).
- BINGEwatcher thresholds (2 sittings, finale week) are first guesses.
- The positive-interaction list (manual set, badge share, nudge follow-through) can grow or shrink.

## Build log

- **d1 (sketch)**: airWindow x timeNow only. Five phases, countdown, pre-air threads, Lanterns anchor.
- **d2**: userWatchBehavior added as third input. watchMode per user-show, badges, mode-adaptive nudges, Season Sentry (the Yellowjackets anxiety, killed with one message per season).
- **d3**: LAGGED renamed CASUAL, banking renamed MORE! (Kylo Ren). Chip as single control point on the show card. Badges private-default. UNSAMPLED blank.
- **d4 (locked as Spec v1.0)**: DECLINED as distinct chosen state, two-strike consent rule with positive-interaction exception, badges compile toward 2027 Wrapped, Sentry survives the kill.

## Board read

- **Mark Cuban.** Ship the clock and the countdown for Aug 13 and cut everything that is not visible on premiere night. Badges pay off in October; the countdown pays off in three weeks.
- **Reid Hoffman.** watchMode segmentation per show is panel data nobody upstream can produce cross-platform. "Lanterns skews 40% live-watch" is a sentence agencies will pay for. The consumer feature and the B2B asset are the same table.
- **Bob Iger.** The two-strike rule is brand protection. Every franchise that nagged its way into the notification tray got muted. Also: test the countdown against HBO's own marketing cadence, do not fight their drumbeat, ride it.
- **Adam Grant.** The mode names matter more than the thresholds. CASUAL and MORE! are identities people will defend; LAGGED was a diagnosis they would resent. You turned a compliance feature into self-expression.
- **Brené Brown.** DECLINED as a respected, stored, honored signal is the whole product's character in one mechanic. Saying "Pierre won't guess anymore" out loud, with a path back, is how trust survives an opt-out.
- **Reed Hastings.** The scheduler stores almost nothing new: choices, counters, sent-flags. Everything else derives from airstamps and the log you already keep. That is the right shape; keep the derivation client-side where possible.
- **Ben Thompson.** The pre-air thread is the strategic wedge. Post-air conversation exists everywhere (Reddit owns it). Anticipation space, timecoded to a drop, spoiler-safe by construction, belongs to nobody. Lanterns weekly on Sunday nights is exactly the show to prove it on.

## Open threads and handoffs

- **Digest generation (to Pierre).** What does Pierre summarize at SETTLED, from what inputs, without storing raw conversation.
- **Thread carryover (to Feed).** Does pre-air speculation surface inside the post-air thread after the drop.
- **Push notifications (v1.1).** APNs capability, per-mode delivery rules inherit the nudge law unchanged.
- **Badge share mechanics (to relationship tiers).** Share-to-mutuals now; broadcast-tier sharing waits on the two-tier follow model.
- **2027 Wrapped (Audrey).** Badges, modes, and season stats as the compilation inputs. Design later; keep the data shapes stable now.
- **Double-episode premieres.** Lanterns is single-episode weekly, but the cycle needs a rule for two airstamps sharing a T0 (treat as one drop night, two completions).
- **SNW as testbed.** Phase boundaries and nudge copy get their first live read on the current SNW season before Lanterns Ep1.

---

## Tech handoff (for Claude Code)

- **Endpoints.** `https://api.tvmaze.com/shows/{id}?embed=episodes` or `/singlesearch/shows?q={name}&embed=episodes`. Each episode carries `airstamp` (ISO 8601 with offset). Phase math in local time, client-side.
- **New storage** (D1, additive only; never touch legacy `pangolin-rc` schema): mode choice per user-show, DECLINED counter and positive-interaction flags per user, badge awards, Sentry and nudge sent-state, global kill flag.
- **No cron required for v1.** Derive on app open; the daily poll can ride the existing Airtable cron pattern if a server check is wanted later.
- **Live-fetch caveat.** Files fetch TVMaze in the browser. Do not hardcode data or treat a file as broken because a sandbox cannot reach the network.
- **Copy rules.** No em-dashes anywhere. Mode names exactly: LIVE, FRESH, CASUAL, MORE!. Kill message exactly: "You can turn this back on in your profile, but Pierre won't guess your watch habits anymore."
