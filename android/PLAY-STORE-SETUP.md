# PlayVerse Android / Play Store setup

## What is ready

The website is installable as a PWA and includes app icons, a manifest, service worker, HTTPS-compatible permissions, a Privacy Policy, Data Safety summary and online account deletion.

## What is still required before upload

1. Deploy PlayVerse on its final HTTPS domain and test rooms, voice, accounts and payments there.
2. Choose an Android package name. The suggested value is `com.quartz.playverse`.
3. Choose the Play billing route below before generating the release build.
4. Generate a Trusted Web Activity with Bubblewrap from the live `/manifest.webmanifest`.
5. Create and securely back up the Android signing key.
6. Add the final signing certificate SHA-256 fingerprint to `/.well-known/assetlinks.json` on the same domain.
7. Build and sign an `.aab`, test it through Play Console Internal Testing, then complete Store Listing, App Access, Data Safety, Content Rating, Ads, Target Audience and Account Deletion declarations.

## Billing choice — decide before release

The Host Pass unlocks digital functionality used inside the app. For a normal Play-distributed Android app, use Google Play Billing.

If you want Razorpay as an in-app option for users in India, first enrol the app in Google Play's India alternative/user-choice billing program, offer the required Google Play choice where applicable, integrate Google's Alternative Billing APIs, report alternative transactions within Google's required timeframe and pay the applicable service fee. Do not submit a Razorpay-only Play build without completing those requirements.

The existing Razorpay flow is correct for the website/PWA. Keep it as the web channel until the Play billing route is completed.

## App review details

- Privacy URL: `https://YOUR-DOMAIN/privacy`
- Account deletion URL: `https://YOUR-DOMAIN/delete-account`
- Data safety explanation: `https://YOUR-DOMAIN/data-safety`
- Terms: `https://YOUR-DOMAIN/terms`
- Support: `https://YOUR-DOMAIN/contact`
- App Access: provide Google reviewers with a working host test account and clear steps to reach paid features. Guests can be reviewed with a live room code, but the host account is still needed to inspect the full app.

## Background connection limitation

The server keeps a disconnected player's place for two minutes and the client automatically resumes after a brief minimise or network change. Android may suspend or kill any web app in the background, so indefinite live connection while minimised cannot be guaranteed by a PWA/TWA. A native foreground service would create additional battery, notification and Play policy obligations and is not included.
