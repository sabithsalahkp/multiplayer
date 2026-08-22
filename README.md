# Snakes & Ladders Live — Premium Animated Render Build

A ready-to-publish Chrome/mobile multiplayer Snakes & Ladders game.

## URLs

- `/` — game
- `/admin` — open admin controls (no password)
- `/health` — health check

## Included in this build

- 2–6 player create/join rooms
- Server-controlled random dice and turns
- Synchronized dice-roll animation for every player
- Loud layered dice clack/spin/landing effects
- Square-by-square character jumping with jump + landing sounds
- 3D mini-character pieces instead of dots
- Players sharing one square remain visible beside each other
- Reworked snakes whose heads face outward/forward instead of looking back down their body
- Animated snake scales, eyes, tongue, hiss and slide effects
- Animated wooden ladders with stronger climb/step audio
- Winner popup waits until the complete final movement and victory jump have finished
- Loud winner fanfare
- Sound is ON by default; SOUND ON/OFF also controls remote voice playback
- Live microphone mute/unmute
- Sticker tray directly below the board
- 12 popular reaction stickers: 😂 🤣 😭 ❤️ 🔥 😎 💀 🤡 😡 👏 🥳 😱
- Sticker pop animation + loud pop/sparkle sound
- Stickers can target everyone, another player, or yourself; sender also sees targeted sticker popups
- Responsive mobile/desktop layout
- `/admin` live room/settings/sticker controls

## Publish: GitHub + Render

1. Upload every file and folder from this project into the root of one GitHub repository.
2. Render → **New → Blueprint**.
3. Select the GitHub repository.
4. Deploy. `render.yaml` already contains the service setup.
5. Wait until Render says **Live**.
6. Test `https://YOUR-RENDER-URL/health` — it should return `{"ok":true}`.
7. Open the main URL on two devices, create a room, then join it with the code.

No database, environment variable, admin password, persistent disk, or separate backend setup is required.

## Permanent sticker changes

The default popular stickers are emoji reactions and require no image files.

To add your own image sticker later:

1. Upload PNG/JPG/WEBP into `public/stickers/`.
2. Add it to `data/stickers.json`, for example:

```json
{"id":"funny","name":"Funny","url":"/stickers/funny.png","enabled":true,"order":20}
```

Commit to GitHub; Render redeploys automatically.

For an emoji sticker you can use:

```json
{"id":"heart-eyes","name":"Love it","emoji":"😍","enabled":true,"order":21}
```

## Permanent game rule changes

Edit `data/settings.json` and commit:

- `maxPlayers`: 2–6
- `minPlayers`: 2–6
- `exactRollToWin`: true/false
- `extraTurnOnSix`: true/false
- `stickerPopupMs`: popup duration
- `stickerCooldownMs`: sticker send cooldown

## Sound note

Chrome requires the first user tap/click before a website can produce audio. Sound is already ON by default, and the first tap unlocks it automatically. After that, game effects play normally.

## Voice note

Microphone access requires HTTPS; Render provides HTTPS. Public STUN is included. Very restrictive mobile networks can still require TURN for peer-to-peer voice, but this does not affect rooms, dice, movement, or stickers.

## Admin note

`/admin` intentionally has no password. Live admin changes reset after a Render restart/redeploy; permanent defaults are the JSON files in GitHub.
