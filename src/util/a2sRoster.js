/*
    Public Rust server roster discovery through Steam server metadata and A2S_PLAYER.
    A2S exposes display names, scores, and session duration. It does not expose Steam IDs.
*/

const Axios = require('axios');
const Dgram = require('dgram');

const RUST_APP_ID = 252490;
const DEFAULT_HTTP_TIMEOUT_MS = 5000;
const DEFAULT_UDP_TIMEOUT_MS = 3000;
const QUERY_ENDPOINT_CACHE_MS = 6 * 60 * 60 * 1000;
const ROSTER_CACHE_MS = 45 * 1000;

const queryEndpointCache = new Map();
const rosterCache = new Map();

function parseConnectEndpoint(connect) {
    if (typeof connect !== 'string') return null;
    const match = connect.trim().match(/^(?:connect\s+)?(.+):(\d{1,5})$/i);
    if (!match) return null;

    const gamePort = Number(match[2]);
    if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) return null;
    return { host: match[1], gamePort: gamePort };
}

function parseAddress(address) {
    if (typeof address !== 'string') return null;
    const match = address.match(/^(.+):(\d{1,5})$/);
    if (!match) return null;
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: match[1], port: port };
}

function selectQueryEndpoint(payload, gamePort) {
    const servers = payload && payload.response && Array.isArray(payload.response.servers) ?
        payload.response.servers : [];
    const match = servers.find(server => Number(server.appid) === RUST_APP_ID &&
        Number(server.gameport) === Number(gamePort));
    return match ? parseAddress(match.addr) : null;
}

async function discoverQueryEndpoint(server, options = {}) {
    const connect = parseConnectEndpoint(server && server.connect);
    if (!connect) throw new Error('Server connect endpoint is missing or invalid.');

    const explicitPort = Number(server.queryPort || server.portQuery || server.a2sQueryPort);
    const explicitHost = server.queryIp || server.queryHost || server.a2sQueryIp;
    if (explicitHost && Number.isInteger(explicitPort) && explicitPort > 0 && explicitPort <= 65535) {
        return { host: `${explicitHost}`, port: explicitPort };
    }

    const cacheKey = `${connect.host}:${connect.gamePort}`;
    const now = options.now ? options.now() : Date.now();
    const cached = queryEndpointCache.get(cacheKey);
    if (cached && now - cached.observedAt < QUERY_ENDPOINT_CACHE_MS) return cached.endpoint;

    const requestJson = options.requestJson || (async url => {
        const response = await Axios.get(url, { timeout: DEFAULT_HTTP_TIMEOUT_MS });
        return response.data;
    });
    const url = 'https://api.steampowered.com/ISteamApps/GetServersAtAddress/v0001/?' +
        `addr=${encodeURIComponent(connect.host)}&format=json`;
    const payload = await requestJson(url);
    const endpoint = selectQueryEndpoint(payload, connect.gamePort);
    if (!endpoint) throw new Error(`Steam did not return a Rust query endpoint for ${cacheKey}.`);

    queryEndpointCache.set(cacheKey, { endpoint: endpoint, observedAt: now });
    return endpoint;
}

function normalizeResponsePayload(packet) {
    if (!Buffer.isBuffer(packet) || packet.length === 0) throw new Error('Empty A2S response.');
    if (packet.length >= 4 && packet.readInt32LE(0) === -1) return packet.subarray(4);
    return packet;
}

function parseSplitFragment(packet) {
    if (!Buffer.isBuffer(packet) || packet.length < 12 || packet.readInt32LE(0) !== -2) {
        throw new Error('Invalid split A2S packet.');
    }
    const requestId = packet.readInt32LE(4);
    if ((requestId & 0x80000000) !== 0) throw new Error('Compressed split A2S packets are not supported.');
    const total = packet.readUInt8(8);
    const number = packet.readUInt8(9);
    if (total < 1 || number >= total) throw new Error('Invalid split A2S fragment index.');
    return { requestId: requestId, total: total, number: number, payload: packet.subarray(12) };
}

