const Test = require('node:test');
const Assert = require('node:assert/strict');

const A2sRoster = require('../src/util/a2sRoster.js');

Test('parses Rust connect endpoint', () => {
    Assert.deepEqual(A2sRoster.parseConnectEndpoint('connect 195.60.166.150:28015'), {
        host: '195.60.166.150',
        gamePort: 28015
    });
});

Test('selects query endpoint by Rust app id and exact game port', () => {
    const payload = {
        response: {
            servers: [
                { addr: '208.103.169.222:28015', gameport: 28010, appid: 252490 },
                { addr: '208.103.169.222:28013', gameport: 28012, appid: 252490 },
                { addr: '208.103.169.222:9999', gameport: 28012, appid: 123 }
            ]
        }
    };

    Assert.deepEqual(A2sRoster.selectQueryEndpoint(payload, 28012), {
        host: '208.103.169.222',
        port: 28013
    });
});

Test('selects a query endpoint by IP only when exactly one Rust server is present', () => {
    const oneRustServer = { response: { servers: [
        { appid: 252490, gameport: 28015, addr: '195.60.166.150:28018' },
        { appid: 730, gameport: 27015, addr: '195.60.166.150:27016' }
    ] } };
    const twoRustServers = { response: { servers: [
        { appid: 252490, gameport: 28015, addr: '195.60.166.150:28018' },
        { appid: 252490, gameport: 29015, addr: '195.60.166.150:29018' }
    ] } };

    Assert.deepEqual(A2sRoster.selectUniqueRustQueryEndpoint(oneRustServer),
        { host: '195.60.166.150', port: 28018 });
    Assert.equal(A2sRoster.selectUniqueRustQueryEndpoint(twoRustServers), null);
});

Test('parses A2S_PLAYER response including duplicate and empty names', () => {
    const parts = [Buffer.from([0xff, 0xff, 0xff, 0xff, 0x44, 0x03])];
    for (const [index, name, score, duration] of [
        [0, 'Alice', 10, 12.5],
        [1, 'Alice', 4, 3.25],
        [2, '', 0, 0.5]
    ]) {
        const prefix = Buffer.alloc(1);
        prefix.writeUInt8(index);
        const suffix = Buffer.alloc(8);
        suffix.writeInt32LE(score, 0);
        suffix.writeFloatLE(duration, 4);
        parts.push(prefix, Buffer.from(`${name}\0`), suffix);
    }

    const players = A2sRoster.parsePlayerResponse(Buffer.concat(parts));
    Assert.equal(players.length, 3);
    Assert.equal(players[0].name, 'Alice');
    Assert.equal(players[0].score, 10);
    Assert.equal(players[1].name, 'Alice');
    Assert.equal(players[2].name, '');
});

Test('reassembles split A2S_PLAYER payload without requiring a second simple-packet header', () => {
    const payload = Buffer.from([0x44, 0x00]);
    const makeFragment = (number, chunk) => {
        const header = Buffer.alloc(12);
        header.writeInt32LE(-2, 0);
        header.writeInt32LE(12345, 4);
        header.writeUInt8(2, 8);
        header.writeUInt8(number, 9);
        header.writeUInt16LE(1248, 10);
        return Buffer.concat([header, chunk]);
    };
    const assembled = A2sRoster.assembleSplitPackets([
        makeFragment(1, payload.subarray(1)),
        makeFragment(0, payload.subarray(0, 1))
    ]);

    Assert.deepEqual(assembled, payload);
    Assert.deepEqual(A2sRoster.parsePlayerResponse(assembled), []);
});

Test('parses A2S_INFO population', () => {
    const info = Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
        Buffer.from('Server\0map\0rust\0Rust\0'),
        Buffer.from([0x4a, 0xda, 7, 200, 0])
    ]);
    Assert.deepEqual(A2sRoster.parseInfoResponse(info), { players: 7, maxPlayers: 200, bots: 0 });
});

Test('builds source-aware snapshot and preserves duplicate names', async () => {
    const roster = await A2sRoster.getServerRoster({
        connect: 'connect 195.60.166.150:28015'
    }, {
        discoverQueryEndpoint: async () => ({ host: '195.60.166.150', port: 28018 }),
        queryPlayers: async () => [
            { name: 'Alice', score: 1, duration: 1 },
            { name: 'Alice', score: 2, duration: 2 },
            { name: '', score: 0, duration: 3 },
            { name: 'Bob', score: 3, duration: 4 }
        ],
        now: () => 123456,
        noCache: true
    });

    Assert.equal(roster.available, true);
    Assert.equal(roster.source, 'a2s');
    Assert.equal(roster.observedAt, 123456);
    Assert.deepEqual(roster.players, ['Alice', 'Alice', 'Bob']);
    Assert.deepEqual(roster.nameCounts, { Alice: 2, Bob: 1 });
    Assert.equal(roster.queryAddress, '195.60.166.150:28018');
});

