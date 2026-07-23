const Test = require('node:test');
const Assert = require('node:assert/strict');

const TrackerTeamPresence = require('../src/util/trackerTeamPresence.js');

const SERVER_ID = '137.83.91.168-28082';
const tracked = [
    { key: '76561198982669820', steamId: '76561198982669820', name: 'aurum' },
    { key: '76561198880886557', steamId: '76561198880886557', name: 'Rolls Royce' },
    { key: '76561198330171679', steamId: '76561198330171679', name: 'Sogeking' }
];

function rustplus(players, overrides = {}) {
    return Object.assign({
        isOperational: true,
        serverId: SERVER_ID,
        team: { players }
    }, overrides);
}

Test('uses Rust+ team Steam IDs as an authoritative baseline without synthetic login events', () => {
    const result = TrackerTeamPresence.evaluate({}, tracked, rustplus([
        { steamId: '76561198982669820', isOnline: true },
        { steamId: '76561198880886557', isOnline: true }
    ]), SERVER_ID);

    Assert.deepEqual(result.covered, ['76561198982669820', '76561198880886557']);
    Assert.deepEqual(result.events, []);
    Assert.equal(result.state['76561198982669820'].online, true);
    Assert.equal(result.state['76561198880886557'].online, true);
    Assert.equal(result.state['76561198330171679'], undefined);
});

Test('emits transitions only between consecutive Rust+ team observations', () => {
    const previous = {
        '76561198982669820': { initialized: true, online: false, source: 'rustplus_team' },
        '76561198880886557': { initialized: true, online: true, source: 'a2s' }
    };
    const result = TrackerTeamPresence.evaluate(previous, tracked, rustplus([
        { steamId: '76561198982669820', isOnline: true },
        { steamId: '76561198880886557', isOnline: false }
    ]), SERVER_ID);

    Assert.deepEqual(result.events, [{
        key: '76561198982669820', type: 'login', name: 'aurum', source: 'rustplus_team'
    }]);
    Assert.equal(result.state['76561198880886557'].online, false);
});

Test('does not infer offline for tracked Steam IDs outside the Rust+ team', () => {
    const previous = {
        '76561198330171679': { initialized: true, online: true, source: 'rustplus_team' }
    };
    const result = TrackerTeamPresence.evaluate(previous, tracked, rustplus([]), SERVER_ID);

    Assert.deepEqual(result.covered, []);
    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.state, {});
});

Test('does not use stale or wrong-server Rust+ team state', () => {
    const wrongServer = TrackerTeamPresence.evaluate({}, tracked,
        rustplus([], { serverId: 'other' }), SERVER_ID);
    const disconnected = TrackerTeamPresence.evaluate({}, tracked,
        rustplus([], { isOperational: false }), SERVER_ID);

    Assert.equal(wrongServer.available, false);
    Assert.equal(disconnected.available, false);
});
