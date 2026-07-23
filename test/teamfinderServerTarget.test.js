const Test = require('node:test');
const Assert = require('node:assert/strict');

const TeamfinderServerTarget = require('../src/util/teamfinderServerTarget.js');

const SERVER_ID = '137.83.91.168-28082';
const SERVER = {
    title: 'Rusty Moose |EU Main|',
    battlemetricsId: null,
    connect: 'connect main.eu.moose.gg:28010'
};

Test('uses the active Rust server without requiring a BattleMetrics ID', () => {
    const instance = {
        activeServer: SERVER_ID,
        serverList: { [SERVER_ID]: SERVER }
    };
    const rustplus = { isOperational: true, serverId: SERVER_ID };

    const target = TeamfinderServerTarget.resolve(instance, rustplus, null);

    Assert.deepEqual(target, {
        available: true,
        battlemetricsId: `rustplus:${SERVER_ID}`,
        serverId: SERVER_ID,
        server: SERVER
    });
});

Test('keeps a configured BattleMetrics ID for the active server', () => {
    const server = Object.assign({}, SERVER, { battlemetricsId: '4729828' });
    const instance = {
        activeServer: SERVER_ID,
        serverList: { [SERVER_ID]: server }
    };
    const rustplus = { isOperational: true, serverId: SERVER_ID };

    const target = TeamfinderServerTarget.resolve(instance, rustplus, null);

    Assert.equal(target.battlemetricsId, '4729828');
    Assert.equal(target.server, server);
});

Test('associates an explicitly provided BattleMetrics ID with a known server when possible', () => {
    const server = Object.assign({}, SERVER, { battlemetricsId: '4729828' });
    const instance = {
        activeServer: SERVER_ID,
        serverList: { [SERVER_ID]: server }
    };

    const target = TeamfinderServerTarget.resolve(instance, null, '4729828');

    Assert.equal(target.available, true);
    Assert.equal(target.battlemetricsId, '4729828');
    Assert.equal(target.serverId, SERVER_ID);
    Assert.equal(target.server, server);
});

Test('reports a disconnected Rust+ instance only when no explicit server ID was provided', () => {
    const result = TeamfinderServerTarget.resolve({ serverList: {} }, null, null);

    Assert.deepEqual(result, { available: false, reason: 'not_connected' });
});
