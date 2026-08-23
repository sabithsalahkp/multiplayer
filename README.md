# PlayVerse V10

Private multiplayer games with a ₹49 / 30-day Host Pass. Only the room creator needs an account and active pass. Guests join free using a six-character room code.

## Included

- Email/password host accounts with hashed passwords and secure session cookies.
- Razorpay Orders checkout, server-side HMAC verification, captured-status validation and webhook recovery.
- Idempotent 30-day access activation; duplicate callbacks do not add access twice.
- PostgreSQL persistence for users, sessions, payments and subscription expiry.
- Private room codes with copy action; no public room list or room-code API leak.
- Two-minute reconnection grace after minimising, network changes or brief disconnects.
- Snakes & Ladders, Tic Tac Toe, Word Search, WebRTC voice and reactions.
- PWA manifest, service worker and icons.
- Terms, Privacy, Pricing, Contact, Shipping, Cancellation/Refund, Data Safety and online Account Deletion pages.
- Protected admin APIs and automated project/integration tests.

## Important billing decision

The ₹49 plan is a **one-time 30-day pass**, not an automatic debit mandate. A host manually renews when needed. This is easier to explain, verify and support than an auto-renewing mandate. A later version can use Razorpay Subscriptions or Google Play subscriptions.

## Local setup

1. Install Node.js 18 or newer and PostgreSQL.
2. Copy `.env.example` to `.env` in your hosting dashboard or set the same environment variables there.
3. Run `npm ci`.
4. Run `npm test` and `npm run check`.
5. Run `npm start`.

Without `DATABASE_URL`, the app starts in safe temporary mode for game testing. Accounts disappear on restart and **payment order creation is blocked**, so nobody can be charged without durable storage.

## Razorpay setup

1. In Razorpay, use **Test Mode** and generate Key ID + Key Secret.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` only on the server.
3. Create a separate random webhook secret and set `RAZORPAY_WEBHOOK_SECRET` on the server.
4. In Razorpay Dashboard → Webhooks, add `https://YOUR-DOMAIN/api/payments/webhook`.
5. Enable `payment.captured`, `payment.failed` and `order.paid`.
6. Enable automatic capture in Razorpay Payment Capture settings.
7. Make a test payment and confirm `/health` reports `payments: "ready"`.
8. Submit the live website under Account & Settings → Business website details. Use the policy URLs below and provide a test host login if Razorpay asks.
9. After approval, replace all three test values with Live Mode values. Do not mix test and live keys.

The checkout amount is fixed on the server at 4,900 paise. The frontend cannot change the plan price. Access activates only when signature, stored order, user, amount, currency and captured status all match.

## Razorpay review URLs

- Pricing: `/pricing`
- Terms and Conditions: `/terms`
- Privacy Policy: `/privacy`
- Cancellation and Refunds: `/refund-policy`
- Shipping and Delivery: `/shipping-policy`
- Contact Us: `/contact`

Replace every `PUBLIC_*` contact value before submitting the website. Placeholder contact details can cause review failure.

## Render deployment

The included `render.yaml` creates the web service and PostgreSQL database link. Add all secret environment values in Render before enabling live checkout. WebSockets must be allowed and the service should remain available; a sleeping service can interrupt live rooms.

## Admin

Admin APIs are disabled unless `ADMIN_TOKEN` is set. The admin page asks for this token and stores it only in that browser tab. Never put the token in a URL or repository.

## Play Store

Read `android/PLAY-STORE-SETUP.md`. A PWA ZIP cannot be uploaded directly to Play Console; an Android App Bundle, a live HTTPS domain, signing key and billing-policy decision are still required.

## Health check

`GET /health` returns version, database mode and payment readiness without exposing secrets.
