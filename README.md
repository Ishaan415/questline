# Questline

A cozy pixel-RPG planner for Windows and Android. Daily chores with times,
reminders, a full-page calendar synced with Google, a full-screen focus mode with
ambient pixel scenes, and Spotify controls. On Windows it lives in the system tray
and costs almost nothing to keep running; on your phone it's the same app with a
thumb-friendly layout. Sign in with Google and both stay in sync.

Finishing things earns XP, gold and badges; a team of pals grows and evolves with
you; a new boss shows up every week. Missing things stings a little, never a lot.

---

## 1. Releases, updates and making changes

Every push to `main` that touches the app (`src/`, `src-tauri/`, `package*.json`)
builds a new signed version on GitHub (versions `0.5.0`, `0.5.1`, …) and publishes it
as a **GitHub Release**: the Windows installer first, then the Android APK is added
to the same release about 15 minutes later (see [Android app](#android-app)). The installed app checks for it shortly after it starts and
every 6 hours, then offers **Update now**. It downloads the installer, verifies its
signature, and Questline closes, updates and reopens by itself. You can also check
from the tray menu, **Settings → Updates**, or `Ctrl+K → Check for updates`.

Add `[skip ci]` to a commit message to push without releasing (e.g. while you're
halfway through a change spread over several commits).

**Version numbers.** `SERIES` at the top of `.github/workflows/build-windows.yml`
sets the first two parts (currently `0.5`). Each release counts the existing
`v0.5.*` tags and takes the next number, so the first build is `0.5.0`. For a big
update, change `SERIES` to `0.6` and the next build becomes `0.6.0`.

### One-time setup

The updater only installs files signed with *your* private key, so nobody else can
push an update to your PC.

1. **Install Node.js LTS** from <https://nodejs.org> (also needed for local development).
2. **Generate the signing keys.** In PowerShell:
   ```powershell
   mkdir "$env:USERPROFILE\.tauri" -Force
   npx @tauri-apps/cli signer generate -w "$env:USERPROFILE\.tauri\questline.key"
   ```
   Choose a password when asked. It creates `questline.key` (private, keep it secret and
   backed up: losing it means installed copies can't update any more) and
   `questline.key.pub` (public).
3. **Add two repository secrets:** repo → **Settings → Secrets and variables → Actions →
   New repository secret**:
   - `TAURI_SIGNING_PRIVATE_KEY`: the whole contents of `questline.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose
4. **Paste the public key** (contents of `questline.key.pub`) into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, replacing
   `PASTE_YOUR_PUBLIC_KEY_HERE`.
5. **Check the update URL** in the same file (`plugins.updater.endpoints`) and in
   `src/js/updates.js` (`RELEASES_URL`): it must match your repo,
   `https://github.com/<your-user>/questline/...`.
6. **Make the repository public** (Settings → General → Danger Zone → Change visibility).
   The app downloads `latest.json` and the installer without logging in, which only works
   for public releases. Secrets stay secret in public repos, and nothing private is in the
   code (your Google client ID and all your data live only on your PC).
   *Want the code private?* Keep it private and publish releases to a second, public repo
   instead: set `owner`/`repo` on the `tauri-action` step, give it a personal access token
   with write access to that repo, and point the two URLs above at it.
7. Run **Actions → Build and release → Run workflow**, then download
   `Questline_0.3.x_x64-setup.exe` from the new release under **Releases** and install it
   once over your current version. From then on, updates arrive by themselves.

### Making changes

**Small edits:** open a file on GitHub, click ✏️, edit, commit. A release follows in a
few minutes.

**Real development** (recommended for anything bigger):

1. Install **Visual Studio Build Tools** (workload *Desktop development with C++*),
   **Rust** from <https://rustup.rs>, Node.js, and **GitHub Desktop**.
2. In GitHub Desktop: **File → Clone repository → questline**.
3. In that folder:
   ```powershell
   npm install
   npm run dev
   ```
   A development window opens. Edits to anything in `src/` reload instantly; edits to
   `src-tauri/` recompile automatically. Dev builds keep their own save file
   (`questline-save-dev.json`), so testing never touches your real progress.
   Quit the installed Questline from the tray first: only one copy runs at a time.
4. When it works, commit in GitHub Desktop and click **Push origin**. One push = one release.

`npm run build` locally needs the signing key in the environment
(`$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\questline.key" -Raw`
and the password variable); normally you let GitHub do release builds.

> Windows SmartScreen will warn about the unsigned installer the first time. Click
> **More info → Run anyway**. (Update signing is separate from Windows code signing.)

---

## 2. What's inside

| Area | What it does |
|---|---|
| **Home** | Trainer card (level, HP, XP, gold), your lead pal with a dialog box (teammates beside it), today's timeline merging timed dailies, reminders and events with a "now" line, weekly boss, Spotify player, what's coming up. |
| **Dailies** | Recurring chores with an optional time of day, grouped Morning / Afternoon / Evening / Night. Schedules: every day, certain weekdays, every N days, monthly. Difficulty, category, checklist steps, heads-up notification, streaks. Habits (+/−) live here too. |
| **Reminders** | One-off or repeating tasks with a date and time ("Book tickets for the show, Fri 10:00 AM"). Overdue / Today / Tomorrow / Next 7 days / Later / No date. Snooze 10 min, 1 hour, tonight, tomorrow, next week. |
| **Calendar** | A full page, not a corner widget. Month, week (time grid) and agenda views; click a day for its details; click an empty hour in week view to add an event. Shows your events and reminders, **never dailies**. |
| **Focus** | Full-screen Pomodoro, countdown timer or stopwatch over a slow pixel scene (meadow, rain, firefly camp, seaside, snow), optional soft rain sound, Spotify controls only. Controls fade out while it runs. Sessions earn XP. |
| **Shop** | Your own real-life rewards priced in gold, items (Potions, Streak Shields, Lucky Charm), town themes (preview any theme across the whole app before buying), trainer outfits and focus scenes. |
| **Pals** | Your team of 3, team presets, the Capsule Machine, and the Paldex of all 50 pals (silhouettes for the ones you haven't caught). Click any pal for its evolution line, level, ability and lore. |
| **Journey** | Trainer card with 8 badges, five stats with perks, your team, 20-week heatmap, 14-day chart, 34 achievements with rewards, adventure log. |

### Quality-of-life features

- **Natural-language quick add** from anywhere with `Ctrl+Alt+Q`, or `N` inside the
  app: `dentist fri 3pm`, `water plants every mon thu 8:30am`,
  `event: project review thu 2-3pm`, `pay rent tomorrow 6pm !h #errands`,
  `call the bank in 2 hours`, `12/11` (DD/MM) or `nov 12`. `Tab` switches the type.
- **Command palette** `Ctrl+K`: jump anywhere, search tasks, use items, pause notifications.
- **Tray icon** with quick add, focus, mini window, snooze last reminder, pause notifications.
  Left-click toggles the window. Tooltip shows level, dailies left and the next alarm.
- **Notifications keep working with the window closed** (a native alarm thread fires them).
  Quiet hours, muting during focus, per-task heads-up.
- **Mini window**: a small always-on-top view of today's list plus Spotify.
- **Start with Windows** (starts hidden in the tray), single instance, close-to-tray.
- **Record yesterday**: when a new day starts you can tick off things you did but
  forgot to log, before any damage applies.
- **Rest at the Inn**: pauses damage and keeps streaks while you're sick or away.
- **Weekend mode** (Settings → Day & time): make Sundays, or Saturdays and Sundays,
  rest days. Missed dailies on rest days cost no HP and keep their streaks; anything
  you do still pays out.
- **Custom day start** (default 4 AM) so late nights still count as "today".
- Undo after completing or deleting, repeating reminders that roll forward,
  "move all overdue to tomorrow", starter packs, 12/24-hour clock, Monday/Sunday weeks,
  six colour themes, interface size, reduced motion, sound volume.
- **Backups**: saved atomically, a daily backup kept for 14 days, export/import JSON.

### Keyboard

| Keys | Action |
|---|---|
| `Ctrl+Alt+Q` | Quick add from any app |
| `Ctrl+Alt+F` | Focus mode from any app |
| `Ctrl+Alt+H` | Show / hide Questline |
| `N` | Quick add |
| `Ctrl+K` or `/` | Command palette |
| `1`–`9` | Pages (5 is Focus, 7 is Pals) |
| `F` | Focus mode |
| `←` `→` `T` `M` `W` `A` | Calendar: previous, next, today, month, week, agenda |
| `Space` `R` `S` `Esc` | Focus: start/pause, reset, skip, exit |
| `?` | Shortcut help |

---

## 3. How the game works

The design borrows what works from several apps and leaves out what makes
people quit: Habitica's XP/gold/HP loop and "record yesterday", Finch's growing
companion (here: a collectable team), Duolingo's streak freeze, and a solo version of Habitica's boss quests.

- **XP and gold** for every daily, reminder, habit (+) and focus session.
  Difficulty multiplies rewards (Trivial ½×, Easy 1×, Medium 1.5×, Hard 2×).
- **On-time bonus**: finishing a timed daily or a reminder within 30 minutes of its
  time pays +20%. Long streaks add up to +50%.
- **HP**: unfinished dailies cost HP at the day reset, scaled by difficulty;
  completed checklist steps reduce it. Habits (−) cost a little HP.
- **Fainting** (HP 0) costs half your gold. Levels, items and records are safe.
- **Streak Shield**: used automatically on a bad day, keeps every streak alive.
- **Levels** fully heal you and pay gold. Titles change as you go (Rookie → Legend).
- **Stats**: each category trains a stat. Strength (Health) +2 max HP per level,
  Intellect (Study, Work) +2% XP, Endurance (Home) −3% damage, Charm (Errands, Social)
  +2% gold, Spirit (Self-care, Creative) +1% item finds.
- **Pals**: 50 evolution lines across 9 types (Fire, Water, Grass, Ground, Flying,
  Dark, Fairy, Ghost, Psychic), each with 4 or 5 forms. Rarities: 26 Common, 13 Rare,
  8 Epic, 3 Legendary. You start with Sprigg, Coalby or Drizzle.
  - **Team of 3**: every task, reminder, habit (+) or focus round gives each team pal
    the same EXP as the XP you earned. Pals in storage get nothing.
  - **Evolution** by level: 4-form lines evolve at Lv 8 / 18 / 30, 5-form lines at
    Lv 7 / 15 / 26 / 40. Rarer pals need a bit more EXP per level.
  - **Abilities**: one per evolution line (e.g. Coalby's *Stoke the Fire*: more boss
    damage). Only team pals' abilities are active, and they grow stronger with each form.
    Rarer pals have stronger abilities.
  - **Synergy**: 3 pals of one type gives +15% pal EXP; 3 different types gives +6% gold.
  - **Boss types**: each weekly boss has a type. Every team pal that is strong against
    it adds +15% boss damage.
  - **Capsule Machine**: pull with gold or a Capsule Ticket. It never repeats a pal you
    own, and each new pal raises the price (80 gold, then +8 per pal). Tickets come from
    weekly bosses, achievements and rare drops.
  - **Presets**: save up to 3 teams (e.g. Focus team, Boss team) and swap in one click.
  - Your lead pal's mood follows your day.
- **Weekly boss**: HP is set from how many dailies you have scheduled that week.
  Every completion hits it; every miss heals it. Beat it by the end of the week for
  gold, XP and loot.
- **Drops**: completing tasks sometimes finds gold pouches, Potions, a shield or, rarely,
  a Capsule Ticket (max 6 a day).
- **Achievements** pay gold and sometimes Capsule Tickets when they unlock.

All sprites and creatures are original pixel art; the colour palettes are inspired
by GBA/NDS-era handheld games.

---

## 4. Google account: sync, Drive backups and Calendar

One **Sign in with Google** (Settings → Google account) gives you sync and backups;
Google Calendar is an optional extra you turn on afterwards:

- **Sync across devices**: tasks, progress, pals and game settings stay the same on
  every device signed in with the same account.
- **Daily backups in your Google Drive**, in a normal folder you can open:
  `My Drive/Questline/Backups/questline-YYYY-MM-DD-HHMM.json`. Every backup is a new
  file (nothing is ever overwritten) and the newest 40 are kept. **Settings → Restore…**
  lists them with what's inside ("Lv 3 · 5 dailies · 2 reminders · 80 gold") and puts
  the one you pick back on every device: tasks, progress, pals, and that device's look
  & sound. Your Spotify app's Client ID comes along too, so on a new device Spotify is
  one tap (**Connect Spotify account**); the Spotify sign-in itself stays per device.
- **New device or a fresh start?** Just sign in: if this device has nothing yet,
  Questline takes your progress from Drive automatically, plus the look & sound from
  your newest backup.
- **Google Calendar** (optional, Settings → Google account → **Turn on Google Calendar**):
  events from your Google calendars on the Calendar page, and your own events/reminders
  sent to Google. Questline only asks Google for Calendar permission at that moment.
  Sign-ins for sync and backups alone use non-sensitive permissions, so they show no
  "unverified app" screen and don't count toward Google's 100-user limit for unverified apps.

Questline uses Drive's `drive.file` permission: it can only see the files and
folders it created itself, never the rest of your Drive.

### One-time Google setup (developer, about 10 minutes)

Like other apps, Questline ships with its **own** Google sign-in built in, so on every
device you just click **Sign in with Google** and pick your account. That built-in
"client" is created once by you, as the developer, and stored as two GitHub secrets
that the release build bakes into the app (PC now, the phone app later):

1. Go to <https://console.cloud.google.com>, create a project (e.g. "Questline").
2. **APIs & Services → Library** → enable **Google Calendar API** and **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): External, app name
   "Questline", your email as support and developer contact. Under **Audience**, add
   your Gmail as a **Test user**.
4. **Clients → Create client** → Application type **Desktop app**, name "Questline".
   Copy the **Client ID** and **Client secret**.
5. Under **Audience**, click **Publish app** (status "In production"). Without this,
   Google signs you out every 7 days. No review is needed for personal use (up to
   100 users). When someone turns on Google Calendar, Google warns the app is unverified:
   **Advanced → Go to Questline**. Plain sign-in for sync and backups shows no warning.
6. On GitHub: **repo → Settings → Secrets and variables → Actions → New repository
   secret**, twice:
   - `GOOGLE_CLIENT_ID` = the Client ID
   - `GOOGLE_CLIENT_SECRET` = the Client secret
7. Push any change (or **Actions → Build and release → Run workflow**). From that
   release on, **Settings → Google account** shows only **Sign in with Google**.

Google treats desktop-app client secrets as non-confidential (anyone can read them out
of an installed app), which is why shipping them inside Questline is the normal setup.
**Settings → Google account → Advanced: use my own Google Cloud app** still lets you
paste a different client if you ever need to.

If you signed in before 0.4 (Calendar only), Settings shows **Allow Drive**: sign in
once more and tick the Drive permission.

### Android app

The phone app is built from the same code and released with every Windows version
(`Questline-android.apk` in each GitHub Release). Install it once from
<https://github.com/Ishaan415/questline/releases/latest/download/Questline-android.apk>
(Android asks you to allow installs from your browser). After that, **Settings →
Updates** downloads new versions and Android asks you to confirm.

On the phone: tab bar at the bottom (Home, Dailies, Reminders, Calendar, More), a big
**+ Add** button in thumb reach, dialogs open from the bottom, vibration on taps and
completed tasks, the back button closes dialogs and goes Home, and reminders arrive
as notifications even when Questline is closed. Focus mode has a **Landscape /
Portrait** button.

**One-time Android setup (developer, about 10 minutes):**

1. **Signing key.** Android only accepts an update signed with the same key as the
   installed app, so the key is made once and kept forever. It's in the
   `android-signing/` folder of your local copy (git ignores it). Back it up somewhere
   private (USB stick, a private cloud folder) and never commit it: if it's lost,
   phones need a fresh install to get updates again.
2. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   - `ANDROID_KEYSTORE` = the whole text of `questline-release.jks.base64.txt`
   - `ANDROID_KEYSTORE_PASSWORD` = the text of `password.txt`
   - `ANDROID_KEY_ALIAS` = `questline` (optional; that's the default)
3. **Google sign-in on Android.** In Google Cloud (same project) → **Clients → Create
   client** → **Android**: package name `com.questline.app`, SHA-1 from
   `sha1.txt`. No secret is needed: Android checks the app's signature instead.
4. Push. The **android** job in Actions builds, signs and attaches the APK.

### How sync works

- The shared copy is `My Drive/Questline/questline-sync.json`. Questline syncs when it
  starts, 15 seconds after you change something, every 3 minutes while it's open, and
  when you press the cloud icon in the title bar (green = synced, blinking = syncing,
  red = problem; hover for details).
- Both devices can be used offline. When they meet, changes are **merged**, not
  overwritten: tasks are matched one by one (new ones on either side are kept; an edit
  beats a delete), and gold, XP, HP changes, items and pal EXP from both devices add up.
  If the same thing was edited on both, the most recent edit wins.
- Each device keeps its own window, sound, notification, theme and sign-in settings.
- The first time a device with its own progress meets an existing Drive copy, you choose
  which one to keep. The other is saved to Backups first.
- Yesterday's dailies are only settled after the first sync, so two devices never both
  take damage for the same day.

### What syncs with Google Calendar

- Events from the calendars you tick appear on the Calendar page (refreshed every
  10 minutes, or press the sync button). Events on calendars you can edit can be
  edited or deleted from Questline.
- Events you create in Questline are sent to the calendar you choose.
- Reminders can be sent too, as 30-minute entries. A ✓ is added when you finish one.
  Google's own alerts are turned off for these so you aren't notified twice.
- Dailies are never sent.

The sign-in token is encrypted with Windows DPAPI (tied to your Windows account) and
stored in `%APPDATA%\com.questline.app\`. Google says desktop "client secrets" aren't
truly secret, so keeping it in Settings is fine.

### Other calendars (read-only)

**Settings → Subscribed calendars** accepts any iCal link (`https://…` or `webcal://…`):
Google's "Secret address in iCal format", Outlook's "Publish a calendar" link, iCloud
public calendars, college timetables, holiday calendars.

---

## 5. Spotify

Questline uses two connections and switches between them by itself:

1. **Official Spotify desktop app → Windows media controls.** Instant, works offline,
   no login, works on free accounts. Used whenever the desktop app is the one playing.
2. **Your Spotify account → Spotify Web API** (optional, Premium). Sees and controls
   whatever your account plays anywhere: **Spotifast**, your phone, the web player.
   Used when the desktop app isn't playing; the player then shows the device
   ("on Spotifast"). Checks every ~2.4 s while the player is on screen.
   This mode also shows a **volume slider** with a mute button, for devices that allow
   remote volume (most do; some speakers and TVs don't).

Why both: Spotifast plays through librespot and doesn't publish Windows media
controls, but it is a Spotify Connect device, so the account-wide Web API can see it.

### Connecting your account (once, ~5 minutes)

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. **Create app**: any name and description. **Redirect URIs**: add exactly
   `http://127.0.0.1:43821/callback`. Tick **Web API**, accept the terms, save.
3. Open the app's **Settings**, copy the **Client ID** (no secret needed: Questline uses PKCE).
4. Questline → **Settings → Spotify** → paste → **Connect Spotify account** → approve in the browser.

Spotify's 2026 rules for personal (development-mode) apps require Premium on the
owner's account and allow up to 5 users, which is fine for personal use. The sign-in
token is encrypted with Windows DPAPI in `%APPDATA%\com.questline.app\spotify-token.bin`.

---

## 6. Resource use

- Built with **Tauri 2** (Rust + the WebView2 already in Windows) instead of
  Electron, so the installer is a few MB rather than ~100 MB.
- Expect roughly 60–120 MB of RAM, most of it the shared WebView2 runtime. Idle CPU
  is ~0%: no polling while the window is hidden except a tiny alarm thread that checks
  every 5 seconds.
- Spotify is polled every 1.5 s only while a player is on screen. Focus scenes draw at
  ~12 fps on a 240×135 canvas and stop when the window is hidden or reduced motion is on.

---

## 7. Where things live

```
src/                 the whole UI (plain HTML/CSS/JS, no build step)
  index.html
  css/app.css        design tokens and themes at the top
  js/game.js         rules: rewards, streaks, rollover, boss, shop, achievements
  js/nlp.js          quick-add parser
  js/sync.js         Google Calendar + iCal
  js/scheduler.js    builds the next 48 h of notifications
  js/focus.js        focus mode and the pixel scenes
  js/updates.js      update checks and the progress window
  js/sprites.js      sprite renderer + 8×8 icon set (sprite-data.js has the pixels)
  js/views/*.js      one file per page
src-tauri/
  src/lib.rs         tray, hotkeys, autostart, single instance, close-to-tray
  src/alarms.rs      native notification thread
  src/storage.rs     atomic save + daily backups
  src/google.rs      OAuth (loopback + PKCE) and Calendar API proxy
  src/media.rs       Spotify desktop app via Windows media sessions
  src/spotify_web.rs Spotify Web API (Spotifast, phone…), PKCE sign-in
  src/secure.rs      DPAPI token encryption
  src/updater.rs     self-update from GitHub Releases
scripts/build-preview.mjs   bundles src/ into one HTML file for the web preview
```

Your data: `%APPDATA%\com.questline.app\questline-save.json`, plus `backups\`.
**Settings → Open data folder** takes you there.

### Tweaking it

- **New theme**: copy a `[data-skin="…"]` block in `css/app.css`, then add it to
  `SHOP.skins` in `js/game.js`.
- **Balance**: XP curve, damage, drop rates and prices are all at the top of
  `js/game.js`.
- **New focus scene**: add an entry to `SCENES` in `js/focus.js` (`bake` draws the
  static background once, `draw` animates on top) and to `SHOP.scenes`.
- **Hotkeys**: change the `Shortcut::new(...)` lines in `src-tauri/src/lib.rs`.

---

## 8. Troubleshooting

- **No notifications**: use the installer build (Windows ties notifications to the
  installed app), check Windows **Focus assist / Do not disturb**, and check
  Questline's quiet hours. **Settings → Send a test** checks the whole path.
- **A global hotkey does nothing**: another app owns that combination. Change it in
  `lib.rs` and rebuild.
- **Spotify shows "isn't playing"**: start playback once in the Spotify app; Windows
  only creates its media session after something plays.
- **Google says "access blocked"**: add your Google account under **Test users** on
  the OAuth consent screen.
