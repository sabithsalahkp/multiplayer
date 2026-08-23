# PlayVerse V11

Installable public-room multiplayer game for friends.

## What is in V11
- Snakes & Ladders, Tic Tac Toe and 60-second Word Search.
- Public rooms: enter a name, create a room, or tap a visible room to join.
- Reliable live voice uses a Socket.IO relayed 16 kHz mono audio stream instead of peer-to-peer WebRTC. No STUN/TURN setup is required.
- Voice asks for microphone permission after entering a room and turns on automatically when allowed. The player can turn it off at any time.
- Right-side floating CHAT button opens a live message popup without leaving the game.
- 21 image-based classic meme reaction stickers. No emoji-only stickers.
- Reconnect grace keeps a player seat for 15 seconds during a brief network drop.
- PWA install support with a completely new V11 cache shell.

## Deploy
1. Upload this whole folder to one GitHub repository.
2. Deploy it as a Node web service (Render works).
3. Build command: `npm install`
4. Start command: `npm start`
5. Use HTTPS in production. Browsers require a secure context for microphone access.

No database or environment variables are required for the current in-memory room system.

Health check: `/health` returns version `11.0.0`.
