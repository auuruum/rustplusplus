/*
    Public Rust server roster discovery through Steam server metadata and A2S_PLAYER.
    A2S exposes display names, scores, and session duration. It does not expose Steam IDs.
*/

const Axios = require('axios');
const Dgram = require('dgram');
const Dns = require('dns');
const Net = require('net');

const Utils = require('./utils.js');

const RUST_APP_ID = 252490;
const DEFAULT_HTTP_TIMEOUT_MS = 5000;
const DEFAULT_UDP_TIMEOUT_MS = 3000;
const DEFAULT_RELAY_TIMEOUT_MS = 8000;
const DEFAULT_A2S_RELAY_URL = 'https://gamedig-api.hexane.co/rust/ip={host}&port={port}';
const QUERY_ENDPOINT_CACHE_MS = 6 * 60 * 60 * 1000;
const ROSTER_CACHE_MS = 45 * 1000;
const STEAM_DIRECTORY_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'RustPlusPlus/1.26.1 (+https://github.com/alexemanuelol/rustplusplus)'
};
const A2S_RELAY_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': STEAM_DIRECTORY_HEADERS['User-Agent']
};

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

function getServerConnectDisplay(server) {
    if (!server || typeof server !== 'object') return null;

    const connect = parseConnectEndpoint(server.connect);
    if (connect) return `connect ${connect.host}:${connect.gamePort}`;

    const gameHost = typeof server.gameIp === 'string' && server.gameIp.trim() !== '' ?
        server.gameIp.trim() : (typeof server.gameHost === 'string' ? server.gameHost.trim() : '');
    const gamePort = Number(server.gamePort);
    if (gameHost && Number.isInteger(gamePort) && gamePort > 0 && gamePort <= 65535) {
        return `connect ${gameHost}:${gamePort}`;
    }

    return typeof server.serverIp === 'string' && server.serverIp.trim() !== '' ? server.serverIp.trim() : null;
}

function inferKnownProviderConnect(server) {
    if (!server || typeof server.title !== 'string' || typeof server.url !== 'string') return null;
    let website;
    try {
        website = new URL(server.url);
    }
    catch (_) {
        return null;
    }
    if (!['moose.gg', 'www.moose.gg'].includes(website.hostname.toLowerCase())) return null;

    const match = server.title.trim().match(/^Rusty Moose\s+\|?(EU|US)\s+(Main|Medium|Monthly|Mondays|Mini|Biweekly|Small|Low|Hapis)\|?$/i);
    if (!match) return null;
    return {
        host: `${match[2].toLowerCase()}.${match[1].toLowerCase()}.moose.gg`,
        gamePort: 28010
    };
}

async function resolvePublicIpv4(host, options = {}) {
    if (isPublicIpv4(host)) return host;
    if (typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host) || host.length > 253) {
        throw new Error('Server game host is not a valid public IPv4 address or DNS hostname.');
    }
    const resolveHost = options.resolveHost || (async hostname =>
        Dns.promises.lookup(hostname, { family: 4, all: true }));
    const resolved = await resolveHost(host);
    const addresses = (Array.isArray(resolved) ? resolved : [resolved])
        .map(entry => typeof entry === 'string' ? entry : entry && entry.address)
        .filter(Boolean);
    const publicAddress = addresses.find(isPublicIpv4);
    if (!publicAddress) throw new Error(`Server game host ${host} did not resolve to a public IPv4 address.`);
    return publicAddress;
}

function parseAddress(address) {
    if (typeof address !== 'string') return null;
    const match = address.match(/^(.+):(\d{1,5})$/);
    if (!match) return null;
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: match[1], port: port };
}

function isPublicIpv4(host) {
    if (!Net.isIPv4(host)) return false;
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
}

function getRelayUrlTemplate(options = {}) {
    const configured = options.relayUrlTemplate !== undefined ? options.relayUrlTemplate :
        process.env.RPP_A2S_RELAY_URL;
    if (configured === false) return null;
    if (typeof configured === 'string' && ['0', 'false', 'off', 'disabled'].includes(configured.trim().toLowerCase())) {
        return null;
    }
    return typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : DEFAULT_A2S_RELAY_URL;
}

