PlayVerse V11 voice reset

Voice transport: Socket.IO relayed PCM (16 kHz mono)
- No WebRTC peer negotiation
- No STUN/TURN dependency
- Designed for small 2-6 player rooms
- Requires HTTPS in production for browser microphone permission
- Voice starts automatically after joining/creating a room; user can turn it off
- Audio chunks are sent as volatile Socket.IO binary messages so stale audio is dropped rather than queued

Cache reset
- App files renamed to app-v11.js and style-v11.css
- Service worker cache renamed to playverse-v11-shell-20260823-2153
- Service worker deletes all old caches during install/activate
- JS/CSS/worklet are network-first with cache:no-store
