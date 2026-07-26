# Claude Code handoff — WoW_inSeason_scheduler 1.0.1

Companion files: `wow_scheduler_1.0.1.html` (candidate prototype), `wow_inseason_scheduler_spec.md` (Spec v1.0, source of truth).

## Version and branch protocol

- App version for this work: **1.0.1**. Production **v1 (build 4) stays untouched** as the shipping app build.
- Branch: `feat/wow-inseason-scheduler`. Deploy freely to the branch. **No merge to `main` and no production deploy without Ted's explicit confirmation.**
- Never touch, migrate from, or rebind the legacy D1 database (`pangolin-rc` / `4bd25737`). All storage below is additive.
- Edits target `public/` only. `www/` and `ios/App/App/public/` are generated. Sync: `node scripts/sync-www.mjs && npx cap sync ios`.
- Log the work in BACKEND.md same-session, per standing rule. Wrangler deploys need a deploy message.

## What to build

Integrate the scheduler as a shared service the faces read, per Spec v1.0. The prototype HTML is the working reference for the phase engine, classifier, chip, and nudge law. It fetches TVMaze live in the browser; do not hardcode data or treat the file as broken because a sandbox cannot reach the network.

Scope for 1.0.1 (in-app only, no push):

1. **Phase engine.** Client-side, derived from TVMaze `airstamp` vs timeNow in local time. Boundaries in the prototype's CFG block match Spec v1.0 and are the tunable surface.
2. **watchMode classifier.** Per user, per show. Derived from watch-timestamp deltas plus the existing 3-in-24h binge flag. UNSAMPLED under 2 logged episodes. Manual choice always wins and freezes the classifier for that show.
3. **Mode chip** on the show card. Cycle: auto, LIVE, FRESH, CASUAL, MORE!, blank. Blank stores DECLINED. Chip hidden while UNSAMPLED. Every nudge deep-links here; no nudge carries its own settings UI.
4. **Nudge law** (all five rules in the spec, enforced in one place). Copy strings in the spec and prototype are locked, including the exclamation in MORE! and the kill message verbatim.
5. **Two-strike rule.** Second DECLINED ever kills the classifier globally, unless positive interactions exist (manual mode set, badge share, nudge follow-through). Re-enable in profile; classifier restarts from the full log.
6. **Season Sentry.** Rides the existing poll; one message per show per state change; survives the kill switch.
7. **Badges.** Compute at SEASON WRAP from the log (LIVEwatcher 6-of-8-in-window scaled to season length; BINGEwatcher 2 sittings or finale-week run). Private by default. Keep computing through a kill; data shapes stable for the 2027 Wrapped.

## Testbed

SNW S4 (TVMaze show 48090) is in season now: E1 aired Jul 23, E2 drops Jul 30, finale Sep 24, 10 episodes. Use it for live troubleshooting before Lanterns (premieres Aug 16; scheduler must be solid by Aug 13 so the premiere RAMP is live).

Known source caveat: TVMaze stamps Paramount+ drops at 12:00 UTC (8am ET), not a broadcast hour. LIVE-window math must tolerate streamer-style airstamps; do not assume 9pm anchors. HBO linear shows (Lanterns) will carry real broadcast stamps.

## New storage (D1, additive only)

- `mode_choice` per user-show (nullable = auto), `declined_count` and `positive_interaction` flags per user, `badge_awards`, `sentry_sent` and `nudge_sent` state, `global_kill` flag.
- Stored minimum only; phase, countdown, derived mode, and all geometry are computed, never stored.

## Copy rules

No em-dashes anywhere. Mode names exactly LIVE, FRESH, CASUAL, MORE!. Kill message exactly: "You can turn this back on in your profile, but Pierre won't guess your watch habits anymore."
