# PlayVerse V5 — 3 Game Edition

A single Node + Socket.IO web app for Chrome/mobile with:

- Snakes & Ladders — animated chess-style pawns, smooth real pip dice, snakes, ladders, sound effects
- Tic Tac Toe — fixed 3×3 board that never resizes when X/O appears
- Word Search — turn-by-turn multiplayer; tap first letter then last letter, no dragging needed
- Create/join room codes
- 2–6 players in a room
- Live browser voice chat with mic and speaker controls
- SFX on by default
- Meme reaction tray below the game area
- Open `/admin` live settings page
- No database, no admin password, no environment variables required

## Publish with GitHub + Render

1. Upload every file/folder in this project to the root of one GitHub repository.
2. In Render choose **New > Blueprint** and select the repository.
3. Render reads `render.yaml` and deploys the web service.
4. Wait until the service says **Live**.
5. Open the Render URL in Chrome.

Routes:
- `/` or `/snakes` — game room
- `/tic-tac-toe` — same room, Tic Tac Toe view
- `/word-search` — same room, Word Search view
- `/admin` — live settings
- `/health` — deployment health check

## Permanent manual changes

- `data/settings.json` — default player limits / dice rules / sticker timing / default sound
- `data/stickers.json` — meme reaction list

Commit changes to GitHub and Render redeploys automatically.
