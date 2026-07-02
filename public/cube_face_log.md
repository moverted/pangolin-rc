# Cube Face: Log — Build and Integration Notes

*Handoff for Claude Code. Pairs with `cube_watch_face.html`. Same portable-note method as the Episodes doc. No em-dashes in any copy.*

---

## What this file is

`cube_watch_face.html` is one self-contained HTML file. Inline CSS and JS, one Google Fonts link, one live data source (TVMaze). Hand it to Claude Code as-is.

**Live-fetch caveat.** The file fetches TVMaze in the browser at load. Do not hardcode the data, do not "fix" the fetch, and do not treat the file as broken because a sandbox cannot reach the network. A show that fails to load renders a labelled fallback tile. This is expected.

**Demo seeds are seeds, not product logic.** The seeded list of shows, the watched counts, the return dates, the subscription prices, and the savings figure are all placeholders so the face is populated. In production every one of these comes from the user's record and the subsidy backend. They are marked in the source.

---

## Where Log sits in the cube

| Face | Job | Link to Log |
|---|---|---|
| Feed (Cooler Chat) | Async co-viewing, timecoded to the show | reads Log's current episode |
| Log | Viewing history and state. Source of "what am I watching" and the data Pierre reads | this file |
| Remote | Tuning-in capture and recognition entry | writes "currently watching" into Log |
| Episodes | Where you are in a show, and where you log it | two-way, already baked |
| Show Detail | Show-level context | reads the Log record |
| Pierre | AI and recommendation persona | reads and writes Log via the contract below |

Log is the model. Every other face is a view or an editor of the same records. Keep one store. Do not let any face hold its own copy of viewing state.

---

## The shared data model (the contract)

The in-file `LOG` array is the shared store. In production it is backed by the user's database through an API, but the record shape stays the same so the faces and Pierre do not change.

One record per show:

```
{
  id,            // stable show id
  name,          // display title (from catalog)
  poster,        // art url
  status,        // "Running" | "Ended" | "Canceled" ...  (from catalog)
  episodes,      // [{season, number, title, airdate}]    (from catalog)
  total,         // episode count            (derived)
  released,      // aired count vs today     (derived)
  watched,       // first-watch progress     (stored)
  lastWatched,   // {season, number, title, at}  (stored, drives Pierre)
  returnDate,    // editorial, manual        (stored)  next-season date
  comfort,       // bool. user-declared rewatch staple (stored)
  plan,          // rewatch plan object, see Plans (stored)
  rewatch,       // optional rewatch session, see Add a show (stored)
  stopped,       // bool. user stopped watching (stored)
  forceCompleted // bool. finished the last available episode (stored)
}
```

Stored vs derived matters. Store the viewing record: what was watched, when, the rank, the notes, the plan. That record is the asset and the thing the subsidy pays for. Derive everything geometric: released vs unreleased, bar widths, season counts, bucket membership. Do not store raw living-room capture anywhere in this model. If recognition is used to place a viewer in an episode, store the matched offset, never the audio or the transcript. Storing what someone watched is the deal they signed. Storing the sound of their room is a different promise and is not part of this model.

### Pierre's query surface

Pierre reads the same records the bars draw from. These functions are the contract Pierre calls:

```
Pierre.lastEpisodeWatched()   // most recent watch across all shows -> "what did I last watch"
Pierre.currentlyWatching()    // in-progress current shows, most recent first
Pierre.addShow(typedName)     // history-aware add, see below
```

Keep these pure reads against the store. No face should answer "what did I last watch" from its own memory.

---

## Buckets (the four tabs)

Computed in `bucketOf(s)`, in this order:

- **Completed.** `stopped` or `forceCompleted`, or an ended show with everything watched. Stopped shows render in a quiet group at the bottom of Completed, each with a try-again.
- **Current.** Has unwatched available episodes. A Returning show also pops here when its return date is inside seven days.
- **Returning.** Caught up, with a future return date more than a week out. Double bar: episode progress plus the return countdown. The countdown is the notify trigger. When it crosses inside a week, Pierre pings and the show moves to Current.
- **Comfort.** User-declared rewatch staples. Different object, see Plans.

---

## Plans (Comfort tab)

