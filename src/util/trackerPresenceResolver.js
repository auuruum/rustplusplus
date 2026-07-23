const TrackerA2sState = require('./trackerA2sState.js');
const TrackerSteamPresence = require('./trackerSteamPresence.js');
const Utils = require('./utils.js');

const LEGACY_TEAM_SOURCE = 'rustplus_team';

function apply(content, roster, profilesBySteamId, server) {
    roster = roster || {
        source: 'unavailable', available: false, complete: false, players: [], nameCounts: {},
        reason: 'Roster source is unavailable.'
    };
    const tracked = content.players.map((player, index) => ({
        key: `${player.steamId || player.playerId || index}`,
        name: Utils.removeInvisibleCharacters(player.name),
        steamId: player.steamId
    }));
    const previous = {};
    for (let i = 0; i < content.players.length; i++) {
        const player = content.players[i];
        previous[tracked[i].key] = {
            initialized: player.a2sStatus === 'online' || player.a2sStatus === 'offline',
            online: player.a2sStatus === 'online',
            source: player.presenceSource || null
        };
    }

    const steamEvaluation = TrackerSteamPresence.evaluate(previous, tracked, profilesBySteamId, server);
    const steamCovered = new Set(steamEvaluation.covered);
    const rosterTracked = tracked.filter(player => !steamCovered.has(player.key));
    const rosterPrevious = Object.fromEntries(rosterTracked.map(player => {
        const state = previous[player.key];
        const sourceChanged = state && [TrackerSteamPresence.SOURCE, LEGACY_TEAM_SOURCE].includes(state.source);
        return [player.key, sourceChanged ? Object.assign({}, state, { initialized: false }) : state];
    }));
    const rosterEvaluation = TrackerA2sState.evaluate(rosterPrevious, rosterTracked, roster);
    const rosterUsable = roster.available && roster.complete !== false && roster.cached !== true &&
        roster.liveTransitionEligible !== false;

    for (let i = 0; i < content.players.length; i++) {
        const player = content.players[i];
        const key = tracked[i].key;
        if (steamCovered.has(key)) {
            const state = steamEvaluation.state[key];
            player.a2sStatus = state.online ? 'online' : 'offline';
            player.a2sAmbiguous = false;
            player.presenceSource = TrackerSteamPresence.SOURCE;
            continue;
        }

        if ([TrackerSteamPresence.SOURCE, LEGACY_TEAM_SOURCE].includes(player.presenceSource)) {
            delete player.a2sStatus;
            delete player.presenceSource;
        }

        const state = rosterEvaluation.state[key];
        const ambiguous = rosterEvaluation.ambiguous.includes(key);
        player.a2sAmbiguous = ambiguous;
        if (rosterUsable && !ambiguous && state && state.initialized) {
            player.a2sStatus = state.online ? 'online' : 'offline';
            player.presenceSource = roster.source || 'a2s';
        }
    }

    const hasSteamCoverage = steamCovered.size > 0;
    content.rosterSource = hasSteamCoverage ? TrackerSteamPresence.SOURCE : (roster.source || 'unavailable');
    content.rosterUpstreamSource = hasSteamCoverage && roster.available ? roster.source :
        (roster.upstreamSource || null);
    content.rosterAvailable = hasSteamCoverage || roster.available;
    content.rosterUpdatedAt = hasSteamCoverage ? Date.now() : (roster.observedAt || Date.now());
    content.rosterUnavailableReason = !content.rosterAvailable ? roster.reason :
        (hasSteamCoverage && steamCovered.size < tracked.length && !roster.available ?
            `${roster.reason} Steam profiles expose a game endpoint for ${steamCovered.size}/${tracked.length} tracked players.` : null);

    return {
        covered: steamEvaluation.covered,
        events: rosterEvaluation.events.map(event => Object.assign({ source: roster.source }, event))
            .concat(steamEvaluation.events)
    };
}

module.exports = { apply };
