const Test = require('node:test');
const Assert = require('node:assert/strict');

const RosterProvider = require('../src/util/rosterProvider.js');

function fakeStore(cached = null) {
    return {
        recorded: [],
        cacheReads: [],
        recordSnapshot(guildId, serverId, roster) {
            this.recorded.push({ guildId, serverId, roster });
            return { recorded: true, baseline: true, events: [] };
        },
        getFreshSnapshot(guildId, serverId, maxAgeMs, now) {
            this.cacheReads.push({ guildId, serverId, maxAgeMs, now });
            return cached;
        }
    };
}

Test('prefers a fresh authorized BattleMetrics API snapshot', async () => {
    const store = fakeStore();
    let a2sCalls = 0;
    const now = 1_000_000;
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1',
        serverId: 'server-1',
        server: { connect: 'connect 192.0.2.1:28015' },
        battlemetrics: {
            lastUpdateSuccessful: true,
            updatedAt: new Date(now - 1000).toISOString(),
            onlinePlayers: ['10', '20'],
            players: { '10': { name: 'Alice' }, '20': { name: 'Bob' } }
        },
        now
    }, {
        store,
        fetchA2s: async () => {
            a2sCalls += 1;
            throw new Error('A2S should not run');
        }
    });

    Assert.equal(roster.source, 'battlemetrics_api');
    Assert.deepEqual(roster.players, ['Alice', 'Bob']);
    Assert.deepEqual(roster.nameCounts, { Alice: 1, Bob: 1 });
    Assert.equal(a2sCalls, 0);
    Assert.equal(store.recorded.length, 1);
});

Test('uses and records A2S when BattleMetrics is unavailable', async () => {
    const store = fakeStore();
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1', serverId: 'server-1', server: {}, battlemetrics: null, now: 2000
    }, {
        store,
        fetchA2s: async () => ({
            source: 'a2s', available: true, complete: true, observedAt: 1900,
            players: ['Alice', 'Alice', ' Bob '], nameCounts: { Alice: 2, ' Bob ': 1 }
        })
    });

    Assert.equal(roster.source, 'a2s');
    Assert.deepEqual(roster.players, ['Alice', 'Alice', 'Bob']);
    Assert.deepEqual(roster.nameCounts, { Alice: 2, Bob: 1 });
    Assert.equal(store.recorded.length, 1);
});

Test('does not treat a capped BattleMetrics player list as a complete roster', async () => {
    const store = fakeStore();
    let a2sCalls = 0;
    const players = {};
    const onlinePlayers = [];
    for (let index = 0; index < 87; index += 1) {
        players[`${index}`] = { name: `Player ${index}` };
        onlinePlayers.push(`${index}`);
    }

    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1',
        serverId: 'server-1',
        server: {},
        battlemetrics: {
            lastUpdateSuccessful: true,
            updatedAt: new Date(1000).toISOString(),
            server_players: 1145,
            onlinePlayers,
            players
        },
        now: 1000
    }, {
        store,
        fetchA2s: async () => {
            a2sCalls += 1;
            return {
                source: 'a2s', available: false, complete: false, observedAt: 1000,
                players: [], reason: 'A2S player names are censored'
            };
        }
    });

    Assert.equal(a2sCalls, 1);
    Assert.equal(roster.source, 'battlemetrics_api');
    Assert.equal(roster.available, true);
    Assert.equal(roster.complete, false);
    Assert.equal(roster.players.length, 87);
    Assert.equal(roster.population, 1145);
    Assert.match(roster.reason, /87 of 1145/);
    Assert.equal(store.recorded.length, 0);
});

Test('falls back to a fresh local snapshot after a transient source failure', async () => {
    const cached = {
        source: 'local_cache', upstreamSource: 'a2s', available: true, complete: true,
        cached: true, observedAt: 1500, players: ['Alice'], nameCounts: { Alice: 1 }
    };
    const store = fakeStore(cached);
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1', serverId: 'server-1', server: {}, battlemetrics: null, now: 2000,
        maxCacheAgeMs: 5000
    }, {
        store,
        fetchA2s: async () => ({
            source: 'a2s', available: false, complete: false, observedAt: 2000,
            players: [], nameCounts: {}, reason: 'timeout'
        })
    });

    Assert.equal(roster, cached);
    Assert.deepEqual(store.cacheReads, [{
        guildId: 'guild-1', serverId: 'server-1', maxAgeMs: 5000, now: 2000
    }]);
});

Test('returns the live failure when no compliant roster source or cache is available', async () => {
    const store = fakeStore(null);
    const failed = {
        source: 'a2s', available: false, complete: false, observedAt: 2000,
        players: [], nameCounts: {}, reason: 'roster censored'
    };
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1', serverId: 'server-1', server: {}, battlemetrics: null, now: 2000
    }, {
        store,
        fetchA2s: async () => failed
    });

    Assert.equal(roster, failed);
    Assert.equal(store.recorded.length, 0);
});

Test('uses local cache when the A2S implementation throws', async () => {
    const cached = {
        source: 'local_cache', upstreamSource: 'a2s', available: true, complete: true,
        observedAt: 9000, players: ['Cached'], nameCounts: { Cached: 1 }
    };
    const store = fakeStore(cached);
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1', serverId: 'server-1', server: {}, battlemetrics: null, now: 10000
    }, {
        store,
        fetchA2s: async () => { throw new Error('socket failure'); }
    });

    Assert.equal(roster, cached);
});

Test('returns a live BattleMetrics roster when local persistence write fails', async () => {
    const errors = [];
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1',
        serverId: 'server-1',
        now: 1000,
        battlemetrics: {
            lastUpdateSuccessful: true,
            updatedAt: new Date(1000).toISOString(),
            onlinePlayers: ['1'],
            players: { '1': { name: 'Live' } }
        }
    }, {
        store: {
            recordSnapshot() { throw new Error('disk full'); }
        },
        onStoreError(error, operation) { errors.push([operation, error.message]); }
    });

    Assert.equal(roster.source, 'battlemetrics_api');
    Assert.deepEqual(roster.players, ['Live']);
    Assert.equal(roster.persistenceAvailable, false);
    Assert.deepEqual(errors, [['write', 'disk full']]);
});

Test('returns the live source failure when local cache read fails', async () => {
    const roster = await RosterProvider.getRosterSnapshot({
        guildId: 'guild-1', serverId: 'server-1', now: 1000
    }, {
        store: {
            getFreshSnapshot() { throw new Error('database locked'); }
        },
        fetchA2s: async () => ({
            source: 'a2s',
            capability: 'unavailable',
            available: false,
            complete: false,
            observedAt: 1000,
            players: [],
            reason: 'A2S timeout'
        })
    });

    Assert.equal(roster.source, 'a2s');
    Assert.equal(roster.available, false);
    Assert.equal(roster.persistenceAvailable, false);
});
