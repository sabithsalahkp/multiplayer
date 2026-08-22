# Snakes & Ladders Live — Simple GitHub + Render version

This version is intentionally simple: **no admin password, no database, no persistent disk, no sticker upload service**.

- `/` = multiplayer game
- `/admin` = open admin page

## Included

- 2–6 player room multiplayer
- Create / join room codes
- Server-controlled dice and turns
- Snakes & ladders board
- Browser voice chat with mic mute and speaker mute
- Sticker tray
- Sticker popup appears on sender + selected opponent, or everyone
- Open admin page for live game settings and room status
- Live sticker rename/on/off controls
- Three starter sticker images
- Render Blueprint config included

## Fastest publish

1. Create a new GitHub repository.
2. Upload **all files and folders from this project** to the repository root.
3. In Render choose **New > Blueprint**.
4. Connect that GitHub repository.
5. Render reads `render.yaml`; click deploy/create service.
6. Wait until Render says **Live**.
7. Game: your Render URL.
8. Admin: your Render URL + `/admin`.

There is **no password or environment variable to create**.

## What you change manually in GitHub

### Add a permanent sticker

1. Upload the image to `public/stickers/`.
2. Open `data/stickers.json`.
3. Add an entry such as:

```json
{"id":"funny","name":"Funny","url":"/stickers/funny.png","enabled":true,"order":4}
```

Use a unique `id`, exact image filename in `url`, and a new `order` number.
Commit the change. Render will redeploy from GitHub.

### Permanently change game defaults

Edit `data/settings.json` in GitHub:

- `maxPlayers`: 2 to 6
- `minPlayers`: 2 to 6
- `exactRollToWin`: true/false
- `extraTurnOnSix`: true/false
- `stickerPopupMs`: sticker popup duration
- `stickerCooldownMs`: delay before another sticker can be sent

Commit the change and Render redeploys.

## Admin page behavior

The admin page has no password. It can change game settings and sticker names/on-off state immediately for the currently running server. Those live changes are intentionally not stored permanently and reset when Render restarts or redeploys.

For permanent changes, edit the two JSON files in GitHub as described above.

## Important

Because `/admin` has no password, anyone who knows the `/admin` URL can change the live settings. This is the tradeoff for having zero admin setup.

For microphone access, use the HTTPS Render URL. Public STUN servers are included. Some difficult mobile networks may need TURN for reliable voice, but no TURN setup is required just to publish and test the game.
