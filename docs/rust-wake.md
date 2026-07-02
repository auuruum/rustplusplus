# Rust Wake: Android FCM alarm setup

Rust Wake adds a Discord `/wake` command to Rust++ and a small Android app that can turn bot alerts into a loud fullscreen phone alarm.

Current architecture:

```text
Discord user -> Rust++ bot -> Firebase Cloud Messaging -> Android phone
                 |              ^
                 v              |
              Firestore link code
```

## What is stored where?

### Bot/server side

The bot stores linked devices locally in:

```text
rust-wake/devices.json
```

That file is ignored by git. Each device record is keyed by:

```text
guildId:userId
```

and stores roughly:

```json
{
  "guildId": "discord guild id",
  "userId": "discord user id",
  "token": "android fcm token",
  "deviceName": "Samsung SM-...",
  "updatedAt": "ISO timestamp"
}
```

The FCM token is not a Firebase Admin secret, but it can receive wake pushes for that device. Treat `rust-wake/devices.json` as private runtime data.

### Temporary Firestore link documents

`/wake link` creates a temporary local link code and writes a pending Firestore document under the configured collection, default:

```text
rustWakeLinks/<6-digit-code>
```

The Android app then merges its FCM token into the same document. `/wake check` reads the token, saves it to `rust-wake/devices.json`, then deletes the Firestore document.

### Android app

The app stores its own current FCM token in Android `SharedPreferences` for debugging/manual fallback. Normal users do not need to copy it.

### Firebase Admin credentials

The bot uses a Firebase Admin service account JSON only on the server. Never commit it and never put it in the APK.

Expected env var:

```env
RPP_RUST_WAKE_FCM_SERVICE_ACCOUNT=/absolute/path/to/firebase-adminsdk.json
```

## Bot configuration

In `.env`:

```env
RPP_RUST_WAKE_ENABLED=true
RPP_RUST_WAKE_FCM_SERVICE_ACCOUNT=/opt/rustplusplus/secrets/rust-wake-firebase-adminsdk.json
RPP_RUST_WAKE_FIRESTORE_COLLECTION=rustWakeLinks
```

The service account needs access to:

- Firebase Cloud Messaging HTTP v1;
- Cloud Firestore / Datastore.

The implementation requests OAuth scopes:

```text
https://www.googleapis.com/auth/firebase.messaging
https://www.googleapis.com/auth/datastore
```

## Firebase setup

1. Create/open a Firebase project.
2. Add Android app with package name:

   ```text
   com.auuruum.rustwake
   ```

3. Download `google-services.json` and place it in the Android app folder:

   ```text
   apps/rust-wake-android/app/google-services.json
   ```

4. Enable Firestore Database.
5. For a quick dev test, Firestore rules can temporarily allow only the link collection:

   ```js
   rules_version = '2';

   service cloud.firestore {
     match /databases/{database}/documents {
       match /rustWakeLinks/{code} {
         allow read, write: if true;
       }
     }
   }
   ```

   Do not leave broad test mode rules open for a public/long-lived project.

## User link flow

1. User runs:

   ```text
   /wake link
   ```

2. Bot replies with a 6-digit code.
3. User opens Rust Wake Android app, enters the code, taps **Link device**.
4. User runs:

   ```text
   /wake check code:<code>
   ```

5. Bot saves the FCM token locally and deletes the temporary Firestore link document.
6. User runs:

   ```text
   /wake test
   ```

## Discord commands

| Command | Purpose |
|---|---|
| `/wake link` | Create a short code for the Android app |
| `/wake check code:<code>` | Finish linking after the app writes to Firestore |
| `/wake test` | Send a test fullscreen phone alarm |
| `/wake status` | Show current Rust Wake config/link status |
| `/wake remove` | Remove your saved device token |
| `/wake token value:<token>` | Developer fallback for manual token paste |

## Android UI policy

The normal screen should stay simple:

- enter link code;
- link device;
- open notification settings;
- test alarm.

Debug/fallback tools are hidden under **Developer mode**:

- manual FCM token refresh/copy;
- old polling URL watch mode.

This keeps normal users away from token copy/paste and old ntfy/polling concepts.

## Security notes

- Do not commit Firebase Admin service account JSON.
- Do not commit runtime `rust-wake/devices.json`.
- Do not commit local Android `google-services.json` unless the project owner intentionally accepts that project config being public.
- FCM tokens are per-device delivery tokens. They are not admin credentials, but leaking them can allow unwanted pushes if the sender also has server credentials.
- Production Firestore rules should be narrowed further before a public release. The quick dev rule above is acceptable only while testing.
