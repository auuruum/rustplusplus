# Team Finder Setup

Team Finder uses the external Python project `auuruum/team-detector`.
The bot expects it in `vendor/team-detector` by default and runs it with `uv`.

## Required Software

Program | Note
------- | ----
`Git` | Used to clone or update `team-detector`.
`Python` | `team-detector` requires Python 3.11 or newer.
`uv` | Used to install and run the Python dependencies.

Install `uv` from the official guide:

    https://docs.astral.sh/uv/getting-started/installation/

## Setup

By default the bot runs this setup automatically on startup when `vendor/team-detector`
or its `.venv` is missing.

To install or update it manually, run this from the rustplusplus repository root:

    $ npm run setup:team-detector

The manual command will:

1. clone `https://github.com/auuruum/team-detector.git` into `vendor/team-detector` if it is missing;
2. run `git pull --ff-only` if it already exists;
3. run `uv sync` inside `vendor/team-detector`.

The startup auto-setup clones missing files, runs `git pull --ff-only` by default,
and syncs dependencies. Set `RPP_TEAM_DETECTOR_AUTO_UPDATE=false` to skip the
startup `git pull`.

After that `/teamfinder discover` can run the detector with:

    $ uv run python team_detector.py

## Usage

The `seed` option accepts:

- SteamID64
- Steam profile URL
- Steam vanity URL
- BattleMetrics player ID
- BattleMetrics player URL, for example `https://www.battlemetrics.com/players/916315647`

BattleMetrics player IDs are resolved to SteamID64 before the detector runs. If
BattleMetrics only exposes name history for that player and no Steam identifier,
use the player's SteamID64 or Steam profile URL instead.

## Optional Overrides

Variable | Default
-------- | -------
`RPP_TEAM_DETECTOR_AUTO_SETUP` | `true`
`RPP_TEAM_DETECTOR_AUTO_UPDATE` | `true`
`RPP_TEAM_DETECTOR_REPO` | `https://github.com/auuruum/team-detector.git`
`RPP_TEAM_DETECTOR_PATH` | `vendor/team-detector`
`RPP_TEAM_DETECTOR_COMMAND` | `uv run python`
`RPP_TEAM_DETECTOR_TIMEOUT_MS` | `180000`

Use `RPP_TEAM_DETECTOR_PATH` only if you intentionally keep `team-detector` outside this repository.
