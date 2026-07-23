const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('fs');
const Os = require('os');
const Path = require('path');

const { LocalRosterStore } = require('../src/util/localRosterStore.js');

function createStore(options = {}) {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rustplusplus-roster-'));
    const store = new LocalRosterStore(Object.assign({
        databasePath: Path.join(directory, 'roster.db')
    }, options));
    return {
        store,
        cleanup() {
            store.close();
            Fs.rmSync(directory, { recursive: true, force: true });
        }
    };
}

Test('stores a baseline roster without synthetic join events', t => {
    const fixture = createStore();
    t.after(fixture.cleanup);

    const result = fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s',
        available: true,
        complete: true,
        observedAt: 1000,
        queryAddress: '192.0.2.1:28016',
        players: ['Alice', 'Alice', 'Bob']
    });

    Assert.equal(result.recorded, true);
    Assert.equal(result.baseline, true);
    Assert.deepEqual(result.events, []);
    Assert.deepEqual(fixture.store.getRecentEvents('guild-1', 'server-1'), []);

    const cached = fixture.store.getFreshSnapshot('guild-1', 'server-1', 5000, 2000);
    Assert.equal(cached.source, 'local_cache');
    Assert.equal(cached.upstreamSource, 'a2s');
    Assert.equal(cached.cached, true);
    Assert.deepEqual(cached.players, ['Alice', 'Alice', 'Bob']);
    Assert.deepEqual(cached.nameCounts, { Alice: 2, Bob: 1 });
});

Test('records join and leave count deltas without inventing stable identities', t => {
    const fixture = createStore();
    t.after(fixture.cleanup);

    fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: 1000,
        players: ['Alice', 'Alice', 'Bob']
    });
    const result = fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: 2000,
        players: ['Alice', 'Carol']
    });

    Assert.deepEqual(result.events, [
        { name: 'Alice', type: 'leave', count: 1 },
        { name: 'Bob', type: 'leave', count: 1 },
        { name: 'Carol', type: 'join', count: 1 }
    ]);

    const events = fixture.store.getRecentEvents('guild-1', 'server-1');
    Assert.deepEqual(events.map(event => ({
        name: event.name,
        type: event.event_type,
        count: event.count,
        source: event.source
    })), [
        { name: 'Alice', type: 'leave', count: 1, source: 'a2s' },
        { name: 'Bob', type: 'leave', count: 1, source: 'a2s' },
        { name: 'Carol', type: 'join', count: 1, source: 'a2s' }
    ]);
    Assert.deepEqual(fixture.store.getRecentEvents('guild-1', 'server-1', 2).map(event => event.name),
        ['Bob', 'Carol']);
});

Test('treats a provider switch as a new baseline', t => {
    const fixture = createStore();
    t.after(fixture.cleanup);

    fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: 1000, players: ['Alice']
    });
    const switched = fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'battlemetrics_api', available: true, complete: true, observedAt: 2000, players: ['Bob']
    });
    const next = fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'battlemetrics_api', available: true, complete: true, observedAt: 3000,
        players: ['Bob', 'Carol']
    });

    Assert.equal(switched.baseline, true);
    Assert.deepEqual(switched.events, []);
    Assert.deepEqual(next.events, [{ name: 'Carol', type: 'join', count: 1 }]);
});

Test('ignores unavailable and out-of-order snapshots', t => {
    const fixture = createStore();
    t.after(fixture.cleanup);

    fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: 2000, players: ['Alice']
    });

    Assert.equal(fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: false, complete: false, observedAt: 3000, players: []
    }).recorded, false);
    Assert.equal(fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: 1000, players: []
    }).recorded, false);

    Assert.deepEqual(fixture.store.getFreshSnapshot('guild-1', 'server-1', 5000, 3000).players, ['Alice']);
});

Test('does not return stale snapshots and isolates guild/server keys', t => {
    const fixture = createStore();
    t.after(fixture.cleanup);

    fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: 1000, players: ['Alice']
    });

    Assert.equal(fixture.store.getFreshSnapshot('guild-1', 'server-1', 500, 2000), null);
    Assert.equal(fixture.store.getFreshSnapshot('guild-2', 'server-1', 5000, 2000), null);
    Assert.equal(fixture.store.getFreshSnapshot('guild-1', 'server-2', 5000, 2000), null);
});

Test('prunes names-only presence events after the configured retention window', t => {
    const fixture = createStore({ eventRetentionMs: 1000 });
    t.after(fixture.cleanup);

    const baseTime = 4_000_000;
    fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: baseTime, players: ['Alice']
    });
    fixture.store.recordSnapshot('guild-1', 'server-1', {
        source: 'a2s', available: true, complete: true, observedAt: baseTime + 100, players: ['Alice', 'Bob']
    });

    Assert.equal(fixture.store.getRecentEvents('guild-1', 'server-1').length, 1);
    Assert.equal(fixture.store.pruneEvents(baseTime + 60 * 60 * 1000 + 2000), 1);
    Assert.deepEqual(fixture.store.getRecentEvents('guild-1', 'server-1'), []);
});
