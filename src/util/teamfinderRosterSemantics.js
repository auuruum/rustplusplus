function prepareRosterForDiscovery(roster) {
    if (!roster || !roster.available || !roster.complete) return roster;
    if (roster.cached !== true && roster.source !== 'local_cache') return roster;

    return Object.assign({}, roster, {
        available: false,
        complete: false,
        players: [],
        nameCounts: {},
        reason: 'Recent local roster cache is display-only and cannot prove who is online now.'
    });
}

function isLiveRoster(roster) {
    if (!roster) return true;
    return roster.available === true && roster.complete === true && roster.cached !== true &&
        roster.source !== 'local_cache';
}

module.exports = {
    isLiveRoster,
    prepareRosterForDiscovery
};
