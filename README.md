# PlayVerse Premium V8

Three Chrome multiplayer games in one room:

- Snakes & Ladders
- Tic Tac Toe
- Word Search

## V8 fixes

- Rebuilt the Snakes & Ladders board so the snakes and ladders are always visible at the correct scale.
- Restored the classic wooden-board look and chess-style pawns.
- Added more natural multi-curve snake bodies, forward-facing heads, eyes, tongue, shading and classic wooden ladders.
- Real 3D pip dice with smooth roll animation and sound.
- Server turn lock: the next player cannot roll until dice + pawn + snake/ladder movement is finished.
- Play Again button works after a Snakes & Ladders win.
- If a player leaves during a move, the room recovers instead of leaving the game locked.
- Tic Tac Toe cells stay exactly the same size whether empty, X or O.
- Word Search gives each player 60 seconds. When time reaches zero, the server automatically passes the turn.
- Word timer is visible to everyone with a countdown bar and final-10-second warning.
- Mobile layouts were checked for horizontal overflow.
- Sound effects default ON. Voice mic and speaker controls remain available.

## Deploy

Upload all files to the root of the GitHub repo already connected to Render and commit. Render will redeploy automatically.

No database, admin password, persistent disk or environment variable is required for this build.

Health check: `/health` should return version `8.0.0`.
