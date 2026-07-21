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
