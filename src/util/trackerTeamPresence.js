const SOURCE = 'rustplus_team';

function evaluate(previousState, trackedPlayers, rustplus, serverId) {
    if (!rustplus || rustplus.isOperational !== true || rustplus.serverId !== serverId ||
        !rustplus.team || !Array.isArray(rustplus.team.players)) {
        return { available: false, covered: [], state: {}, events: [] };
    }

    const members = new Map();
    for (const member of rustplus.team.players) {
        if (!member || member.steamId === null || member.steamId === undefined ||
            typeof member.isOnline !== 'boolean') continue;
        members.set(`${member.steamId}`, member);
    }

    const covered = [];
    const state = {};
    const events = [];
    for (const tracked of trackedPlayers) {
        if (!tracked || tracked.steamId === null || tracked.steamId === undefined) continue;
        const member = members.get(`${tracked.steamId}`);
        if (!member) continue;

        covered.push(tracked.key);
        const online = member.isOnline;
        const previous = previousState[tracked.key];
        state[tracked.key] = { initialized: true, online, source: SOURCE };

        // A source change creates a baseline. Only consecutive Rust+ Team observations emit transitions.
        if (previous && previous.initialized && previous.source === SOURCE && previous.online !== online) {
            events.push({
                key: tracked.key,
                type: online ? 'login' : 'logout',
                name: tracked.name,
                source: SOURCE
            });
        }
    }

    return { available: true, covered, state, events };
}

module.exports = { SOURCE, evaluate };
