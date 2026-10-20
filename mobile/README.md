# Job Photos (phone app)

An installable web app for Android (works in Chrome). The worker picks the job and the photo type, takes a picture (or chooses from the gallery), and the photo is **named with the same rules as the desktop app** and **uploaded straight to Google Drive**. Nothing is saved on the phone.

Drive layout: `Contacts-Active/<Last, First>/<Job name>/Photos/<Customer>_<Job>_<date>_<Type>_<Area>_<###>.jpg`. The worker searches for and picks an **existing** customer and job; the app never creates folders, and each job must already have its `Photos` folder.

## Data safety (enforced in `src/drive.js`, covered by tests)
- Only reads and brand-new file uploads can leave the app. There is no delete, trash, move, rename or overwrite code.
- Before every upload the app re-checks with Drive that the target is exactly `Contacts-Active > customer > job > Photos`.
- A file is never replaced: a taken name gets `_v2`, `_v3`, … and both are kept.
- The Contacts-Active folder id is fixed in `mobile/config.js`. Testing lock: `allowedCustomers` limits the app to `Inman, Rachel` until it is cleared at go-live.
- Google cannot limit an app to one folder tree, so these protections are in the app's code, not in Google's permissions.

## One-time setup (owner)
1. In [Google Cloud Console](https://console.cloud.google.com/) create a project and enable the **Google Drive API**.
2. *APIs & Services → OAuth consent screen*: choose **Internal** if you use a Google Workspace account (anyone in your company can sign in), otherwise **External** and add each worker as a test user.
3. *Credentials → Create credentials → OAuth client ID → Web application.* Under **Authorized JavaScript origins** add the address where the app is hosted (for example `https://rain-solar.github.io`). Copy the **Client ID** (it is not a secret).
4. The client ID and the Contacts-Active folder id are set in `mobile/config.js`.
5. On the phone open the hosted address and tap **Connect Google Drive**.
6. In Chrome choose **⋮ → Add to Home screen** to install it.

The app asks for Drive access (`drive` scope) because it must find and create folders that already exist in your Drive.

## Hosting
`npm run build:mobile` assembles the app into `dist-mobile/` (it copies the shared naming rules and photo types from the desktop code). `.github/workflows/mobile.yml` publishes that folder to GitHub Pages once enabled (repo *Settings → Pages → Source: GitHub Actions*). Any HTTPS static host works.

Try it locally: `npm run serve:mobile`, then open http://localhost:8080.

## Notes
- Photos taken in the app use the **Photo date** field (defaults to today). Photos chosen from the gallery use their own capture date.
- A failed upload stays on screen with a **Retry** button (kept in memory only). Uploads need a connection; sign-in lasts about an hour, then the app asks to reconnect.
