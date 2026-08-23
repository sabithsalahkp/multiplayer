# PlayVerse V10

Simple friend-play version for GitHub + Render.

## Public room flow

- Open the site.
- Enter your name.
- Create a room, or tap a visible room created by another player.
- No room code, password, account or database is required.
- Open rooms update live for everyone visiting the site.

## Games

- Snakes & Ladders: classic wooden board, clean snakes, chess-style pawns, 3D pip dice, locked turn animations.
- Tic Tac Toe: fixed-size 3×3 multiplayer board.
- Word Search: turn-based word finding with a server-controlled 60-second timer shown above the letter grid.

## Installable

The project includes a web app manifest, icons and service worker. On supported Chrome browsers an Install Game button appears when the site meets install requirements. The browser's Install/Add to Home Screen option also works.

## Publish

1. Upload all files/folders to the root of one GitHub repository.
2. Connect the repository to Render as a Web Service or Blueprint.
3. Build: `npm install`
4. Start: `npm start`
5. No environment variables are required.

Health check: `/health` returns version `10.0.0`.


## V10 live communication
- Live room text chat is synchronized through Socket.IO and keeps the latest 80 room messages in memory.
- Voice uses a safer WebRTC negotiation flow with queued ICE candidates, ICE restart, reconnect resync, echo cancellation, noise suppression and automatic gain control.
- For reliable voice across strict mobile/carrier NATs, configure TURN_URLS (comma-separated), TURN_USERNAME and TURN_CREDENTIAL on the server. STUN-only mode remains available when TURN is not configured.
- Cache shell is bumped to V10 and main HTML/CSS/JS use no-store/update checks to avoid stale deployments.
