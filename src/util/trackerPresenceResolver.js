const TrackerA2sState = require('./trackerA2sState.js');
const TrackerTeamPresence = require('./trackerTeamPresence.js');
const Utils = require('./utils.js');

function apply(content, roster, rustplus) {
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

    const teamEvaluation = TrackerTeamPresence.evaluate(previous, tracked, rustplus, content.serverId);
    const teamCovered = new Set(teamEvaluation.covered);
    const rosterTracked = tracked.filter(player => !teamCovered.has(player.key));
    const rosterPrevious = Object.fromEntries(rosterTracked.map(player => {
        const state = previous[player.key];
        return [player.key, state && state.source === TrackerTeamPresence.SOURCE ?
            Object.assign({}, state, { initialized: false }) : state];
    }));
    const rosterEvaluation = TrackerA2sState.evaluate(rosterPrevious, rosterTracked, roster);
    const rosterUsable = roster && roster.available && roster.complete !== false && roster.cached !== true &&
        roster.liveTransitionEligible !== false;

    for (let i = 0; i < content.players.length; i++) {
        const player = content.players[i];
        const key = tracked[i].key;
        if (teamCovered.has(key)) {
            const state = teamEvaluation.state[key];
            player.a2sStatus = state.online ? 'online' : 'offline';
            player.a2sAmbiguous = false;
            player.presenceSource = TrackerTeamPresence.SOURCE;
            continue;
        }

        const wasTeamSource = player.presenceSource === TrackerTeamPresence.SOURCE;
        if (wasTeamSource) {
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

    const hasTeamCoverage = teamCovered.size > 0;
    content.rosterSource = hasTeamCoverage ? 'rustplus_team' : (roster.source || 'unavailable');
    content.rosterUpstreamSource = hasTeamCoverage && roster.available ? roster.source :
        (roster.upstreamSource || null);
    content.rosterAvailable = hasTeamCoverage || roster.available;
    content.rosterUpdatedAt = hasTeamCoverage ? Date.now() : (roster.observedAt || Date.now());
    content.rosterUnavailableReason = !content.rosterAvailable ? roster.reason :
        (hasTeamCoverage && teamCovered.size < tracked.length && !roster.available ?
            `${roster.reason} Rust+ Team covers ${teamCovered.size}/${tracked.length} tracked players.` : null);

    return {
        covered: teamEvaluation.covered,
        events: rosterEvaluation.events.map(event => Object.assign({ source: roster.source }, event))
            .concat(teamEvaluation.events)
    };
}

module.exports = { apply };
