function evaluate(previousState, trackedPlayers, roster) {
    if (!roster || !roster.available || roster.complete === false || roster.cached === true ||
        roster.liveTransitionEligible === false) {
        return { state: previousState, events: [], ambiguous: [] };
    }

    const state = Object.assign({}, previousState);
    const events = [];
    const ambiguous = [];
    const counts = roster.nameCounts || {};

    for (const player of trackedPlayers) {
        const previous = previousState[player.key];
        const count = counts[player.name] || 0;
        if (count > 1) {
            ambiguous.push(player.key);
            continue;
        }

        const online = count === 1;
        if (!previous || !previous.initialized) {
            state[player.key] = { online: online, initialized: true };
            continue;
        }

        state[player.key] = { online: online, initialized: true };
        if (previous.online !== online) {
            events.push({ key: player.key, type: online ? 'login' : 'logout', name: player.name });
        }
    }

    return { state: state, events: events, ambiguous: ambiguous };
}

module.exports = { evaluate };
