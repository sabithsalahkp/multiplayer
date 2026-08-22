# Snakes & Ladders Live — Animated GitHub + Render version

A ready-to-publish multiplayer Snakes & Ladders game for Chrome/mobile browsers.

## Pages

- `/` — multiplayer game
- `/admin` — open admin controls (no password)
- `/health` — server health check

## New premium game features

- Fully animated pawn movement, square by square
- Large 3D-style board-game pawns instead of dots
- Every player stays visible; players sharing the same square are automatically arranged beside each other
- Detailed animated SVG snakes with heads, eyes, scales and tongue movement
- Wooden 3D-style ladders
- Snake-slide animation and ladder-climb animation
- Dice shake animation
- Built-in game sound effects generated in the browser: dice, steps, snake hiss, ladder chime, turn alert, stickers, join, start and win fanfare
- SOUND button mutes/unmutes both remote voice playback and game effects
- Live microphone mute/unmute
- Create/join rooms for 2–6 players
- Server-controlled dice and turns
- Sticker popups sent to yourself, another player, or everyone
- Better connection status and room-create error feedback
- Responsive desktop/mobile design

## Fast publish with GitHub + Render

1. Create a GitHub repository.
2. Upload every file/folder from this project to the repository root.
3. In Render choose **New > Blueprint** and select the repository.
4. Render reads `render.yaml` and creates the Node Web Service.
5. Wait until the service says **Live**.
6. Open the Render URL and test `/health`. It should return `{ "ok": true }`.
7. Open the main URL on two devices, create a room on one and join with the room code on the other.

No database, password, persistent disk or environment variable is required for the normal game.

## Permanent sticker changes

Upload the image into `public/stickers/`, then edit `data/stickers.json` and add a matching entry.

Example:

```json
{"id":"funny","name":"Funny","url":"/stickers/funny.png","enabled":true,"order":4}
```

Commit to GitHub. Render will redeploy.

## Permanent rule changes

Edit `data/settings.json`:

- `maxPlayers`: 2–6
- `minPlayers`: 2–6
- `exactRollToWin`: true/false
- `extraTurnOnSix`: true/false
- `stickerPopupMs`: sticker popup duration
- `stickerCooldownMs`: delay before another sticker

## Voice note

Microphone access needs HTTPS, which the Render public URL provides. STUN is included. Some restrictive mobile networks can require TURN for voice connectivity, but this is optional and does not affect normal game rooms/dice/stickers.

## Admin note

`/admin` is intentionally open because this build was requested with no admin password. Live admin changes reset when Render restarts/redeploys. Permanent defaults should be changed in GitHub.
