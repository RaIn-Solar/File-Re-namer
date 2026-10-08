# Job Photo Organizer

Desktop app for Sales Reps and Technicians: pull in job-site photos, label what each is **for**, confirm the **dates**, then rename and file them in the customer's folder.

## Using it
1. Type the **customer** (and optional job #). Choose the **customer files folder** once (a network share or a synced SharePoint/OneDrive folder); it is remembered.
2. **Add photos** (button, folder, or drag & drop). On Windows a plugged-in phone appears under *This PC* – browse to `DCIM\Camera`.
3. Click photos (Shift/Ctrl for many), then pick a **type** (or press `1`–`7`) and optionally an **area** (Roof, Meter…).
4. **Check the dates.** Dates come from the camera's EXIF data, falling back to the file date (flagged "file date?"). Photos not on the **visit date** are flagged ⚠; fix them with "Set on selected".
5. **Review & rename** shows every old → new name, then copies to `<files folder>/<Customer>_<Job#>/<Type>/`. Originals on the phone/computer are never changed, existing files are never overwritten, and `upload-log.csv` records original → new name.

Naming: `Smith-John_J1042_2026-10-08_Inspection_Roof_001.jpg` — so a sales walkthrough roof photo (`…_SalesWalk_Roof_001`) never collides with an inspection one.

## Customizing
Defaults live in `config.default.json`. To override (categories, short names, area suggestions), put the same keys in `config.json` in the app's user-data folder (`%APPDATA%\job-photo-organizer` on Windows).

## Development
```
npm install
npm start        # run the app
npm test         # unit tests for naming, dates, copying
npm run dist     # build Windows installer / macOS dmg
```
Known limits: HEIC photos (iPhone default) are renamed correctly but show "No preview"; upload currently targets a folder, not a database/API.
