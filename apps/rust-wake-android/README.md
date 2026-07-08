# Rust Wake Android

Small Android companion app for Rust++ `/wake`.

## Repo strategy

Best setup:

- `rustplusplus` keeps the bot-side `/wake` code and docs;
- Rust Wake Android lives in its own repo;
- do **not** keep APK files inside the `rustplusplus` git history.

If you publish the app separately, put that repo link in the Rust++ README/docs.

## What you need to build

Drop your own Firebase Android config here:

```text
app/google-services.json
```

Template:

```text
app/google-services.example.json
```

## Build

From this folder:

```bash
./gradlew assembleDebug
```

APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## User flow

1. Open app.
2. Allow notifications.
3. In Discord run `/wake link`.
4. Enter the 6-digit code.
5. Tap **Link device**.
6. In Discord run `/wake check code:<code>`.
7. Run `/wake test`.

## Do not commit

- `app/google-services.json`
- APK/build output
- `.gradle/`
- `local.properties`
