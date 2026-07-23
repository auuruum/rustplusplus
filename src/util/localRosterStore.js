/*
    Copyright (C) 2026 FaiThiX

    Persistent, source-aware roster observations. Public A2S rosters contain display
    names only, so this store deliberately records name multiplicity instead of
    inventing Steam/BattleMetrics identity links.
*/

const Fs = require('fs');
const Path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

class LocalRosterStore {
    constructor(options = {}) {
        const databasePath = options.databasePath ||
            Path.join(__dirname, '..', '..', 'database', 'local_roster.db');
        Fs.mkdirSync(Path.dirname(databasePath), { recursive: true });
        this.db = new Database(databasePath);
        this.eventRetentionMs = Number.isFinite(options.eventRetentionMs) && options.eventRetentionMs >= 0 ?
            options.eventRetentionMs : DEFAULT_EVENT_RETENTION_MS;
        this.lastPrunedAt = 0;
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        try {
            Fs.chmodSync(databasePath, 0o600);
        }
        catch (error) {
            // Some platforms/filesystems do not support POSIX file modes.
        }
        this.init();
    }

    init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS roster_snapshots (
                guild_id TEXT NOT NULL,
                server_id TEXT NOT NULL,
                source TEXT NOT NULL,
                observed_at INTEGER NOT NULL,
                query_address TEXT,
                players_json TEXT NOT NULL,
                name_counts_json TEXT NOT NULL,
                PRIMARY KEY (guild_id, server_id)
            );

            CREATE TABLE IF NOT EXISTS roster_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                server_id TEXT NOT NULL,
                source TEXT NOT NULL,
                name TEXT NOT NULL,
                event_type TEXT NOT NULL CHECK(event_type IN ('join', 'leave')),
                amount INTEGER NOT NULL CHECK(amount > 0),
                observed_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_roster_events_server_time
                ON roster_events(guild_id, server_id, observed_at);
        `);

        this.getSnapshotStmt = this.db.prepare(`
            SELECT source, observed_at, query_address, players_json, name_counts_json
            FROM roster_snapshots
            WHERE guild_id = ? AND server_id = ?
        `);
        this.upsertSnapshotStmt = this.db.prepare(`
            INSERT INTO roster_snapshots (
                guild_id, server_id, source, observed_at, query_address, players_json, name_counts_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, server_id) DO UPDATE SET
                source = excluded.source,
                observed_at = excluded.observed_at,
                query_address = excluded.query_address,
                players_json = excluded.players_json,
                name_counts_json = excluded.name_counts_json
        `);
        this.insertEventStmt = this.db.prepare(`
            INSERT INTO roster_events (
                guild_id, server_id, source, name, event_type, amount, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        this.pruneEventsStmt = this.db.prepare('DELETE FROM roster_events WHERE observed_at < ?');
        this.recordTransaction = this.db.transaction((guildId, serverId, snapshot, previous, players, nameCounts) => {
            const sameSource = previous && previous.source === snapshot.source;
            const events = sameSource ? diffNameCounts(parseJsonObject(previous.name_counts_json), nameCounts) : [];
            for (const event of events) {
                this.insertEventStmt.run(guildId, serverId, snapshot.source, event.name, event.type,
                    event.count, snapshot.observedAt);
            }
            this.upsertSnapshotStmt.run(guildId, serverId, snapshot.source, snapshot.observedAt,
                snapshot.queryAddress || null, JSON.stringify(players), JSON.stringify(nameCounts));
            return events;
        });
    }

    recordSnapshot(guildId, serverId, roster) {
        if (!guildId || !serverId || !roster || !roster.available || !roster.complete ||
            !Array.isArray(roster.players)) {
            return { recorded: false, baseline: false, events: [] };
        }

        const observedAt = Number(roster.observedAt);
        if (!Number.isFinite(observedAt)) {
            return { recorded: false, baseline: false, events: [] };
        }

        const previous = this.getSnapshotStmt.get(`${guildId}`, `${serverId}`);
        if (previous && observedAt <= previous.observed_at) {
            return { recorded: false, baseline: false, events: [] };
        }

        const players = normalizePlayers(roster.players);
        const nameCounts = buildNameCounts(players);
        const snapshot = {
            source: roster.source || 'unknown',
            observedAt,
            queryAddress: roster.queryAddress || null
        };
        const events = this.recordTransaction(`${guildId}`, `${serverId}`, snapshot, previous, players, nameCounts);
        this.pruneEvents(observedAt);
        return { recorded: true, baseline: !previous || previous.source !== snapshot.source, events };
    }

    pruneEvents(now = Date.now()) {
        if (!Number.isFinite(now) || now - this.lastPrunedAt < 60 * 60 * 1000) return 0;
        const result = this.pruneEventsStmt.run(now - this.eventRetentionMs);
        this.lastPrunedAt = now;
        return result.changes;
    }

    getFreshSnapshot(guildId, serverId, maxAgeMs, now = Date.now()) {
        const row = this.getSnapshotStmt.get(`${guildId}`, `${serverId}`);
        if (!row) return null;

        const age = Math.max(0, Number(now) - row.observed_at);
        if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || age > maxAgeMs) return null;

        const players = parseJsonArray(row.players_json);
        return {
            source: 'local_cache',
            upstreamSource: row.source,
            capability: 'names_only',
            available: true,
            complete: true,
            cached: true,
            liveTransitionEligible: false,
            observedAt: row.observed_at,
            queryAddress: row.query_address,
            players,
            nameCounts: parseJsonObject(row.name_counts_json),
            population: players.length
        };
    }

    getRecentEvents(guildId, serverId, limit = 100) {
        const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
        return this.db.prepare(`
            SELECT name, event_type, amount AS count, source, observed_at
            FROM (
                SELECT id, name, event_type, amount, source, observed_at
                FROM roster_events
                WHERE guild_id = ? AND server_id = ?
                ORDER BY observed_at DESC, id DESC
                LIMIT ?
            )
            ORDER BY observed_at ASC, id ASC
        `).all(`${guildId}`, `${serverId}`, safeLimit);
    }

    close() {
        if (this.db && this.db.open) this.db.close();
    }
}

class DisabledLocalRosterStore {
    recordSnapshot() {
        return { recorded: false, baseline: false, events: [] };
    }

    getFreshSnapshot() {
        return null;
    }

    getRecentEvents() {
        return [];
    }

    pruneEvents() {
        return 0;
    }

    close() {}
}

function normalizePlayers(players) {
    return players
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(name => name !== '');
}

function buildNameCounts(players) {
    const counts = {};
    for (const name of players) counts[name] = (counts[name] || 0) + 1;
    return counts;
}

function diffNameCounts(previous, current) {
    const names = new Set([...Object.keys(previous), ...Object.keys(current)]);
    const events = [];
    for (const name of names) {
        const delta = (current[name] || 0) - (previous[name] || 0);
        if (delta > 0) events.push({ name, type: 'join', count: delta });
        if (delta < 0) events.push({ name, type: 'leave', count: Math.abs(delta) });
    }
    return events;
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (error) {
        return [];
    }
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch (error) {
        return {};
    }
}

let localRosterStore;
try {
    localRosterStore = new LocalRosterStore();
}
catch (error) {
    console.warn(`Local roster persistence disabled: ${error.message}`);
    localRosterStore = new DisabledLocalRosterStore();
}
localRosterStore.LocalRosterStore = LocalRosterStore;
localRosterStore.DisabledLocalRosterStore = DisabledLocalRosterStore;
localRosterStore.buildNameCounts = buildNameCounts;
localRosterStore.diffNameCounts = diffNameCounts;

module.exports = localRosterStore;
