const A2sRoster = require('./a2sRoster.js');

const SOURCE = 'steam_profile';

function collectServerEndpoints(server) {
    const endpoints = new Set();
    const connect = A2sRoster.parseConnectEndpoint(server && server.connect);
    if (connect) endpoints.add(`${connect.host.toLowerCase()}:${connect.gamePort}`);

    const gameIp = server && typeof server.gameIp === 'string' ? server.gameIp.trim().toLowerCase() : '';
    const gamePort = Number(server && server.gamePort);
    if (gameIp && Number.isInteger(gamePort) && gamePort > 0 && gamePort <= 65535) {
        endpoints.add(`${gameIp}:${gamePort}`);
    }
    return endpoints;
}

function evaluate(previousState, trackedPlayers, profilesBySteamId, server) {
    const serverEndpoints = collectServerEndpoints(server);
    if (serverEndpoints.size === 0) return { available: false, covered: [], state: {}, events: [] };

    const covered = [];
    const state = {};
    const events = [];
    for (const tracked of trackedPlayers) {
        if (!tracked || tracked.steamId === null || tracked.steamId === undefined) continue;
        const profile = profilesBySteamId && profilesBySteamId[`${tracked.steamId}`];
        if (!profile || profile.available !== true || !profile.connect) continue;

        const endpoint = A2sRoster.parseConnectEndpoint(profile.connect);
        if (!endpoint) continue;
        const endpointKey = `${endpoint.host.toLowerCase()}:${endpoint.gamePort}`;
        const online = serverEndpoints.has(endpointKey);
        const previous = previousState[tracked.key];

        covered.push(tracked.key);
        state[tracked.key] = { initialized: true, online, source: SOURCE };
        if (previous && previous.initialized && previous.source === SOURCE && previous.online !== online) {
            events.push({
                key: tracked.key,
                type: online ? 'login' : 'logout',
                name: tracked.name,
                source: SOURCE
            });
        }
    }

    return { available: covered.length > 0, covered, state, events };
}

module.exports = { SOURCE, collectServerEndpoints, evaluate };
