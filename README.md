# PlayVerse V12

Compact multiplayer games for friends with live Socket.IO voice, live popup chat, 10 clean meme stickers, Snakes & Ladders, Tic Tac Toe, and Word Search.

## V12 highlights
- Exactly 10 unique, clean meme stickers; no relationship or double-meaning stickers.
- Word Search uses a much larger general vocabulary bank and up to 10 words per board.
- Incoming messages show a temporary preview when chat is closed.
- Games and Players are hidden in the bottom-left ROOM drawer.
- SFX is always enabled and the SFX toggle was removed.
- Voice uses smaller PCM chunks with ordered Socket.IO relay and low-latency playback scheduling.
- Fresh V12 asset names and a clean-reset service worker delete older caches.

## Run
```bash
npm install
npm start
```

Open `http://localhost:3000` locally. Production microphone access requires HTTPS.

Health check: `/health` returns version `12.0.0`.