function assembleSplitPackets(packets) {
    const fragments = packets.map(parseSplitFragment);
    if (fragments.length === 0) throw new Error('No split A2S fragments.');
    const first = fragments[0];
    if (fragments.some(fragment => fragment.requestId !== first.requestId || fragment.total !== first.total)) {
        throw new Error('Mismatched split A2S fragments.');
    }
    const chunks = new Array(first.total);
    for (const fragment of fragments) chunks[fragment.number] = fragment.payload;
    if (chunks.some(chunk => !chunk)) return null;
    return normalizeResponsePayload(Buffer.concat(chunks));
}

function parsePlayerResponse(packet) {
    const payload = normalizeResponsePayload(packet);
    if (payload.length < 2 || payload[0] !== 0x44) throw new Error('Invalid A2S_PLAYER response.');

    const count = payload.readUInt8(1);
    const players = [];
    let offset = 2;
    for (let i = 0; i < count; i++) {
        if (offset + 1 > payload.length) throw new Error('Truncated A2S_PLAYER response.');
        const index = payload.readUInt8(offset++);
        const end = payload.indexOf(0, offset);
        if (end === -1 || end + 9 > payload.length) throw new Error('Truncated A2S_PLAYER entry.');
        const name = payload.toString('utf8', offset, end);
        offset = end + 1;
        const score = payload.readInt32LE(offset);
        const duration = payload.readFloatLE(offset + 4);
        offset += 8;
        players.push({ index: index, name: name, score: score, duration: duration });
    }
    return players;
}

function parseInfoResponse(packet) {
    const payload = normalizeResponsePayload(packet);
    if (payload.length < 2 || payload[0] !== 0x49) throw new Error('Invalid A2S_INFO response.');
    let offset = 2;
    for (let i = 0; i < 4; i++) {
        const end = payload.indexOf(0, offset);
        if (end === -1) throw new Error('Truncated A2S_INFO response.');
        offset = end + 1;
    }
    if (offset + 5 > payload.length) throw new Error('Truncated A2S_INFO player counts.');
    offset += 2;
    return {
        players: payload.readUInt8(offset),
        maxPlayers: payload.readUInt8(offset + 1),
        bots: payload.readUInt8(offset + 2)
    };
}

function queryPlayers(host, port, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_UDP_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        const socket = Dgram.createSocket('udp4');
        const challengeRequest = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55, 0xff, 0xff, 0xff, 0xff]);
        let settled = false;
        let splitPackets = [];
        let splitRequestId = null;
        let timer = null;

        const finish = (error, players) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.close();
            if (error) reject(error);
            else resolve(players);
        };

        socket.on('error', error => finish(error));
        socket.on('message', packet => {
            try {
                let payload;
                if (packet.length >= 4 && packet.readInt32LE(0) === -2) {
                    const fragment = parseSplitFragment(packet);
                    if (splitRequestId !== fragment.requestId) {
                        splitRequestId = fragment.requestId;
                        splitPackets = [];
                    }
                    splitPackets.push(packet);
                    payload = assembleSplitPackets(splitPackets);
                    if (!payload) return;
                }
                else {
                    payload = normalizeResponsePayload(packet);
                }

                if (payload.length >= 5 && payload[0] === 0x41) {
                    const request = Buffer.concat([
                        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]),
                        payload.subarray(1, 5)
                    ]);
                    splitPackets = [];
                    splitRequestId = null;
                    socket.send(request, port, host);
                    return;
                }
                if (payload[0] === 0x44) finish(null, parsePlayerResponse(payload));
            }
            catch (error) {
                finish(error);
            }
        });

        timer = setTimeout(() => finish(new Error(`A2S_PLAYER timed out for ${host}:${port}.`)), timeoutMs);
        socket.send(challengeRequest, port, host);
    });
}

