# Cloud Infrastructure — pangolinRC

This file is a plain-language inventory of every piece of cloud infrastructure
set up for this project. It is meant to be readable in about 30 seconds by
someone who is not an engineer. It is updated whenever infrastructure is added
or changed.

---

## What's set up right now

### 1. R2 bucket — `pangolin-rc-payloads`

- **What it is:** A private storage bucket on Cloudflare (R2 is Cloudflare's
  version of a file storage locker, similar to Amazon S3). Think of it as a
  locked filing cabinet in the cloud.
- **What it's for:** Holding the raw files that people submit to the app —
  the actual uploaded bytes (audio, text, files, etc.). This is the "payload
  storage" the app is built around.
- **Who writes to it (right now):** Exactly one part of the app — the upload
  handler (`src/handlers/uploads.ts`). It saves a submitted file here during
  the **upload** step, either in one shot or in resumable chunks, but only
  while a submission is in the `pending` state. Two other parts only *read*
  from the bucket and never write: the processing queue (`src/queue.ts`,
  checks the file exists) and the access handler (`src/handlers/access.ts`,
  hands the file back out). A separate "revealed/canonical copy" is described
  in the design but is **not wired yet**.
- **Privacy:** Private. There are no permanent public links to anything in this
  bucket. Access to revealed files is always short-lived and revocable.

### 2. Cloudflare Pages site — `pangolin-rc`

- **What it is:** A Cloudflare Pages project. Pages hosts the static website
  (the "app shell" — the HTML/JS the visitor sees in their browser).
- **What it serves:** The files in the repo's `public/` folder (the Three.js
  cube front-end and its pages).
- **Live addresses:**
  - `https://remote.pangolinrc.com` — the custom subdomain (primary, live).
  - `https://pangolin-rc.pages.dev` — Cloudflare's default address for the
    same site.
- **How it's deployed:** Manually, by running `wrangler pages deploy public
  --project-name pangolin-rc --branch main`. `main` is the production branch,
  so that command publishes to production.
- **Custom domain:** `remote.pangolinrc.com` is attached to this Pages project
  as a custom domain (status: active). The `pangolinrc.com` domain already
  lives on this Cloudflare account; the subdomain is a DNS CNAME record
  pointing `remote` → `pangolin-rc.pages.dev`, proxied through Cloudflare.
- **Note:** This Pages site is the front-end only. The app's data/commands run
  on a separate Cloudflare **Worker** (`pangolin-rc`), which is what talks to
  the R2 bucket, D1 database, etc.
- **Demo subdomain:** `remote.demo.pangolinrc.com` is a second custom domain on
  the *same* Pages project (no separate copy). On a `demo` host (or with
  `?demo=1` on any URL) the app runs in demo mode: Pierre's chat is closed and
  the Join button is hidden; everything else is identical. It shares the same
  Worker and database as production. Needs a DNS CNAME `remote.demo` →
  `pangolin-rc.pages.dev` (proxied) to go live.

### 3. Pierre chat proxy — Worker route `POST /pierre/chat`

- **What it is:** A small endpoint on the existing Cloudflare Worker
  (`pangolin-rc`, at `https://pangolin-rc.edward-m-willett.workers.dev`). Code
  lives in `src/handlers/pierre.ts`.
- **What it's for:** Powering the Pierre chat. The browser sends only the
  conversation; this endpoint adds Pierre's personality and calls Anthropic's
  API to get his reply, then sends the reply back.
- **Why it exists:** So the secret API key and Pierre's personality never live
  in the public web page. The browser can't see either.
- **Who calls it:** The Pierre chat page (`public/cube_pierre_face.html`).
- **Secret it needs:** `ANTHROPIC_API_KEY` — the Anthropic API key, stored as a
  Worker secret (not in any file). Set it with
  `wrangler secret put ANTHROPIC_API_KEY`. For local dev, put it in `.dev.vars`.
  Until it is set, Pierre politely fails ("The signal dropped").

### 4. Accounts database — D1 `pangolin-rc` (tables: `users`, `devices`, `watch`)

- **What it is:** Cloudflare D1 is the project's SQL database (already existed
  for the core engine). We added tables for signed-up users and their stuff.
