# Rust Wake

Rust Wake is an optional wake/phone-alarm feature for Rust++.

## What it does

When enabled, Rust++ can work with the Android app here:

`https://github.com/auuruum/Rust-Awake`

The idea is simple:

- Rust++ detects/handles the event
- the bot sends a wake push
- the Android app turns it into a loud fullscreen alarm

## Current state

- Default: off
- Enable with `RPP_RUST_WAKE_ENABLED=true`
- If disabled, `/wake` and Rust Wake UI are hidden

## Important note

Right now Rust Wake is a global feature toggle. It is **not yet** a per-smart-alarm wake toggle.

That means enabling `RPP_RUST_WAKE_ENABLED=true` does **not** automatically add a dedicated WAKE button to every Smart Alarm card.

## Android app

Android app repo:

`https://github.com/auuruum/Rust-Awake`

It should stay separate from the main Rust++ repo.
