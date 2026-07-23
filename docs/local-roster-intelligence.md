# Local Roster Intelligence

Rust++ keeps a small local roster database so short BattleMetrics or A2S outages do not immediately break roster-dependent features.

## Source order

1. An authorized BattleMetrics API response using the operator's own `RPP_BATTLEMETRICS_TOKEN`.
2. The public Steam A2S query protocol (`A2S_PLAYER`) when the server exposes player names.
3. A hosted A2S transport retry when Rust sends an oversized IP-fragmented response that cannot reach the bot directly.
4. A local snapshot no older than three minutes.

Rust++ discovers the A2S query port from Steam server metadata. If the game-port `connect`
value is unavailable after pairing, IP-only discovery is accepted only when Steam reports
exactly one Rust server at that address. The bot does not guess between multiple servers.

The hosted retry uses the documented Hexane GameDig API by default and sends only the public A2S query IP and port. It does not receive Discord credentials, Steam IDs, tracker targets, or Rust+ pairing data. Set `RPP_A2S_RELAY_URL=off` to disable it. To self-host a compatible GameDig endpoint, set `RPP_A2S_RELAY_URL` to a URL template containing `{host}` and `{port}`. Direct A2S remains the first attempt.

BattleMetrics website scraping is intentionally not implemented. BattleMetrics-specific identity, profile history, and player-ID lookups still require an authorized API token.

Without a token, anonymous BattleMetrics polling is skipped instead of generating a 403 every minute.
An operator may still save a known numeric BattleMetrics server ID in the existing Server Edit modal;
this associates the local/A2S roster with Team Finder but does not claim that BattleMetrics data was fetched.
Use a SteamID64 or Steam profile as the Team Finder seed when API-backed BattleMetrics player-ID lookup is unavailable.

## Stored data

The database is written to:

    database/local_roster.db

Docker Compose mounts `./database:/app/database` so the observations survive container recreation.

It contains:

- the latest complete roster snapshot for each Discord guild and Rust server;
- source and observation timestamp metadata;
- display-name counts;
- join/leave count changes observed after the first baseline.

Names-only join/leave observations are retained for seven days by default and pruned automatically.

The first successful roster is a baseline and does not create fake join events for everyone already online.
Only complete live BattleMetrics/direct-A2S/hosted-A2S snapshots produce tracker transitions. A cached snapshot is display-only,
and changing providers establishes a new baseline instead of generating synthetic mass joins/leaves.

## Identity limits

A2S exposes display names, scores, and session duration. It does not expose SteamID64 or BattleMetrics player IDs.

Rust++ therefore:

- does not permanently bind an A2S name to a Steam or BattleMetrics identity;
- treats duplicate names as ambiguous;
- never substitutes a population count for a player roster;
- preserves the previous tracker state when the roster is unavailable, incomplete, or cached;
- records name-count changes, not invented player identities.

A Rust server may censor or disable `A2S_PLAYER`. In that case live roster tracking is unavailable unless the
operator supplies an authorized BattleMetrics API token. A fresh local snapshot can show recently observed names,
but cannot claim that they are still online or generate login/logout notifications.

## Features using the source layer

- tracker online/offline evaluation and notifications;
- the information-channel online roster;
- Team Finder current-roster matching;
- local join/leave observation history.

The existing BattleMetrics-only commands that require player IDs, private profile relationships, or historical provider data remain API-only.