Test('discovers a sole Rust query endpoint from pairing IP when connect is unavailable', async () => {
    const server = { serverIp: '195.60.166.150', appPort: '28093', connect: null };
    const roster = await A2sRoster.getServerRoster(server, {
        requestJson: async () => ({ response: { servers: [
            { appid: 252490, gameport: 28015, addr: '195.60.166.150:28018' }
        ] } }),
        queryPlayers: async () => [{ name: 'Alpha', score: 1, duration: 1 }],
        noCache: true
    });

    Assert.equal(roster.available, true);
    Assert.equal(roster.queryAddress, '195.60.166.150:28018');
    Assert.equal(server.queryIp, '195.60.166.150');
    Assert.equal(server.queryPort, 28018);
});

Test('reuses a remembered query endpoint without confusing the Rust+ app port for a game port', async () => {
    const server = {
        serverIp: '195.60.166.150', appPort: '28093', connect: null,
        queryIp: '195.60.166.150', queryPort: 28018
    };
    let directoryRequests = 0;
    const endpoint = await A2sRoster.discoverQueryEndpoint(server, {
        requestJson: async () => {
            directoryRequests += 1;
            return { response: { servers: [] } };
        }
    });

    Assert.deepEqual(endpoint, { host: '195.60.166.150', port: 28018 });
    Assert.equal(directoryRequests, 0);
});

Test('rediscovers a remembered query endpoint after the saved UDP port stops responding', async () => {
    const server = {
        serverIp: '195.60.166.150', appPort: '28093', connect: null,
        queryIp: '195.60.166.150', queryPort: 28018
    };
    const queriedPorts = [];
    const roster = await A2sRoster.getServerRoster(server, {
        requestJson: async () => ({ response: { servers: [
            { appid: 252490, gameport: 28015, addr: '195.60.166.150:28019' }
        ] } }),
        queryPlayers: async (host, port) => {
            queriedPorts.push(port);
            if (port === 28018) throw new Error('timed out');
            return [{ name: 'Alpha', score: 1, duration: 1 }];
        },
        noCache: true
    });

    Assert.equal(roster.available, true);
    Assert.deepEqual(queriedPorts, [28018, 28019]);
    Assert.equal(server.queryIp, '195.60.166.150');
    Assert.equal(server.queryPort, 28019);
});

Test('rejects an empty names roster when A2S_INFO reports connected players', async () => {
    const roster = await A2sRoster.getServerRoster({ connect: 'connect 192.0.2.10:28015' }, {
        discoverQueryEndpoint: async () => ({ host: '192.0.2.10', port: 28018 }),
        queryPlayers: async () => [],
        queryInfo: async () => ({ players: 4, maxPlayers: 200, bots: 0 }),
        noCache: true
    });

    Assert.equal(roster.available, false);
    Assert.equal(roster.complete, false);
    Assert.equal(roster.population, 4);
});

Test('accepts a verified empty server roster', async () => {
    const roster = await A2sRoster.getServerRoster({ connect: 'connect 192.0.2.11:28015' }, {
        discoverQueryEndpoint: async () => ({ host: '192.0.2.11', port: 28018 }),
        queryPlayers: async () => [],
        queryInfo: async () => ({ players: 0, maxPlayers: 200, bots: 0 }),
        noCache: true
    });

    Assert.equal(roster.available, true);
    Assert.equal(roster.complete, true);
    Assert.deepEqual(roster.players, []);
});

Test('builds a configurable hosted A2S URL only for public IPv4 endpoints', () => {
    Assert.equal(
        A2sRoster.buildRelayUrl('178.208.177.72', 28025),
        'https://gamedig-api.hexane.co/rust/ip=178.208.177.72&port=28025'
    );
    Assert.equal(
        A2sRoster.buildRelayUrl('178.208.177.72', 28025, {
            relayUrlTemplate: 'https://relay.example/query?host={host}&port={port}'
        }),
        'https://relay.example/query?host=178.208.177.72&port=28025'
    );
    Assert.throws(() => A2sRoster.buildRelayUrl('127.0.0.1', 28025), /public IPv4/);
    Assert.throws(() => A2sRoster.buildRelayUrl('10.0.0.1', 28025), /public IPv4/);
    Assert.throws(() => A2sRoster.buildRelayUrl('198.51.100.1', 28025), /public IPv4/);
    Assert.doesNotThrow(() => A2sRoster.buildRelayUrl('198.51.99.1', 28025));
    Assert.throws(() => A2sRoster.buildRelayUrl('178.208.177.72', 28025, {
        relayUrlTemplate: 'off'
    }), /disabled/);
});

