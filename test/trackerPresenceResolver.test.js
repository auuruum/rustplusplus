const Test = require('node:test');
const Assert = require('node:assert/strict');

const TrackerPresenceResolver = require('../src/util/trackerPresenceResolver.js');

const SERVER_ID = '137.83.91.168-28082';

function censoredRoster() {
    return {
        source: 'a2s_relay',
        available: false,
        complete: false,
        observedAt: 1784821847927,
        players: [],
        nameCounts: {},
        reason: 'A2S_PLAYER returned no names while A2S_INFO reports connected players.'
    };
}

function tracker(players) {
    return {
        serverId: SERVER_ID,
        players,
        rosterSource: 'a2s',
        rosterAvailable: false
    };
}

function rustplus(players) {
    return {
        isOperational: true,
        serverId: SERVER_ID,
        team: { players }
    };
}

Test('production regression: censored Moose A2S is replaced by SteamID-authoritative Rust+ team presence', () => {
    const content = tracker([
        { name: 'Rolls Royce', steamId: '76561198880886557', playerId: null },
        { name: 'aurum', steamId: '76561198982669820', playerId: null }
    ]);
    const result = TrackerPresenceResolver.apply(content, censoredRoster(), rustplus([
        { steamId: '76561198880886557', isOnline: true },
        { steamId: '76561198982669820', isOnline: true }
    ]));

    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.covered, ['76561198880886557', '76561198982669820']);
    Assert.equal(content.rosterSource, 'rustplus_team');
    Assert.equal(content.rosterAvailable, true);
    Assert.equal(content.rosterUnavailableReason, null);
    Assert.deepEqual(content.players.map(player => player.a2sStatus), ['online', 'online']);
    Assert.deepEqual(content.players.map(player => player.presenceSource), ['rustplus_team', 'rustplus_team']);
});

Test('players outside the Rust+ team remain unknown when Moose censors A2S names', () => {
    const content = tracker([
        { name: 'Sogeking', steamId: '76561198330171679', playerId: null },
        { name: 'Kotix', steamId: '76561198117844313', playerId: null }
    ]);
    const result = TrackerPresenceResolver.apply(content, censoredRoster(), rustplus([]));

    Assert.deepEqual(result.events, []);
    Assert.equal(content.rosterAvailable, false);
    Assert.equal(content.rosterSource, 'a2s_relay');
    Assert.deepEqual(content.players.map(player => player.a2sStatus), [undefined, undefined]);
});

Test('partial Rust+ team coverage does not infer offline for an uncovered SteamID', () => {
    const content = tracker([
        { name: 'aurum', steamId: '76561198982669820', playerId: null },
        { name: 'Sogeking', steamId: '76561198330171679', playerId: null }
    ]);
    TrackerPresenceResolver.apply(content, censoredRoster(), rustplus([
        { steamId: '76561198982669820', isOnline: false }
    ]));

    Assert.equal(content.rosterAvailable, true);
    Assert.equal(content.players[0].a2sStatus, 'offline');
    Assert.equal(content.players[1].a2sStatus, undefined);
    Assert.match(content.rosterUnavailableReason, /covers 1\/2/);
});

Test('a Rust+ disconnect clears team-derived status instead of relabeling stale state as A2S', () => {
    const content = tracker([
        {
            name: 'aurum', steamId: '76561198982669820', playerId: null,
            a2sStatus: 'online', presenceSource: 'rustplus_team'
        }
    ]);
    TrackerPresenceResolver.apply(content, censoredRoster(), null);

    Assert.equal(content.players[0].a2sStatus, undefined);
    Assert.equal(content.players[0].presenceSource, undefined);
    Assert.equal(content.rosterAvailable, false);
});

Test('switching from BattleMetrics to Rust+ Team creates a baseline without a synthetic transition', () => {
    const content = tracker([
        {
            name: 'aurum', steamId: '76561198982669820', playerId: null,
            a2sStatus: 'offline', presenceSource: 'battlemetrics_api'
        }
    ]);
    const result = TrackerPresenceResolver.apply(content, censoredRoster(), rustplus([
        { steamId: '76561198982669820', isOnline: true }
    ]));

    Assert.deepEqual(result.events, []);
    Assert.equal(content.players[0].a2sStatus, 'online');
    Assert.equal(content.players[0].presenceSource, 'rustplus_team');
});
