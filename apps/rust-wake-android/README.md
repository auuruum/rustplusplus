# Rust Wake Android app

Minimal Android companion app for the Rust++ `/wake` command.

## Normal user flow

1. Install/open the app.
2. Allow notifications when Android asks.
3. In Discord, run `/wake link`.
4. Enter the 6-digit code in the app.
5. Tap **Link device**.
6. In Discord, run `/wake check code:<code>`.
7. Run `/wake test` to verify that a fullscreen alarm appears.

The regular UI intentionally only shows the link flow, notification settings, and a test alarm button. Old polling URL mode and manual FCM token copy are hidden behind **Developer mode**.

## Developer mode

Developer mode contains fallback/debug tools:

- old polling URL save/start/stop controls;
- manual FCM token refresh;
- manual FCM token copy for `/wake token` fallback.

Normal users should not need this.

## Firebase client config

This app needs Firebase Messaging and Firestore. Generate Android `google-services.json` in Firebase Console and place it at:

```text
apps/rust-wake-android/app/google-services.json
```

`google-services.json` is intentionally ignored by git. It is not the Admin SDK private key, but it is still project-specific config and should not be committed casually.

See `app/google-services.example.json` for the expected shape.

## Build

From this directory:

```bash
./gradlew assembleDebug
```

or use a system Gradle installation if you intentionally do not keep the wrapper in the repo.

The debug APK will be created under:

```text
app/build/outputs/apk/debug/app-debug.apk
```
