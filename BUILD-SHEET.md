# BUILD SHEET - Push a build to TestFlight

One page, top to bottom, every time. Nothing here is optional unless marked.

---

## 0. Before you build

- [ ] Web changes merged and live at remote.pangolinrc.com (push to main).
      The app bundles the same files, so what is live is what ships.
- [ ] Worker changes (if any) deployed with `wrangler deploy --message "..."`
      and logged in BACKEND.md (same-session rule).
- [ ] Quick pass in mobile Safari at remote.pangolinrc.com: the thing you
      changed works there first.

## 1. Sync web into the wrapper

```
node scripts/sync-www.mjs && npx cap sync ios
```

- sync-www copies public/ into www/ and verifies the 9 boot-critical files.
- cap sync copies www/ into ios/App/App/public and refreshes plugins.
- If either errors, stop. Do not archive a stale bundle.

## 2. Bump the version

Open ios/App in Xcode (`npx cap open ios`), target App, General tab:

- **Build (CURRENT_PROJECT_VERSION):** increment by 1 EVERY upload.
  Never reuse, never reset. TestFlight rejects a duplicate build number.
- **Version (MARKETING_VERSION):** bump 0.0.x only for a tester-round fix
  wave (0.1.0 -> 0.1.1). Leave it alone for routine builds.

## 3. Info.plist sanity (30 seconds, saves a rejection)

- [ ] NSMicrophoneUsageDescription describes reality: voice comments are
      recorded, stored, and transcribed. The old "nothing is recorded or
      stored" string is FALSE and must not ship.
- [ ] ITSAppUsesNonExemptEncryption = NO is present (kills the export
      compliance prompt on every upload).
- [ ] Portrait only. iOS 16.0 minimum. Do not add landscape.

## 4. Archive and upload

1. Xcode toolbar: select **Any iOS Device (arm64)** as destination
   (Archive is greyed out on a Simulator destination).
2. Product > **Archive**. Wait for the Organizer window.
3. Organizer: **Distribute App** > **TestFlight & App Store** (App Store
   Connect) > Upload. Default signing (team 289R5P7B76). Next through.
4. Wait for the "processing" email from App Store Connect (5 to 30 min).

## 5. App Store Connect

appstoreconnect.apple.com > My Apps > PangolinRC > TestFlight tab:

- [ ] New build appears under iOS builds (after processing).
- [ ] If prompted for export compliance, answer No (or step 3 already
      handled it).
- [ ] Add the build to the **SNW Cohort** external group.
- [ ] External builds go through Beta App Review each time. First one was
      the slow one; subsequent builds are usually hours. What's New notes:
      one plain sentence about what changed.

Internal testers (you) get the build immediately, no review. Sanity-check
on your phone from TestFlight before the external group gets it.

## 6. On-device check (the wrapper-only stuff)

Safari already proved the features. The build exists to prove:

- [ ] Sleep the phone mid-timer, reopen: lands on the LOG face, timer right.
- [ ] Reply window pauses during sleep, resumes on wake.
- [ ] Mic permission prompt appears once, recording works in the webview.
- [ ] sms: hand-off opens Messages.

## 7. Log it

- [ ] WRAPPER.md entry, same session: build number, marketing version,
      what changed, anything broken. No deferred logging.

## 8. Tag the build + update the manifest

Every upload gets a git tag on the EXACT commit you archived, so any build is
reproducible and diffable later — the label that survives when the branches
that fed it are long gone.

```
git tag -a tf-<build#> -m "TestFlight build <build#> — <marketing version>"
git push origin tf-<build#>
```

- Tag name is `tf-` + the build number from step 2 (e.g. `tf-42`). One tag per
  upload, never reused, never reset — same discipline as the build number.
- Tag the commit you actually archived (usually `main` at archive time). If the
  bundle mixed in a not-yet-merged branch, merge it first so the tag is honest.
- Diff what changed between two builds: `git log --oneline tf-41..tf-42`.

Then add one row to the manifest (newest on top): build # · marketing version ·
date · which branches/features folded in · what a tester should exercise.

### Build manifest

| Build | Version | Date | Included | Test focus |
|------:|---------|------|----------|------------|
| _next_ | — | — | — | — |

---

## Fast path (memorize this)

```
node scripts/sync-www.mjs && npx cap sync ios && npx cap open ios
```

Then: bump build number, Archive, Distribute, assign to SNW Cohort, log it.

## When things go sideways

- **Archive greyed out:** destination is a Simulator. Pick Any iOS Device.
- **Upload rejected, duplicate build:** you forgot step 2. Bump and re-archive.
- **Build never appears in TestFlight:** check email; processing can silently
  fail on Info.plist problems (usually the mic string or a missing icon).
- **App shows old UI:** step 1 was skipped or failed. The bundle is a copy,
  not a live view. Sync, re-archive.
- **Signing errors:** Xcode > Settings > Accounts, make sure the team
  (289R5P7B76) session is signed in, then let automatic signing repair.