Test('parses a hosted GameDig roster without inventing Steam identity', () => {
    const parsed = A2sRoster.parseRelayResponse({
        online: true,
        raw: { numplayers: 2 },
        players: [
            { name: 'Alice', raw: { score: 4, time: 12.5 } },
            { name: 'Bob', raw: { score: 1, time: 3 } }
        ]
    });

    Assert.deepEqual(parsed, {
        entries: [
            { index: 0, name: 'Alice', score: 4, duration: 12.5 },
            { index: 1, name: 'Bob', score: 1, duration: 3 }
        ],
        reportedPopulation: 2
    });
    Assert.throws(() => A2sRoster.parseRelayResponse({ online: false, error: 'query timeout' }),
        /query timeout/);
    Assert.throws(() => A2sRoster.parseRelayResponse({ online: true, players: [{ name: 42 }] }),
        /invalid player entry/);
});

Test('uses hosted A2S after a direct fragmented-response timeout', async () => {
    let relayCalls = 0;
    const server = { queryIp: '178.208.177.72', queryPort: 28025 };
    const roster = await A2sRoster.getServerRoster(server, {
        discoverQueryEndpoint: async () => ({ host: '178.208.177.72', port: 28025 }),
        queryPlayers: async () => { throw new Error('A2S_PLAYER timed out'); },
        queryPlayersViaRelay: async (host, port) => {
            relayCalls += 1;
            Assert.equal(host, '178.208.177.72');
            Assert.equal(port, 28025);
            return {
                entries: [{ index: 0, name: 'Alice', score: 0, duration: 1 }],
                reportedPopulation: 1
            };
        },
        now: () => 5000,
        noCache: true
    });

    Assert.equal(relayCalls, 1);
    Assert.equal(roster.source, 'a2s_relay');
    Assert.equal(roster.available, true);
    Assert.equal(roster.reportedPopulation, 1);
    Assert.deepEqual(roster.players, ['Alice']);
});

Test('keeps direct A2S as the preferred source when it succeeds', async () => {
    let relayCalls = 0;
    const roster = await A2sRoster.getServerRoster({}, {
        discoverQueryEndpoint: async () => ({ host: '178.208.177.72', port: 28025 }),
        queryPlayers: async () => [{ name: 'Direct', score: 0, duration: 1 }],
        queryPlayersViaRelay: async () => {
            relayCalls += 1;
            throw new Error('relay should not run');
        },
        noCache: true
    });

    Assert.equal(roster.source, 'a2s');
    Assert.deepEqual(roster.players, ['Direct']);
    Assert.equal(relayCalls, 0);
});

Test('uses the rediscovered endpoint for hosted A2S when direct UDP also fails there', async () => {
    const server = { serverIp: '178.208.177.72', queryIp: '178.208.177.72', queryPort: 28024 };
    const relayEndpoints = [];
    const roster = await A2sRoster.getServerRoster(server, {
        requestJson: async () => ({ response: { servers: [
            { appid: 252490, gameport: 28024, addr: '178.208.177.72:28025' }
        ] } }),
        queryPlayers: async () => { throw new Error('fragmented response timed out'); },
        queryPlayersViaRelay: async (host, port) => {
            relayEndpoints.push(`${host}:${port}`);
            return {
                entries: [{ index: 0, name: 'Relayed', score: 0, duration: 1 }],
                reportedPopulation: 1
            };
        },
        noCache: true
    });

    Assert.equal(roster.source, 'a2s_relay');
    Assert.deepEqual(relayEndpoints, ['178.208.177.72:28025']);
    Assert.equal(server.queryPort, 28025);
});

Test('does not turn a direct and hosted A2S failure into an empty roster', async () => {
    const roster = await A2sRoster.getServerRoster({}, {
        discoverQueryEndpoint: async () => ({ host: '178.208.177.72', port: 28025 }),
        queryPlayers: async () => { throw new Error('direct timeout'); },
        queryPlayersViaRelay: async () => { throw new Error('relay timeout'); },
        now: () => 9000,
        noCache: true
    });

    Assert.equal(roster.available, false);
    Assert.equal(roster.complete, false);
    Assert.deepEqual(roster.players, []);
    Assert.match(roster.reason, /direct timeout/);
    Assert.match(roster.reason, /relay timeout/);
});
