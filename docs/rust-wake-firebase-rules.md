# Rust Wake Firestore rules

## Quick dev rules

Use this only while testing the link flow:

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

This lets the Android app write its FCM token into the temporary link document.

## Why not full test mode?

Firebase test mode usually creates a catch-all rule like:

```js
match /{document=**} {
  allow read, write: if request.time < timestamp.date(...);
}
```

That opens the whole database. For Rust Wake, only `rustWakeLinks` needs client access.

## Future production direction

The bot uses the Firebase Admin service account and bypasses client rules. The Android app only needs to merge limited fields into an existing short-code document:

- `code`
- `fcmToken`
- `deviceName`
- `appVersion`
- `status`
- `linkedAt`

A stricter production rule should validate the code shape, expiry/status, and allowed fields before accepting writes.