- **What it stores:** One row per signed-up person in `users` (email = the key,
  plus username, cell phone, and a profile-photo slot). `devices` holds each
  person's connected devices (e.g. LG TV in the gym garage, Fire Cube in the
  living room). `watch` is for shows + where they are within them + watch
  history (schema in place; wiring is the next step).
- **Who writes/reads it:** The Worker's account API (`src/handlers/profile.ts`):
  `POST /profile/signup` (create or update a user), `GET /profile/{email}`
  (user + devices), `POST /profile/{email}/devices` (add a device). The Profile
  face reads it; Pierre's login and add-device skills write to it.
- **Identity note:** Email is the only identity for now — no password or
  verification yet (that is a later security layer). The profile photo still
  lives in the browser for now, not the database.

### 5. Co-viewing endpoint — Worker route `GET /transcribe/coview`

- **What it is:** A read endpoint on the existing Cloudflare Worker
  (`pangolin-rc`). Code lives in `src/index.ts`.
- **What it's for:** Watching a show "with" a friend, asynchronously. While you
  watch, a friend's recorded **audio comments** surface at the exact minute
  mark they spoke them — so it feels like they're reacting alongside you, even
  though they watched earlier. The Episode face shows them as a list; the
  caption view can play each clip as your playback passes its mark.
- **The spoiler rule (the important part):** A friend's comment shows **who**
  said it and **when** (which minute) right away, but the actual **words and
  audio are withheld until your own playback passes that minute**. You can't
  read ahead to a reaction for a scene you haven't reached. This is enforced on
  the server, so the hidden text never even reaches the browser early.
- **Who can see whose comments:** Only **mutual friends** (you follow each other).
  The app re-checks that friendship on every request — the browser can't ask for
  a stranger's comments. Co-viewing is **off until you opt in**, per show, by
  picking friends on the Episode face.
- **What it uses:** The same D1 database (the `watch_comment` table holds each
  comment's text + minute mark; the `follows` table defines friendship) and the
  R2 bucket (the raw audio). Nothing new was created for this — it reuses what
  was already there. Sibling endpoints in the same file record a comment
  (`POST /transcribe`), play one back (`GET /transcribe/audio/{id}`), and list
  your *own* comments (`GET /transcribe/comments`).
- **Who calls it:** The Episode face (`public/cube_log_face.html`)
  for the spoiler-gated list, and the remote/caption view (`public/index.html`)
  for live playback.

### 6. IRL Theater tickets — Worker routes `POST /ticket`, `GET /ticket/{id}/image`, `GET /tickets`

- **What it is:** A small group of endpoints on the existing Cloudflare Worker
  (`pangolin-rc`), in `src/index.ts`.
- **What it's for:** Logging a movie you watched in a **real cinema** instead of
  on a streamer. On the Episode face you set the "where" to **IRL Theater** (a
  new option on the streamer wheel); the FINISH button then becomes **🎟 TICKET**
  and asks for a photo of your ticket stub, or a screengrab of a mobile ticket
  (camera or photo library). Submitting it marks the film watched.
- **Reading the ticket:** When the image arrives, the Worker shows it to Claude
  (the same Anthropic key Pierre uses) and reads off the **date**, the
  **showtime**, and the **theater name**. The theater then becomes the "where" —
  the corner badge shows the actual cinema (e.g. "AMC Lincoln Square") in place
  of the generic label, and the date/time/theater are captioned on the watched
  row. This reading is best-effort: if the image can't be read, the ticket is
  still saved, just without those details.
- **Where the image lives:** The raw image goes in the R2 bucket
  (`tickets/<show_id>/<id>`); a row in the new D1 table `watch_ticket` indexes it
  (plus the read-off date/time/theater). The image is served back through the
  Worker (`GET /ticket/{id}/image`), never a public link.
- **Who can save one:** Signed-in members only (the row is tied to the user). The
  theater "where" is a personal pin — it is **not** shared as the crowd's
  streamer guess the way a normal streamer pick is.
- **Who calls it:** The Episode face (`public/cube_log_face.html`).

---

_Last updated: 2026-06-26 — added the co-viewing endpoint
(`GET /transcribe/coview`) and IRL Theater tickets (`POST /ticket` etc.): log a
cinema watch by uploading a ticket; Claude reads its date/time/theater and the
theater becomes the "where."_