function buildRelayUrl(host, port, options = {}) {
    if (!isPublicIpv4(host)) throw new Error('Hosted A2S requires a public IPv4 query address.');
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
        throw new Error('Hosted A2S query port is invalid.');
    }
    const template = getRelayUrlTemplate(options);
    if (!template) throw new Error('Hosted A2S fallback is disabled.');
    if (!template.includes('{host}') || !template.includes('{port}')) {
        throw new Error('RPP_A2S_RELAY_URL must contain {host} and {port} placeholders.');
    }
    return template
        .replaceAll('{host}', encodeURIComponent(host))
        .replaceAll('{port}', encodeURIComponent(`${Number(port)}`));
}

function parseRelayResponse(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Hosted A2S returned an invalid response.');
    if (payload.online !== true) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Hosted A2S reported the server unavailable.');
    }
    if (!Array.isArray(payload.players)) throw new Error('Hosted A2S response has no player roster.');
    if (payload.players.length > 255) throw new Error('Hosted A2S response exceeds the A2S player-count limit.');

    const entries = payload.players.map((player, index) => {
        if (!player || typeof player !== 'object' || typeof player.name !== 'string') {
            throw new Error('Hosted A2S response contains an invalid player entry.');
        }
        if (Buffer.byteLength(player.name, 'utf8') > 1024) {
            throw new Error('Hosted A2S response contains an oversized player name.');
        }
        const raw = player.raw && typeof player.raw === 'object' ? player.raw : {};
        return {
            index,
            name: player.name,
            score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0,
            duration: Number.isFinite(Number(raw.time)) ? Number(raw.time) : 0
        };
    });
    const rawPopulation = payload.raw && payload.raw.numplayers;
    const reportedPopulation = Number(rawPopulation);
    return {
        entries,
        reportedPopulation: rawPopulation !== null && rawPopulation !== undefined &&
            Number.isInteger(reportedPopulation) && reportedPopulation >= 0 && reportedPopulation <= 255 ?
            reportedPopulation : null
    };
}

async function queryPlayersViaRelay(host, port, options = {}) {
    const url = buildRelayUrl(host, port, options);
    const requestJson = options.requestRelayJson || (async requestUrl => {
        const response = await Axios.get(requestUrl, {
            timeout: options.relayTimeoutMs || DEFAULT_RELAY_TIMEOUT_MS,
            headers: A2S_RELAY_HEADERS
        });
        return response.data;
    });
    return parseRelayResponse(await requestJson(url));
}

function rememberQueryEndpoint(server, endpoint) {
    if (!server || typeof server !== 'object' || !endpoint) return endpoint;
    server.queryIp = endpoint.host;
    server.queryPort = endpoint.port;
    return endpoint;
}

function forgetQueryEndpoint(server, endpoint) {
    if (server && typeof server === 'object' && endpoint &&
        `${server.queryIp}` === `${endpoint.host}` && Number(server.queryPort) === Number(endpoint.port)) {
        server.queryIp = null;
        server.queryPort = null;
    }
    for (const [cacheKey, cached] of queryEndpointCache.entries()) {
        if (cached.endpoint.host === endpoint.host && cached.endpoint.port === endpoint.port) {
            queryEndpointCache.delete(cacheKey);
        }
    }
    rosterCache.delete(`${endpoint.host}:${endpoint.port}`);
}

function selectQueryEndpoint(payload, gamePort) {
    const servers = payload && payload.response && Array.isArray(payload.response.servers) ?
        payload.response.servers : [];
    const match = servers.find(server => Number(server.appid) === RUST_APP_ID &&
        Number(server.gameport) === Number(gamePort));
    return match ? parseAddress(match.addr) : null;
}

function selectUniqueRustQueryEndpoint(payload) {
    const servers = payload && payload.response && Array.isArray(payload.response.servers) ?
        payload.response.servers : [];
    const rustServers = servers.filter(server => Number(server.appid) === RUST_APP_ID);
    if (rustServers.length !== 1) return null;
    return parseAddress(rustServers[0].addr);
}

