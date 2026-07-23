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

1. clone `https://github.com/auuruum/team-detector.git` and check out the configured resilient integration ref;
2. fetch, check out, and fast-forward that ref if the repository already exists;
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

Plain `/teamfinder discover seed:<profile>` uses a bounded smart crawl by default:

- public friends and two pages of profile comments are checked immediately;
- direct friends are eligible for traversal at score `2`;
- comment-heavy/high-confidence branches are inspected before plain friend branches;
- at most 75 profiles and five graph levels are inspected;
- requests use a 200 ms host delay, persistent SQLite cache, stale fallback, retry/backoff,
  and a shared serial execution queue;
- a 150-second crawl budget returns the best partial result before the 240-second child-process timeout;
- comments are expanded only for the seed and high-confidence profiles instead of every
  profile in the budget.

Advanced slash options override these defaults. Every run attaches
`teamfinder_full_report.txt`, so candidates outside the ten-player Discord preview are
still visible and searchable.

The optional `battlemetricsid` server option is not required when Rust+ is connected.
Team Finder uses the active Rust server and its local/A2S roster sources. An internal
`rustplus:<serverId>` label satisfies the detector CLI without claiming that it is a
BattleMetrics server ID or making a BattleMetrics request.

## Player Roster Sources

Rust++ selects the current-player source for each run:

1. a fresh authorized BattleMetrics API snapshot already held by Rust++, when available;
2. Steam `GetServersAtAddress` query-port discovery followed by public `A2S_PLAYER`;
3. a hosted A2S transport retry for oversized Rust UDP responses;
4. a local snapshot no older than three minutes as display-only recent evidence after a transient source failure;
5. a structured partial result when none of these sources provides a roster.

The A2S fallback provides display names, scores, and session duration, but not
SteamID64. Team Finder therefore marks exact unique display-name matches separately
from ambiguous duplicate-name matches. It does not turn a nickname match into a
permanent identity binding.

Some Rust servers disable or censor `A2S_PLAYER`. Population-only `A2S_INFO` data is
never presented as a player roster.
BattleMetrics snapshots are also marked incomplete when the API reports fewer included
player names than the server population, for example 87 names while the population is
1145. Names present in such a partial live snapshot are positive evidence; absence from
the capped list is not offline evidence.
Cached snapshots never add an online score, say "online now", or drive live Team Finder expansion.

BattleMetrics website scraping is not used. See [Local Roster Intelligence](local-roster-intelligence.md)
for source priority, persistence, and identity limits.

## Optional Overrides

Variable | Default
-------- | -------
`RPP_TEAM_DETECTOR_AUTO_SETUP` | `true`
`RPP_TEAM_DETECTOR_AUTO_UPDATE` | `true`
`RPP_TEAM_DETECTOR_REPO` | `https://github.com/auuruum/team-detector.git`
`RPP_TEAM_DETECTOR_REF` | `feature/resilient-teamfinder-fetching`
`RPP_TEAM_DETECTOR_PATH` | `vendor/team-detector`
`RPP_TEAM_DETECTOR_COMMAND` | `uv run python`
`RPP_TEAM_DETECTOR_TIMEOUT_MS` | `240000`
`RPP_TEAM_DETECTOR_CACHE_PATH` | `data/teamfinder/steam_cache.sqlite`
`RPP_TEAM_DETECTOR_REQUEST_RETRIES` | `3`

Use `RPP_TEAM_DETECTOR_PATH` only if you intentionally keep `team-detector` outside this repository.
