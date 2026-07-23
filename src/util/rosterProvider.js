/*
    Selects a compliant current-roster source and persists successful observations.
    Priority: authorized BattleMetrics API -> direct/hosted public A2S -> short-lived local cache.
*/

const A2sRoster = require('./a2sRoster.js');
const LocalRosterStore = require('./localRosterStore.js');

const DEFAULT_BATTLEMETRICS_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_LOCAL_CACHE_MAX_AGE_MS = 3 * 60 * 1000;

async function getRosterSnapshot(context, dependencies = {}) {
    const now = Number.isFinite(context.now) ? context.now : Date.now();
    const store = dependencies.store || LocalRosterStore;
    const fetchA2s = dependencies.fetchA2s || A2sRoster.getServerRoster;
    const battlemetricsMaxAgeMs = Number.isFinite(context.battlemetricsMaxAgeMs) ?
        context.battlemetricsMaxAgeMs : DEFAULT_BATTLEMETRICS_MAX_AGE_MS;
    const maxCacheAgeMs = Number.isFinite(context.maxCacheAgeMs) ?
        context.maxCacheAgeMs : DEFAULT_LOCAL_CACHE_MAX_AGE_MS;

    const battlemetricsRoster = buildBattlemetricsRoster(context.battlemetrics, now, battlemetricsMaxAgeMs);
    if (battlemetricsRoster && battlemetricsRoster.complete) {
        return persistSnapshot(store, context, battlemetricsRoster, dependencies);
    }

    let a2sRoster;
    try {
        a2sRoster = await fetchA2s(context.server || {}, {
            expectedPopulation: battlemetricsRoster ? battlemetricsRoster.population : undefined
        });
    }
    catch (error) {
        a2sRoster = unavailableSnapshot(now, `A2S query failed: ${error.message}`);
    }
    if (a2sRoster && a2sRoster.available && a2sRoster.complete) {
        const normalized = normalizeSnapshot(a2sRoster, now);
        return persistSnapshot(store, context, normalized, dependencies);
    }

    if (battlemetricsRoster && battlemetricsRoster.available) return battlemetricsRoster;

    let cached = null;
    try {
        cached = store.getFreshSnapshot(context.guildId, context.serverId, maxCacheAgeMs, now);
    }
    catch (error) {
        reportStoreError(context, dependencies, 'read', error);
        if (a2sRoster) return Object.assign({}, a2sRoster, { persistenceAvailable: false });
        return Object.assign(unavailableSnapshot(now, 'No roster source returned a result.'), {
            persistenceAvailable: false
        });
    }
    return cached || a2sRoster || unavailableSnapshot(now, 'No roster source returned a result.');
}

function persistSnapshot(store, context, roster, dependencies) {
    try {
        store.recordSnapshot(context.guildId, context.serverId, roster);
        return roster;
    }
    catch (error) {
        reportStoreError(context, dependencies, 'write', error);
        return Object.assign({}, roster, { persistenceAvailable: false });
    }
}

function reportStoreError(context, dependencies, operation, error) {
    const reporter = dependencies.onStoreError || context.onStoreError;
    if (typeof reporter === 'function') reporter(error, operation);
}

function buildBattlemetricsRoster(battlemetrics, now, maxAgeMs) {
    if (!battlemetrics || !battlemetrics.lastUpdateSuccessful) return null;

    const parsedUpdatedAt = battlemetrics.updatedAt ? Date.parse(battlemetrics.updatedAt) : NaN;
    const observedAt = Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : now;
    if (Math.max(0, now - observedAt) > maxAgeMs) return null;

    const playersById = battlemetrics.players || {};
    const onlinePlayers = Array.isArray(battlemetrics.onlinePlayers) ? battlemetrics.onlinePlayers : [];
    const players = onlinePlayers
        .map(playerId => playersById[playerId] && playersById[playerId].name)
        .filter(name => typeof name === 'string');
    const reportedPopulation = Number(battlemetrics.server_players);
    const hasReportedPopulation = Number.isFinite(reportedPopulation) && reportedPopulation >= 0;
    const complete = !hasReportedPopulation || players.length === reportedPopulation;

    return normalizeSnapshot({
        source: 'battlemetrics_api',
        capability: 'names_only',
        available: true,
        complete,
        observedAt,
        players,
        population: hasReportedPopulation ? reportedPopulation : players.length,
        reason: complete ? null :
            `BattleMetrics returned ${players.length} of ${reportedPopulation} online player names.`
    }, now);
}

function normalizeSnapshot(roster, fallbackObservedAt) {
    const players = (Array.isArray(roster.players) ? roster.players : [])
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(name => name !== '');
    return Object.assign({}, roster, {
        observedAt: Number.isFinite(Number(roster.observedAt)) ? Number(roster.observedAt) : fallbackObservedAt,
        players,
        nameCounts: buildNameCounts(players),
        population: Number.isFinite(Number(roster.population)) ? Number(roster.population) : players.length,
        liveTransitionEligible: roster.liveTransitionEligible !== false && roster.cached !== true
    });
}

function buildNameCounts(players) {
    const counts = {};
    for (const name of players) counts[name] = (counts[name] || 0) + 1;
    return counts;
}

function unavailableSnapshot(observedAt, reason) {
    return {
        source: 'unavailable',
        capability: 'unavailable',
        available: false,
        complete: false,
        observedAt,
        players: [],
        nameCounts: {},
        reason
    };
}

module.exports = {
    DEFAULT_BATTLEMETRICS_MAX_AGE_MS,
    DEFAULT_LOCAL_CACHE_MAX_AGE_MS,
    buildBattlemetricsRoster,
    normalizeSnapshot,
    getRosterSnapshot
};
