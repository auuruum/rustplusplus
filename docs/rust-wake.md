# Rust Wake

Rust Wake is an optional wake/alarm feature for Rust++.

## How it works

When `RPP_RUST_WAKE_ENABLED=true`, Rust++ can work with the Android app here:

`https://github.com/auuruum/Rust-Awake`

Flow:

- Rust++ receives a Smart Alarm trigger
- each Smart Alarm can have its own `WAKE` toggle
- if `WAKE` is ON, Rust++ sends a wake push to linked Android device(s)
- the Android app turns it into a loud fullscreen alarm

## Current behavior

- Default: off
- Enable the feature with `RPP_RUST_WAKE_ENABLED=true`
- If the feature is disabled, `/wake` and Rust Wake UI stay hidden
- If the feature is enabled, every Smart Alarm gets its own `WAKE` button
- `WAKE ON` means that specific alarm is allowed to wake the phone
- `WAKE OFF` means that alarm only stays a normal alarm/notification

## Anti-spam

Rust Wake uses a small cooldown for repeated triggers, so one alarm should not keep waking the phone every second.

## Android app

Android app repo:

`https://github.com/auuruum/Rust-Awake`