function queryInfo(host, port, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_UDP_TIMEOUT_MS;
    const request = Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
        Buffer.from('Source Engine Query\0', 'ascii')
    ]);
    return new Promise((resolve, reject) => {
        const socket = Dgram.createSocket('udp4');
        let settled = false;
        const timer = setTimeout(() => finish(new Error(`A2S_INFO timed out for ${host}:${port}.`)), timeoutMs);
        function finish(error, info) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.close();
            if (error) reject(error);
            else resolve(info);
        }
        socket.on('error', error => finish(error));
        socket.on('message', packet => {
            try {
                const payload = normalizeResponsePayload(packet);
                if (payload.length >= 5 && payload[0] === 0x41) {
                    socket.send(Buffer.concat([request, payload.subarray(1, 5)]), port, host);
                    return;
                }
                finish(null, parseInfoResponse(payload));
            }
            catch (error) {
                finish(error);
            }
        });
        socket.send(request, port, host);
    });
}

function buildNameCounts(players) {
    const counts = {};
    for (const player of players) counts[player] = (counts[player] || 0) + 1;
    return counts;
}

async function getServerRoster(server, options = {}) {
    const connect = parseConnectEndpoint(server && server.connect);
    const now = options.now ? options.now() : Date.now();
    if (!connect) {
        return {
            source: 'a2s', capability: 'unavailable', available: false, complete: false,
            observedAt: now, players: [], nameCounts: {}, reason: 'invalid_connect_endpoint'
        };
    }

    const cacheKey = `${connect.host}:${connect.gamePort}`;
    const cached = rosterCache.get(cacheKey);
    if (!options.noCache && cached && now - cached.observedAt < ROSTER_CACHE_MS) return cached;

    try {
        const discover = options.discoverQueryEndpoint || discoverQueryEndpoint;
        const query = options.queryPlayers || queryPlayers;
        const infoQuery = options.queryInfo || queryInfo;
        const endpoint = await discover(server, options);
        const entries = await query(endpoint.host, endpoint.port, options);
        const names = entries.map(player => player.name).filter(name => typeof name === 'string' && name.trim() !== '');

        if (names.length === 0) {
            let info;
            try {
                info = await infoQuery(endpoint.host, endpoint.port, options);
            }
            catch (error) {
                return {
                    source: 'a2s', capability: 'unavailable', available: false, complete: false,
                    observedAt: now, queryAddress: `${endpoint.host}:${endpoint.port}`, players: [], nameCounts: {},
                    reason: `Empty A2S_PLAYER roster could not be verified: ${error.message}`
                };
            }
            if (info.players > 0) {
                return {
                    source: 'a2s', capability: 'unavailable', available: false, complete: false,
                    observedAt: now, queryAddress: `${endpoint.host}:${endpoint.port}`, players: [], nameCounts: {},
                    population: info.players,
                    reason: `A2S_PLAYER returned no names while A2S_INFO reports ${info.players} players.`
                };
            }
        }

        const snapshot = {
            source: 'a2s', capability: 'names_only', available: true, complete: true,
            observedAt: now, queryAddress: `${endpoint.host}:${endpoint.port}`, players: names,
            nameCounts: buildNameCounts(names), entries: entries, population: names.length
        };
        rosterCache.set(cacheKey, snapshot);
        return snapshot;
    }
    catch (error) {
        return {
            source: 'a2s', capability: 'unavailable', available: false, complete: false,
            observedAt: now, players: [], nameCounts: {}, reason: error.message
        };
    }
}

module.exports = {
    parseConnectEndpoint,
    selectQueryEndpoint,
    discoverQueryEndpoint,
    normalizeResponsePayload,
    assembleSplitPackets,
    parsePlayerResponse,
    parseInfoResponse,
    queryPlayers,
    queryInfo,
    getServerRoster
};
