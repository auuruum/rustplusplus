const Test = require('node:test');
const Assert = require('node:assert/strict');

const TeamfinderRosterSemantics = require('../src/util/teamfinderRosterSemantics.js');

Test('passes a complete live A2S roster to Team Finder', () => {
    const roster = {
        source: 'a2s', available: true, complete: true, cached: false,
        players: ['Alice'], nameCounts: { Alice: 1 }
    };

    Assert.equal(TeamfinderRosterSemantics.prepareRosterForDiscovery(roster), roster);
    Assert.equal(TeamfinderRosterSemantics.isLiveRoster(roster), true);
});

Test('turns a local cache into display-only unavailable evidence for Team Finder', () => {
    const roster = {
        source: 'local_cache', upstreamSource: 'a2s', available: true, complete: true, cached: true,
        players: ['Alice'], nameCounts: { Alice: 1 }
    };
    const prepared = TeamfinderRosterSemantics.prepareRosterForDiscovery(roster);

    Assert.equal(prepared.source, 'local_cache');
    Assert.equal(prepared.available, false);
    Assert.equal(prepared.complete, false);
    Assert.deepEqual(prepared.players, []);
    Assert.deepEqual(prepared.nameCounts, {});
    Assert.equal(TeamfinderRosterSemantics.isLiveRoster(prepared), false);
});

Test('does not turn an unavailable live source into a roster', () => {
    const roster = {
        source: 'a2s', available: false, complete: false, players: [], reason: 'timeout'
    };

    Assert.equal(TeamfinderRosterSemantics.prepareRosterForDiscovery(roster), roster);
    Assert.equal(TeamfinderRosterSemantics.isLiveRoster(roster), false);
});
