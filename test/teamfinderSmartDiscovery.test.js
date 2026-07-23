const Test = require('node:test');
const Assert = require('node:assert/strict');

const Policy = require('../src/util/teamfinderDiscoveryPolicy.js');
const Report = require('../src/util/teamfinderReport.js');

function interactionWith(values = {}) {
    return {
        options: {
            getBoolean: name => values[name] ?? null,
            getInteger: name => values[name] ?? null,
            getNumber: name => values[name] ?? null
        }
    };
}

Test('smart discovery checks comments and direct friends by default without an unsafe request burst', () => {
    Assert.deepEqual(Policy.fromInteraction(interactionWith()), {
        comments: true,
        commentPages: 2,
        maxProfiles: 75,
        minScore: 2,
        recursiveDepth: 5,
        requestDelay: 0.2,
        maxRuntimeSeconds: 150
    });
});

Test('explicit slash command crawl overrides remain supported', () => {
    const options = Policy.fromInteraction(interactionWith({
        comments: false, commentpages: 5, maxprofiles: 20, minscore: 7, depth: 3, delay: 1
    }));

    Assert.deepEqual(options, {
        comments: false,
        commentPages: 5,
        maxProfiles: 20,
        minScore: 7,
        recursiveDepth: 3,
        requestDelay: 1,
        maxRuntimeSeconds: 150
    });
});

Test('full report retains acceptance candidates outside the Discord top ten', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
        score: 2,
        online: false,
        steam_id: `${76561199000000000n + BigInt(index)}`,
        name: `Candidate ${index}`,
        sources: ['friends'],
        connection_profile_names: ['aurum']
    }));
    candidates.push({
        score: 2, online: false, steam_id: '76561199021904253', name: 'Hrusha',
        sources: ['friends'], connection_profile_names: ['aurum']
    });
    candidates.push({
        score: 2, online: false, steam_id: '76561199216048160', name: 'Puffch1k',
        sources: ['friends'], connection_profile_names: ['aurum']
    });

    const report = Report.buildText({ candidates, crawl: {}, fetch_stats: {} });

    Assert.match(report, /76561199021904253 \| Hrusha/);
    Assert.match(report, /76561199216048160 \| Puffch1k/);
});
