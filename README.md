# 🍬 Candy Crush

A match-3 game that runs on your phone, tablet, and laptop — no app store needed.
Built as a **PWA** (Progressive Web App): installable, fullscreen, works offline.

## Play locally

```bash
cd ~/projects/candy-crush
python3 -m http.server 8080
```

Open http://localhost:8080 on your laptop.
On your phone (same Wi-Fi): find your IP with `ip -4 addr show wlan0`,
then open `http://<YOUR-IP>:8080`.

## Install on your phone (real app feel)

Deploy over HTTPS (e.g. GitHub Pages), then:

- **Android (Chrome):** menu → *Install app* / *Add to Home screen*
- **iPhone (Safari):** Share → *Add to Home Screen*

## How to play

- Swipe a candy (or tap one, then tap a neighbor) to swap
- Match 3+ of the same in a row/column to clear them
- Cascades chain for combo multipliers
- 30 moves — beat your best score!
- ⚙️ Settings: player profile (name/email), sound FX, vibration, floating bubbles
- 📲 In-game Install button (Settings → Install) to add it to your phone's home screen

## Tech

Plain HTML/CSS/JS. No build step, no frameworks, no dependencies.
Service worker + web manifest make it a PWA.
