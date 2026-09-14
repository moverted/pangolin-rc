# FEATURES — ship-status ledger

> **Surface direction (2026-09-13): flat-only.** The flat swipe/tab app
> (`app.html` + `flat_shell.js`) is *the* app; design all new work there. The 3D
> cube (`index.html` + `cube_shell.js`, tag `cube-freeze`) is **legacy/frozen** —
> reference only, no new work. The six faces are shared and render in the flat
> shell. A **v2 stabilization pass** (see bottom) is planned to consolidate the
> stranded branches onto `main` and retire the cube.


> **Why this file exists.** Features keep "disappearing" from prod. Every time,
> the cause is the same: a finished, working feature was committed onto a **big
> shared branch** (or left uncommitted) and never merged to `main` — then prod
> was redeployed from `main` and the feature vanished. Nothing was deleted; it
> was never on the deploy path. This ledger tracks what exists, where it lives,
> and whether it's actually on `main` + prod.

## The rule (read before starting any feature)

1. **One feature = its own branch off `main`.** Do not bundle an unrelated
   feature onto another feature's branch. The co-view card was lost precisely
   because it was buried inside `pierre-outreach-skill` (PR #36) with outreach
   and admin work.
2. **"Done" ≠ "shipped."** A feature counts as shipped only when it is (a)
   merged to `main`, AND (b) deployed to prod, AND (c) verified live (grep its
   identifiers on `main`, then hit prod). Until all three, it's **at risk**.
3. **Before any redeploy from `main`, scan this ledger's "At risk / stranded"
   section.** If a working feature isn't on `main` yet, merge it first or
   knowingly accept it won't be in the deploy.
4. **Log every ship in `BACKEND.md`** (existing same-session rule) and flip its
   row here to ✅ on main.

### How to verify a feature is really on main (not just "written")

```
git merge-base --is-ancestor <commit> main && echo "on main" || echo "NOT on main"
# or, by code identifier:
git show main:public/<file> | grep -c "<distinctive-id>"
```

---

## ⚠️ At risk / stranded — NOT on `main` (as of 2026-09-13)

Branch **`pierre-outreach-skill`** (PR #36, unmerged) carries 10 commits off
`main` (merge-base `8c77f6c`). Prod runs `main`, so **none of this is live**:

| Commit | Feature | Files | Status |
|---|---|---|---|
| `839562b` | **Co-view comment card + end-of-episode friend end-notes interstitial** (the big REPLAY/REPLY/CANCEL card while watching) | `cube_log_face.html`, `cube_shell.js`, `index.html`, `src/index.ts`, seed scripts | ➡️ **RESTORED to own branch `coview-card`** (cherry-picked off `main`), ready to merge + deploy |
| `2988bc0` | Admin-only Pierre "Outreach draft" skill | `cube_pierre_face.html`, `admin.ts` | stranded |
| `3dd34d0` | Outreach follow-up cadence + dedup + status-via-Pierre (migration `0060`) | `admin.ts`, `pierre.ts`, `0060_outreach_cadence.sql` | stranded |
| `a897222` | Admin: badges, Episode Feed commenters, Marathon manager+delete; in-app marathon delete | `admin.ts`, `admin/index.html` | stranded |
| `7ba18ba`–`adcc350` | Admin Episode Feed: attributed/threaded transcript, end-note Play ring, grouping fixes; iOS bundle sync | `admin.ts`, `admin/index.html` | stranded |

> See memory: `pangolinrc-user-history-outreach-gap`, `pangolinrc-outreach-tracker`.

**Uncommitted in the working tree** (not on any branch yet — highest loss risk):
`BACKEND.md`, `admin/index.html`, `public/cube_pierre_face.html`,
`src/handlers/{admin,pierre,profile}.ts`. Commit these to a named branch before
switching branches or deploying.

---

## ✅ On `main` + prod (recent)

| Feature | Key files / identifiers | Shipped |
|---|---|---|
| Flat pager off-by-one fix (tab/face alignment) | `flat_shell.js` | `6c9f353` / `966f013` — 2026-09-11 |
| Pierre grounding: marathon-in-context, no-rebuild, find_episode/episode_arc, Get Ted "Copy chat" | `cube_pierre_face.html`, `pierre.ts` | `7ffeb29` — 2026-09-11 |
| COMPLETED résumé v2 (3 tabs, month→series grouping, de-corrupt rewatch); REWATCH sessions/ad-hoc marathons/movie views | `cube_set_face.html`, `profile.ts`, `catalog.ts`, migrations `0061`/`0062` | `ddf068b`/`360624b` — 2026-09-10 |

(Older shipped features are catalogued in `MEMORY.md` and `BACKEND.md`.)

---

## Feature → file map (where the big pieces live)

Use this to know which files a change touches — and which files share a face,
so a "small fix" doesn't silently drop a sibling feature.

- **In-watch co-view comment card / end-notes interstitial** → `cube_log_face.html`
  (shared by flat + cube), `cube_shell.js` (cube caption panel), `index.html`
  (`#cap-coview`). Backend: `src/index.ts` (`watch_comment`, `/transcribe`).
- **Pierre chat** → `cube_pierre_face.html` + `pierre.ts`. Face messages must be
  handled in BOTH `cube_shell.js` AND `flat_shell.js` (see memory
  `pangolinrc-face-shell-message-parity`).
- **WATCH list / episode screen** → `cube_watch_face.html`.
- **COMPLETED / SET (Shadow, résumé)** → `cube_set_face.html` + `profile.ts`.
- **Admin portal** → `admin/index.html` + `src/handlers/admin.ts`.
- **Flat app shell** (default surface) → `flat_shell.js`; cube shell → `cube_shell.js`.