A comfort row is a paired layout: poster tile left, rewatch plan right. The plan bar is a barcode that lights the episodes the plan includes, in the `--plan` colour. Plan kinds:

- `all` complete series
- `seasons {max}` first N seasons, a front block
- `seasonsScatter {seasons:[...]}` specific episodes inside a season range, e.g. a character's arc
- `top {n}` Pierre's top N, scattered

Pierre always offers a top 10 or top 5 on any show. SVU in the seed carries a Pierre-generated top 10 to show the auto-offer sitting next to human-curated plans.

**Adopting a plan.** Tapping a comfort row rotates to Episodes and passes the plan. Episodes adopts the cut: it shows only the planned episodes and marks them. The small Pierre on the Episodes face is where reset, edit, and re-cut live. On Log the plan is read-only and the "Pierre" mark is an indicator.

> Barcode note: one cell per episode reads well on short runs and gets thin past about ninety episodes. If long shows look mushy, bin the bar to a fixed resolution rather than one cell per episode.

---

## Linking to the other faces

The file currently stubs cross-face moves with an on-screen flash and drives the finish and stop animations from demo chips. Replace the stubs with a real navigation and event contract. The cube shell owns routing. Faces call it, they do not implement it.

```
// Provided by the cube shell.
window.cube = {
  rotateTo(face, payload),   // e.g. rotateTo('episodes', {showId, plan})
  on(event, handler),        // subscribe to cross-face events
  emit(event, payload)       // publish
};

// Shared store. Backed by the user's DB in production.
window.viewingLog = {
  all(), get(showId), upsert(record),
  recordWatch(showId, {season, number, at}),
  setStopped(showId, bool),
  setPlan(showId, plan)
};
```

### Log to Episodes

The Episodes link is already baked, so wire Log to use it:

- **Select a show to watch.** Tapping a tile rotates to Episodes for that show. Replace the `popToEpisodes` stub with `cube.rotateTo('episodes', {showId: s.id, plan: s.plan || null})`.
- **Adopt a rewatch plan.** Tapping a comfort row passes the plan in the same call so Episodes inherits the cut.

### Episodes to Log (events Log listens for)

```
cube.on('episode:logged', ({showId}) => { reloadFromStore(); render(); renderPierre(); });
cube.on('show:finished',  ({showId}) => finishShow(showId)); // popcorn confetti + fly to Completed
cube.on('show:stopped',   ({showId}) => stopShow(showId));   // turn to dust -> Completed bottom + try again
cube.on('show:resumed',   ({showId}) => { reloadFromStore(); render(); });
```

`finishShow` and `stopShow` already exist in the file. Today they are fired by the demo chips. In production keep the functions and swap the trigger to these events. `show:finished` fires when the last available episode is logged on the Episodes face. `show:stopped` fires when the user presses stop watching on a show. There is no confetti on stop. Dust only.

### The other faces, briefly

- **Remote** writes "currently watching" into the store via `recordWatch`. That is how a show enters Current.
- **Feed** reads `lastWatched` for the show to anchor the timecoded conversation to where the viewer is.
- **Show Detail** reads the record for show-level context.
- **Pierre** reads through the query surface and writes through `viewingLog`. The add-show flow below is Pierre's.

### Savings

The corner figure and the breakdown popup are seeded from a `SUBS` array in the file. In production the figure comes from the subsidy backend (the Plaid-fed bill subsidy), not from the file. The popup layout stays. Swap the source.

---

## Add a show (route through Pierre, never a blind add)

There is an add-show entry point on Log. It does not create a record. It rotates to Pierre with an add intent so the user types the show name into Pierre and Pierre reads the user's history before doing anything.

```
function addShow(){ cube.rotateTo('pierre', {intent: 'add'}); }
```

**Why through Pierre and not a form.** A blind add creates duplicates, mislabels rewatches as first watches, and throws away the most interesting signal. Pierre adds with context.

### Pierre's history-aware add (spec)

Lives on the Pierre face. Calls the store, not a blank create.

```
async function addShow(typedName){
  const show = await resolveCatalog(typedName);     // TVMaze or the catalog
  const existing = viewingLog.get(show.id);

  if(!existing)            return offerNew(show);    // add. infer current vs plan. minimal questions.
  if(existing.completed)   return offerRewatch(existing); // recognize it. layer a rewatch. do not duplicate.
  return surfacePosition(existing);                  // already tracked. show where they are. do not reset.
}
```