function selectUniqueRustServer(payload) {
    const servers = payload && payload.response && Array.isArray(payload.response.servers) ?
        payload.response.servers : [];
    const rustServers = servers.filter(server => Number(server.appid) === RUST_APP_ID);
    return rustServers.length === 1 ? rustServers[0] : null;
}

async function discoverQueryEndpoint(server, options = {}) {
    const explicitPort = Number(server.queryPort || server.portQuery || server.a2sQueryPort);
    const explicitHost = server.queryIp || server.queryHost || server.a2sQueryIp;
    if (explicitHost && Number.isInteger(explicitPort) && explicitPort > 0 && explicitPort <= 65535) {
        return rememberQueryEndpoint(server, { host: `${explicitHost}`, port: explicitPort });
    }

    let connect = parseConnectEndpoint(server && server.connect);
    if (!connect) {
        connect = inferKnownProviderConnect(server);
        if (connect) server.connect = `connect ${connect.host}:${connect.gamePort}`;
    }
    const serverHost = connect ? connect.host : (server && typeof server.serverIp === 'string' ?
        server.serverIp.trim() : '');
    if (!serverHost) throw new Error('Server connect endpoint and server IP are missing or invalid.');
    const directoryHost = await resolvePublicIpv4(serverHost, options);

    const cacheKey = connect ? `${connect.host}:${connect.gamePort}` : `${serverHost}:auto`;
    const now = options.now ? options.now() : Date.now();
    const cached = queryEndpointCache.get(cacheKey);
    if (cached && now - cached.observedAt < QUERY_ENDPOINT_CACHE_MS) {
        return rememberQueryEndpoint(server, cached.endpoint);
    }

    const requestJson = options.requestJson || (async url => {
        const response = await Axios.get(url, {
            timeout: DEFAULT_HTTP_TIMEOUT_MS,
            headers: STEAM_DIRECTORY_HEADERS
        });
        return response.data;
    });
    const url = 'https://api.steampowered.com/ISteamApps/GetServersAtAddress/v0001/?' +
        `addr=${encodeURIComponent(directoryHost)}&format=json`;
    const payload = await requestJson(url);
    const uniqueRustServer = connect ? null : selectUniqueRustServer(payload);
    const endpoint = connect ? selectQueryEndpoint(payload, connect.gamePort) :
        (uniqueRustServer ? parseAddress(uniqueRustServer.addr) : null);
    if (!endpoint) {
        const qualifier = connect ? 'matching the configured game port' : 'that was unambiguous';
        throw new Error(`Steam did not return a Rust query endpoint ${qualifier} for ${cacheKey}.`);
    }

    const discoveredGamePort = uniqueRustServer ? Number(uniqueRustServer.gameport) : null;
    if (connect) {
        server.gameHost = connect.host;
        server.gameIp = directoryHost;
        server.gamePort = connect.gamePort;
    }
    if (!connect && Number.isInteger(discoveredGamePort) && discoveredGamePort > 0 && discoveredGamePort <= 65535) {
        server.gameIp = serverHost;
        server.gamePort = discoveredGamePort;
        server.connect = `connect ${serverHost}:${discoveredGamePort}`;
    }

    queryEndpointCache.set(cacheKey, { endpoint: endpoint, observedAt: now });
    return rememberQueryEndpoint(server, endpoint);
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
    const now = options.now ? options.now() : Date.now();

    try {
        const discover = options.discoverQueryEndpoint || discoverQueryEndpoint;
        const query = options.queryPlayers || queryPlayers;
        const infoQuery = options.queryInfo || queryInfo;
        const relayQuery = options.queryPlayersViaRelay || queryPlayersViaRelay;
        const hadRememberedEndpoint = Boolean(server && server.queryIp && Number(server.queryPort));
        let endpoint = await discover(server, options);
        let cacheKey = `${endpoint.host}:${endpoint.port}`;
        const cached = rosterCache.get(cacheKey);
        if (!options.noCache && cached && now - cached.observedAt < ROSTER_CACHE_MS) return cached;
        let entries;
        let rosterSource = 'a2s';
        let reportedPopulation = null;
        let directError = null;
        try {
            entries = await query(endpoint.host, endpoint.port, options);
        }
        catch (error) {
            directError = error;
            if (hadRememberedEndpoint && options.rediscoverOnQueryFailure !== false &&
                !options.discoverQueryEndpoint) {
                const failedEndpoint = endpoint;
                forgetQueryEndpoint(server, endpoint);
                let rediscoveryError = null;
                try {
                    endpoint = await discover(server, options);
                    cacheKey = `${endpoint.host}:${endpoint.port}`;
                }
                catch (errorDuringRediscovery) {
                    rediscoveryError = errorDuringRediscovery;
                }
                if (rediscoveryError) {
                    endpoint = failedEndpoint;
                    cacheKey = `${endpoint.host}:${endpoint.port}`;
                    rememberQueryEndpoint(server, endpoint);
                    directError = new Error(
                        `${error.message} Query endpoint rediscovery failed: ${rediscoveryError.message}`);
                }
                else if (endpoint.host !== failedEndpoint.host || endpoint.port !== failedEndpoint.port) {
                    try {
                        entries = await query(endpoint.host, endpoint.port, options);
                        directError = null;
                    }
                    catch (rediscoveredQueryError) {
                        directError = rediscoveredQueryError;
                    }
                }
            }
        }

        if (directError) {
            try {
                const relayed = await relayQuery(endpoint.host, endpoint.port, options);
                entries = relayed.entries;
                reportedPopulation = relayed.reportedPopulation;
                rosterSource = 'a2s_relay';
                rememberQueryEndpoint(server, endpoint);
            }
            catch (relayError) {
                throw new Error(`${directError.message} Hosted A2S fallback failed: ${relayError.message}`);
            }
        }
        const names = entries
            .map(player => typeof player.name === 'string' ? Utils.removeInvisibleCharacters(player.name).trim() : '')
            .filter(name => name !== '');

        if (names.length === 0) {
            let info;
            try {
                info = reportedPopulation === null ? await infoQuery(endpoint.host, endpoint.port, options) :
                    { players: reportedPopulation };
            }
            catch (error) {
                return {
                    source: rosterSource, capability: 'unavailable', available: false, complete: false,
                    observedAt: now, queryAddress: `${endpoint.host}:${endpoint.port}`, players: [], nameCounts: {},
                    reason: `Empty A2S_PLAYER roster could not be verified: ${error.message}`
                };
            }
            if (info.players > 0) {
                return {
                    source: rosterSource, capability: 'unavailable', available: false, complete: false,
                    observedAt: now, queryAddress: `${endpoint.host}:${endpoint.port}`, players: [], nameCounts: {},
                    population: info.players,
                    reason: `A2S_PLAYER returned no names while A2S_INFO reports ${info.players} players.`
                };
            }
        }

        const snapshot = {
            source: rosterSource, capability: 'names_only', available: true, complete: true,
            observedAt: now, queryAddress: `${endpoint.host}:${endpoint.port}`, players: names,
            nameCounts: buildNameCounts(names), entries: entries, population: names.length,
            reportedPopulation: reportedPopulation
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
    DEFAULT_A2S_RELAY_URL,
    parseConnectEndpoint,
    getServerConnectDisplay,
    inferKnownProviderConnect,
    resolvePublicIpv4,
    parseAddress,
    isPublicIpv4,
    getRelayUrlTemplate,
    buildRelayUrl,
    parseRelayResponse,
    rememberQueryEndpoint,
    forgetQueryEndpoint,
    selectQueryEndpoint,
    selectUniqueRustQueryEndpoint,
    selectUniqueRustServer,
    discoverQueryEndpoint,
    normalizeResponsePayload,
    assembleSplitPackets,
    parsePlayerResponse,
    parseInfoResponse,
    queryPlayers,
    queryInfo,
    queryPlayersViaRelay,
    getServerRoster
};
