const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_STABLE_THRESHOLD = 0;

function normalizePlayers(players) {
    const value = Number(players);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

function getTrendSymbol(trend) {
    if (trend === 'growing') return '↗';
    if (trend === 'falling') return '↘';
    return '→';
}

function buildTrend(currentPlayers, baselinePlayers, sampleCount, options = {}) {
    const stableThreshold = Number.isFinite(options.stableThreshold)
        ? options.stableThreshold
        : DEFAULT_STABLE_THRESHOLD;
    const delta = normalizePlayers(currentPlayers) - normalizePlayers(baselinePlayers);
    let trend = 'stable';

    if (Math.abs(delta) > stableThreshold) {
        trend = delta > 0 ? 'growing' : 'falling';
    }

    return {
        trend,
        delta,
        symbol: getTrendSymbol(trend),
        windowMinutes: Math.round((options.windowMs || DEFAULT_WINDOW_MS) / 60000),
        sampleCount
    };
}

function normalizePopulationTrend(currentPlayers, baselinePlayers, options = {}) {
    return buildTrend(currentPlayers, baselinePlayers, 2, options);
}

class PlayerPopulationTrend {
    constructor(options = {}) {
        this.windowMs = Number.isFinite(options.windowMs) ? options.windowMs : DEFAULT_WINDOW_MS;
        this.stableThreshold = Number.isFinite(options.stableThreshold)
            ? options.stableThreshold
            : DEFAULT_STABLE_THRESHOLD;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.samples = [];
    }

    record(players, timestamp = this.now()) {
        const sample = {
            players: normalizePlayers(players),
            timestamp: Number.isFinite(timestamp) ? timestamp : this.now()
        };

        this.samples.push(sample);
        this.prune(sample.timestamp);
        return this.getTrend(sample.timestamp);
    }

    getTrend(timestamp = this.now()) {
        this.prune(timestamp);
        if (this.samples.length === 0) {
            return buildTrend(0, 0, 0, this);
        }

        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        return buildTrend(last.players, first.players, this.samples.length, this);
    }

    prune(timestamp = this.now()) {
        const cutoff = timestamp - this.windowMs;
        const latest = this.samples[this.samples.length - 1];
        this.samples = this.samples.filter(sample => sample.timestamp >= cutoff);
        if (this.samples.length === 0 && latest) this.samples = [latest];
    }
}

module.exports = {
    PlayerPopulationTrend,
    normalizePopulationTrend
};
