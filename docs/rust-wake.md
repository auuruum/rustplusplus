# Rust Wake

Rust Wake is the optional Android wake-alarm companion for Rust++ `/wake`.

Default behavior: enabled.

If you want Rust Wake to disappear completely, set:

```env
RPP_RUST_WAKE_ENABLED=false
```

That hides the `/wake` slash command and the Rust Wake smart-alarm settings UI.

## Recommended structure

Best setup is:

- `rustplusplus` repo: bot-side `/wake` command, Firebase Admin usage, docs;
- separate Rust Wake Android repo: app source only;
- no APK files committed into `rustplusplus`.

In other words, keep the bot here, keep the Android app in its own repo, and link the two with short docs.

## Bot side

Server/runtime data stays on the Rust++ side:

```text
rust-wake/devices.json
```

Firebase Admin service account is **server only**:

```env
RPP_RUST_WAKE_ENABLED=true
RPP_RUST_WAKE_FCM_SERVICE_ACCOUNT=/absolute/path/to/firebase-adminsdk.json
RPP_RUST_WAKE_FIRESTORE_COLLECTION=rustWakeLinks
```

Do not ship the Admin SDK JSON inside the Android app.

## Android side

The Android app needs its own client config:

```text
app/google-services.json
```

That file belongs in the Android app repo and should stay out of git unless you intentionally want that Firebase client config public.

## Build the Android app

Inside the Rust Wake Android repo:

```bash
./gradlew assembleDebug
```

APK:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Link flow

1. In Discord run `/wake link`.
2. Open Rust Wake Android.
3. Enter the 6-digit code.
4. Tap **Link device**.
5. In Discord run `/wake check code:<code>`.
6. Run `/wake test`.

## Commands

| Command | Purpose |
|---|---|
| `/wake link` | Create a short code for the Android app |
| `/wake check code:<code>` | Finish linking after the app writes to Firestore |
| `/wake test` | Send a test wake alarm |
| `/wake status` | Show current link/config status |
| `/wake remove` | Remove saved device token |
| `/wake token value:<token>` | Manual fallback |

## Publish rule

If you publish the Android app repo separately, keep Rust++ docs short: just point to the app repo, say where to place `google-services.json`, and show `./gradlew assembleDebug`.
