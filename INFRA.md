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

### 3. Pierre chat proxy — Worker route `POST /pierre/chat`

- **What it is:** A small endpoint on the existing Cloudflare Worker
  (`pangolin-rc`, at `https://pangolin-rc.edward-m-willett.workers.dev`). Code
  lives in `src/handlers/pierre.ts`.
- **What it's for:** Powering the Pierre chat. The browser sends only the
  conversation; this endpoint adds Pierre's personality and calls Anthropic's
  API to get his reply, then sends the reply back.
- **Why it exists:** So the secret API key and Pierre's personality never live
  in the public web page. The browser can't see either.
- **Who calls it:** The Pierre chat page (`public/pierre.html`).
- **Secret it needs:** `ANTHROPIC_API_KEY` — the Anthropic API key, stored as a
  Worker secret (not in any file). Set it with
  `wrangler secret put ANTHROPIC_API_KEY`. For local dev, put it in `.dev.vars`.
  Until it is set, Pierre politely fails ("The signal dropped").

---

_Last updated: 2026-06-14 — added Pierre chat Worker proxy (`/pierre/chat`) +
`ANTHROPIC_API_KEY` secret._
