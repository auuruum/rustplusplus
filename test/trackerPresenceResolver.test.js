const Test = require('node:test');
const Assert = require('node:assert/strict');

const TrackerPresenceResolver = require('../src/util/trackerPresenceResolver.js');

const SERVER_ID = '137.83.91.168-28082';
const SERVER = {
    connect: 'connect main.eu.moose.gg:28010',
    gameIp: '205.178.168.211',
    gamePort: 28010
};

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

Test('production regression: arbitrary Moose players are online by Steam profile join endpoint', () => {
    const content = tracker([
        { name: 'Sogeking', steamId: '76561198330171679', playerId: null },
        { name: 'Kotix', steamId: '76561198117844313', playerId: null }
    ]);
    const result = TrackerPresenceResolver.apply(content, censoredRoster(), {
        '76561198330171679': {
            available: true, connect: 'connect 205.178.168.211:28010'
        },
        '76561198117844313': {
            available: true, connect: 'connect 205.178.168.211:28010'
        }
    }, SERVER);

    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.covered, ['76561198330171679', '76561198117844313']);
    Assert.equal(content.rosterSource, 'steam_profile');
    Assert.equal(content.rosterAvailable, true);
    Assert.equal(content.rosterUnavailableReason, null);
    Assert.deepEqual(content.players.map(player => player.a2sStatus), ['online', 'online']);
    Assert.deepEqual(content.players.map(player => player.presenceSource), ['steam_profile', 'steam_profile']);
});

Test('a profile without a join endpoint remains unknown on a censored server', () => {
    const content = tracker([
        { name: 'Rolls Royce', steamId: '76561198880886557', playerId: null }
    ]);
    const result = TrackerPresenceResolver.apply(content, censoredRoster(), {
        '76561198880886557': { available: true, game: 'Rust', connect: null }
    }, SERVER);

    Assert.deepEqual(result.events, []);
    Assert.equal(content.rosterAvailable, false);
    Assert.equal(content.rosterSource, 'a2s_relay');
    Assert.equal(content.players[0].a2sStatus, undefined);
});

Test('a different published endpoint is a confirmed offline status for this tracker', () => {
    const content = tracker([
        { name: 'Sogeking', steamId: '76561198330171679', playerId: null }
    ]);
    TrackerPresenceResolver.apply(content, censoredRoster(), {
        '76561198330171679': {
            available: true, connect: 'connect 185.248.134.37:28010'
        }
    }, SERVER);

    Assert.equal(content.rosterAvailable, true);
    Assert.equal(content.players[0].a2sStatus, 'offline');
    Assert.equal(content.players[0].presenceSource, 'steam_profile');
});

Test('legacy Rust+ team status is removed when no server-level Steam evidence exists', () => {
    const content = tracker([
        {
            name: 'aurum', steamId: '76561198982669820', playerId: null,
            a2sStatus: 'online', presenceSource: 'rustplus_team'
        }
    ]);
    TrackerPresenceResolver.apply(content, censoredRoster(), {
        '76561198982669820': { available: true, connect: null }
    }, SERVER);

    Assert.equal(content.players[0].a2sStatus, undefined);
    Assert.equal(content.players[0].presenceSource, undefined);
    Assert.equal(content.rosterAvailable, false);
});

Test('switching from BattleMetrics to Steam Profiles creates a baseline without a synthetic transition', () => {
    const content = tracker([
        {
            name: 'Sogeking', steamId: '76561198330171679', playerId: null,
            a2sStatus: 'offline', presenceSource: 'battlemetrics_api'
        }
    ]);
    const result = TrackerPresenceResolver.apply(content, censoredRoster(), {
        '76561198330171679': {
            available: true, connect: 'connect 205.178.168.211:28010'
        }
    }, SERVER);

    Assert.deepEqual(result.events, []);
    Assert.equal(content.players[0].a2sStatus, 'online');
    Assert.equal(content.players[0].presenceSource, 'steam_profile');
});
