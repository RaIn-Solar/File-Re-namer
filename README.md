# Job Photo Organizer

Desktop app for Sales Reps and Technicians: pull in job-site photos, label what each is **for**, confirm the **dates**, then rename and file them in the customer's folder.

## Using it
1. On launch a **job window** asks for the **customer name**, **job name**, **visit date** and the **customer files folder** (all required; the folder is remembered). They are shown in the top bar. **New job** starts a fresh set of renames for a different job (it clears the loaded photos after confirming) and **Edit job** fixes a detail without clearing anything.
2. **Multi-day jobs:** tick **Remember this job** and its customer and job name are saved. Next time, pick it from **Continue a saved job** and the names load automatically; the visit date always starts as **today**. Only the two names are stored (never photos or dates; at most 50 jobs). When the work is finished, **Mark job complete** deletes the saved job from the program.
3. **Add photos** (button, folder, or drag & drop). On Windows a plugged-in phone appears under *This PC* – browse to `DCIM\Camera`.
4. **Confirm the date.** The app reads the date from each photo – the camera's EXIF data first, then a date in the file name (e.g. `IMG_20261008_101500.jpg`), then the file's modified date (marked less reliable). It lists the dates it found and asks you to confirm: use each photo's own date, use the visit date for all, or pick a date. Photos with no date get the visit date. You can still change dates later with "Set for selected".
5. Click photos (Shift/Ctrl for many), then pick a **type** (or press `1`–`7`). Every type has its own color (on its button and on the labeled photos), and you can add an optional **area** (Roof, Meter…).
6. **Review & rename** shows every old → new name, then copies to `<files folder>/<Customer>_<Job name>/<Type>/`. Originals on the phone/computer are never changed, existing files are never overwritten, and `upload-log.csv` records original → new name.

A short **tutorial** runs automatically the first time the app opens; replay it any time with the **? Tutorial** button in the top bar.

Naming: `Smith-John_Roof-Replacement_2026-10-08_Inspection_Roof_001.jpg` — so a sales walkthrough roof photo (`…_SalesWalk_Roof_001`) never collides with an inspection one.

## Customizing
The photo-type colors are the `color` of each category. The app icon is `build/icon.png` (used for the window and the installer). Defaults live in `config.default.json`. To override (categories, short names, area suggestions), put the same keys in `config.json` in the app's user-data folder (`%APPDATA%\job-photo-organizer` on Windows). Saved jobs live in `saved-jobs.json` in that same folder.

## Development
```
npm install
npm start        # run the app
npm test         # unit tests for naming, dates, copying
npm run dist     # build Windows installer / macOS dmg
```
Known limits: upload currently targets a folder, not a database/API. iPhone HEIC photos are converted to cached JPEG previews on demand (the first view of a big batch takes a moment); the originals are untouched.

## Automatic builds
`.github/workflows/build.yml` runs the tests on every push/PR and builds a Windows installer (`.exe`) and macOS `.dmg`.
- **Try a build:** Actions tab → *Build installers* → *Run workflow*; download the installers from the run's *Artifacts*.
- **Publish a release:** bump `version` in `package.json`, then `git tag v0.2.0 && git push origin v0.2.0`. The installers are attached to a GitHub Release automatically.
- **Windows signing (optional):** when signing secrets are set on the repo the Windows installer is signed automatically, otherwise it is built unsigned. Either *Azure Trusted Signing* (secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`) or a certificate file (`WIN_CSC_LINK` = base64 .pfx, `WIN_CSC_KEY_PASSWORD`). Unsigned builds show "unknown publisher" in SmartScreen (More info → Run anyway).
- **Mac:** builds are unsigned; the first launch needs right-click → Open. An Apple Developer ID removes this.