Cases:

- **New to the user.** Add it. Infer whether it is current or a plan. Ask the minimum, or nothing. Do not interrogate.
- **Already completed.** Recognize it. Do not create a second record and do not wipe the original completion. Offer to start a rewatch, which layers a rewatch session on top of the finished record.
- **Already in progress, returning, or comfort.** Surface the current position. Do not reset it.

### The Scrubs case

Worked example for the completed-then-rewatched path. Last night the household rewatched three episodes of Scrubs because they were not sure they had actually seen them.

What Pierre must do:

- Recognize Scrubs is already in history as completed. Do not add a fresh Current entry that implies a first watch.
- Log a rewatch session of three episodes against the existing record. The original completion stays intact.
- Do not make the user reconstruct which episodes they "really" saw the first time, and do not ask them to rate how well they remember. Infer passively. Offer a sensible default and let them move on. (Same principle as DOUG: never ask the user to classify their own state.)

This needs a rewatch session distinct from first-watch progress:

```
record.rewatch = { startedAt, plan, watched, lastWatched }; // original watched and lastWatched untouched
```

When a rewatch is active, the Episodes face shows the rewatch position, not the first-watch position. The first-watch record is preserved underneath.

---

## Add the entry point to this file (concrete change)

Smallest version for Claude Code:

1. Add a `+` control. Two reasonable homes: a small `+` in the header next to the savings figure, or a full-width "add a show" row pinned at the top of the Current tab. Prefer the header `+` so it is reachable from any tab.
2. Wire it to `addShow()` above. In this standalone file, with no cube shell present, have it fall back to the existing flash so the demo still does something visible.
3. Do not let it create a record directly. The whole point is that it hands off to Pierre.

---

## Open threads and handoffs

Carry these forward. They surfaced here but are bigger than this face.

- **Rewatch state (to Episodes and the model).** A rewatch is a first-class session, not a reset of first-watch progress. The minimal shape is above. Episodes needs to render a rewatch position. This is the same thread the comfort plans raised: a full green bar stops being useful once someone is three seasons into a rewatch.
- **Uncertain memory as a signal (to measurement).** "We rewatched it because we did not remember watching it" is real data. Episodes that viewers complete and then do not retain are a quality signal no streamer captures, because completion is all they see. Worth logging the rewatch-without-memory case as its own flag, not folding it into a plain rewatch.
- **Add intent as panel data (to Pierre and panel).** What a user types into the add box, including shows they never end up logging, is intent data. Capture the typed query, not just the confirmed add.

---

## Tech handoff

- **Stack.** One self-contained HTML file. Inline CSS and JS, one Google Fonts link, one live fetch.
- **Endpoint.** `https://api.tvmaze.com/singlesearch/shows?q={name}&embed=episodes`. Returns the show plus `_embedded.episodes`. Each episode has season, number, name, airdate, summary, image.
- **Live-fetch caveat.** As above. The file fetches in the browser. Do not hardcode or treat as broken in a sandbox.
- **Seeds.** Listed in `SEED` and `SUBS`. Demo only.
- **Delivery.** Created to `/mnt/user-data/outputs/` and surfaced with `present_files`.

---

## Build log

- **v1.** Two-across poster grid, two tabs (Current, Completed), three-state bars, live TVMaze, Pierre strip answering last-watched and watching-now.
- **v2.** Comfort bucket added, double bar for return-date shows, three across, savings figure, completion confetti and fly-to-Completed.
- **v3.** Back to two across. Four tabs (Current, Returning, Comfort, Completed). Savings breakdown popup. Stop-watching dust path into a quiet Completed group with try-again. Long-title shows added.
- **v4.** Orphan fix (titles break at the colon, no one-word last line). Comfort reworked into paired rows: poster left, rewatch plan right, barcode bar in the new `--plan` colour. Plans: complete, first-N-seasons, character scatter, Pierre top-N. SVU carries a Pierre top 10 to show the auto-offer.
- **next (this doc).** Replace nav and event stubs with the cube contract. Add the history-aware add-show entry point through Pierre.
