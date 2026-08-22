# PlayVerse Premium V7

Three multiplayer browser games: Snakes & Ladders, Tic Tac Toe, and Word Search.

## V7 changes
- Restored old-school premium Snakes & Ladders board styling with wooden frame, parchment squares, classic chess-style pawns, richer snakes/ladders, pip dice, smooth turn locking and full movement animation.
- Word Search now gives each player exactly 60 seconds per turn. If time expires, the server automatically passes the turn to the next player.
- Word timer is server-authoritative and visible to every player with a countdown bar.
- Tic Tac Toe remains fixed-size and multiplayer.
- Voice, speaker, SFX and meme reactions remain included.

## Deploy
Upload all files to the GitHub repository already connected to Render. Render will redeploy automatically. No database, admin password or environment variables are required for this build.

Health check: `/health` should report version `7.1.0`.
