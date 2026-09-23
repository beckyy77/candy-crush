# ⚔️ Versus Mode Setup — Firebase (free, ~5 minutes)

Versus mode lets two friends race on the same board over the internet, with
live scores, quick-chat and text chat — like 8 Ball Pool. It runs on Google
Firebase's **free tier**, which is plenty for playing with friends
(100 simultaneous players, ~1 GB traffic/month).

The rest of the game works 100% offline without this. Versus needs internet.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with any Google account
2. Click **Add project**
3. Name it e.g. `dolly-crush` → continue → (Google Analytics optional — skip it) → **Create project**

## 2. Turn on the Realtime Database

1. In the left menu: **Build → Realtime Database → Create Database**
2. Pick a location (closest to you, e.g. `europe-west1` in Belgium or `us-central1`)
3. Choose **Start in test mode** (we'll paste safer rules below in a second)
4. Open the **Rules** tab, replace everything with this and click **Publish**:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      "$room": {
        ".read": "auth != null",
        ".write": "auth != null",
        "chat": {
          "$msg": {
            ".validate": "newData.child('text').val().length <= 140 && newData.child('name').val().length <= 30"
          }
        }
      }
    }
  }
}
```

## 3. Allow anonymous sign-in

The rules above require players to be signed in — the game signs them in
anonymously (no passwords, no emails, instant):

1. Left menu: **Build → Authentication → Get started**
2. Tab **Sign-in method** → click **Anonymous** → toggle **Enable** → **Save**

## 4. Copy your web app keys

1. Left menu: **Project settings** (⚙️ gear) → scroll to **Your apps**
2. If there's no app: click the **Web** icon `</>` → nickname `dolly web` → **Register app**
3. Copy the `firebaseConfig` values from the snippet shown

## 5. Paste them into the game

Open **`js/firebase-config.js`** and replace the placeholders:

```js
window.FIREBASE_CONFIG = {
  apiKey:            "AIza...your real key...",
  authDomain:        "dolly-crush.firebaseapp.com",
  databaseURL:       "https://dolly-crush-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "dolly-crush",
  appId:             "1:1234...:web:abcd...",
};
```

⚠️ **`databaseURL` is required.** The Firebase snippet sometimes omits it —
it's the URL you see at the top of the Realtime Database page
(your project id + region + `firebasedatabase.app`).

## 6. Ship it & battle! 🎮

- Commit + push to GitHub Pages (or your host)
- Both players open the site → tap **⚔️** in the top bar
- Player 1: **Create room** → share the code / QR / link
- Player 2: **Join** with the code (or just tap the shared link)
- Host presses **🚀 Start match** → 3…2…1… same board, 20 moves, highest score wins
- Winner takes **100 🪙**, loser 25 🪙 consolation, draw 50 🪙 — records show on the leaderboard

### Testing on one computer

Open the game in two browser windows side by side (one normal window, one
private/incognito window so the profiles don't clash). Create a room in one,
join with the code in the other — full match, chat and all. 🍭

---

## How it works (the nerd corner)

- Room codes: 5 letters/digits (`K7M2Q` style), stored at `rooms/{CODE}`
- The host generates a random **seed**; both clients build the identical
  starting board from it (the game has a deterministic RNG, `mulberry32`)
- Scores sync ~5×/second via the Realtime Database; presence flags +
  `onDisconnect()` detect rage-quits → forfeit after ~6 s
- Chat: quick phrases in-game (8-ball style bubbles), free text in the lobby;
  throttled to 1 message / 1.2 s, max 140 chars, validated by DB rules
- Rooms auto-delete when the host leaves (instant in lobby, ~20 s after a result)

## Troubleshooting

| Problem | Fix |
|---|---|
| ⚔️ menu says "not set up yet" | `js/firebase-config.js` still has `PASTE`/`YOUR-PROJECT` placeholders |
| "Permission denied" in console | Rules not published (step 2) or Anonymous auth off (step 3) |
| Nothing happens on Join | `databaseURL` missing/wrong in the config — check step 5 |
| Works on my laptop, not my phone | Phone needs HTTPS (GitHub Pages has it) and internet |
