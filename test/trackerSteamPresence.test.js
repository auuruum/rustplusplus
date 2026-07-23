const Test = require('node:test');
const Assert = require('node:assert/strict');

const TrackerSteamPresence = require('../src/util/trackerSteamPresence.js');

const SERVER = {
    connect: 'connect main.eu.moose.gg:28010',
    gameIp: '205.178.168.211',
    gamePort: 28010
};
const TRACKED = [
    { key: '76561198330171679', steamId: '76561198330171679', name: 'Sogeking' },
    { key: '76561198117844313', steamId: '76561198117844313', name: 'Kotix' }
];

Test('matches arbitrary tracked Steam IDs to the target server by published join endpoint', () => {
    const result = TrackerSteamPresence.evaluate({}, TRACKED, {
        '76561198330171679': {
            available: true,
            connect: 'connect 205.178.168.211:28010'
        },
        '76561198117844313': {
            available: true,
            connect: 'connect 205.178.168.211:28010'
        }
    }, SERVER);

    Assert.equal(result.available, true);
    Assert.deepEqual(result.covered, ['76561198330171679', '76561198117844313']);
    Assert.equal(result.state['76561198330171679'].online, true);
    Assert.equal(result.state['76561198117844313'].online, true);
    Assert.deepEqual(result.events, []);
});

Test('a different published join endpoint confirms the player is not on the target server', () => {
    const result = TrackerSteamPresence.evaluate({}, [TRACKED[0]], {
        '76561198330171679': {
            available: true,
            connect: 'connect 185.248.134.37:28010'
        }
    }, SERVER);

    Assert.equal(result.state['76561198330171679'].online, false);
});

Test('a hidden or absent Steam join endpoint remains unknown instead of becoming offline', () => {
    const result = TrackerSteamPresence.evaluate({}, TRACKED, {
        '76561198330171679': { available: true, game: 'Rust', connect: null },
        '76561198117844313': { available: false, connect: null }
    }, SERVER);

    Assert.equal(result.available, false);
    Assert.deepEqual(result.covered, []);
    Assert.deepEqual(result.events, []);
});

Test('emits transitions only between consecutive Steam profile endpoint observations', () => {
    const previous = {
        '76561198330171679': {
            initialized: true,
            online: true,
            source: TrackerSteamPresence.SOURCE
        }
    };
    const result = TrackerSteamPresence.evaluate(previous, [TRACKED[0]], {
        '76561198330171679': {
            available: true,
            connect: 'connect 185.248.134.37:28010'
        }
    }, SERVER);

    Assert.deepEqual(result.events, [{
        key: '76561198330171679',
        type: 'logout',
        name: 'Sogeking',
        source: 'steam_profile'
    }]);
});

Test('does not claim a match when the target game port is unknown', () => {
    const result = TrackerSteamPresence.evaluate({}, [TRACKED[0]], {
        '76561198330171679': {
            available: true,
            connect: 'connect 205.178.168.211:28010'
        }
    }, { serverIp: '137.83.91.168', appPort: 28082 });

    Assert.equal(result.available, false);
    Assert.deepEqual(result.covered, []);
});
