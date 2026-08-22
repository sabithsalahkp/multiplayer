# PlayVerse v4 — Multiplayer Game Hub

One Node + Socket.IO app, one Render service, no database, no admin password, no environment variables required.

## Games

- Premium animated Snakes & Ladders
- Tic Tac Toe
- Arrow Puzzle: 12 sequential levels (Hard → Very Hard → Extreme)
- Carrom Pool with server-side real-time physics

## Shared room features

- Create / join room code
- 2–6 room members
- Live microphone voice chat
- Mic mute/unmute
- Speaker on/off
- Loud game sound effects on by default
- Image-based meme sticker tray directly below the game board
- Sticker click broadcasts to everyone in the room, including sender
- Open `/admin` live-control page
- Game pages use one domain with URL changes:
  - `/snakes`
  - `/tic-tac-toe`
  - `/arrow-puzzle`
  - `/carrom`

## Publish on GitHub + Render

1. Extract this ZIP.
2. Upload every file/folder inside it to the root of one GitHub repo.
3. In Render choose New > Blueprint.
4. Select the repo.
5. Render reads `render.yaml` and deploys the Node web service.
6. Wait for Live.
7. Open the Render URL.

No environment variables are needed.

## Permanent manual changes

- Stickers: edit `data/stickers.json` in GitHub.
- Game defaults: edit `data/settings.json` in GitHub.
- Commit; Render redeploys automatically.

The `/admin` page changes settings/sticker on-off/name only in the currently running server memory. Those live changes reset after redeploy/restart.

## Browser notes

- Use the HTTPS Render URL so microphone permission works.
- Browser audio cannot legally autoplay before user interaction; the first tap/click unlocks the already-enabled game sound system.
- WebRTC uses public STUN. Some restrictive mobile networks can require TURN for voice, but no TURN is needed for normal testing/publishing.
