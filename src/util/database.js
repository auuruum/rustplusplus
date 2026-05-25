/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const Fs = require('fs');
const Path = require('path');
const Database = require('better-sqlite3');

/**
 * PlayerActivity database manager
 * Tracks player login/logout events and provides analysis of offline patterns
 */
class PlayerActivityDB {
    constructor() {
        this.dbFolder = Path.join(__dirname, '..', '..', 'database');
        
        // Ensure database directory exists
        if (!Fs.existsSync(this.dbFolder)) {
            Fs.mkdirSync(this.dbFolder);
        }
        
        this.db = null;
        this.init();
    }

    /**
     * Initialize the database and create tables if they don't exist
     */
    init() {
        try {
            this.db = new Database(Path.join(this.dbFolder, 'player_activity.db'));
            
            // Create tables if they don't exist
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bm_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    UNIQUE(bm_id, server_id, guild_id)
                );
                
                CREATE TABLE IF NOT EXISTS activity_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_activity_events_player_id ON activity_events(player_id);
                CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON activity_events(timestamp);

                CREATE TABLE IF NOT EXISTS name_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    first_seen INTEGER NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(id)
                );

                CREATE INDEX IF NOT EXISTS idx_name_history_player_id ON name_history(player_id);
            `);
            
            // Prepare statements
            this.insertPlayerStmt = this.db.prepare(`
                INSERT OR IGNORE INTO players (bm_id, name, server_id, guild_id) 
                VALUES (?, ?, ?, ?)
            `);
            
            this.getPlayerIdStmt = this.db.prepare(`
                SELECT id FROM players WHERE bm_id = ? AND server_id = ? AND guild_id = ?
            `);
            
            this.updatePlayerNameStmt = this.db.prepare(`
                UPDATE players SET name = ? WHERE bm_id = ? AND server_id = ? AND guild_id = ?
            `);

            this.insertNameHistoryStmt = this.db.prepare(`
                INSERT INTO name_history (player_id, name, first_seen)
                SELECT ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1 FROM name_history WHERE player_id = ? AND name = ?
                )
            `);

            this.getNameHistoryStmt = this.db.prepare(`
                SELECT name, first_seen
                FROM name_history
                WHERE player_id = ?
                ORDER BY first_seen ASC
            `);
            
            this.insertActivityEventStmt = this.db.prepare(`
                INSERT INTO activity_events (player_id, event_type, timestamp)
                VALUES (?, ?, ?)
            `);
            
            this.getOfflinePatternStmt = this.db.prepare(`
                SELECT 
                    strftime('%H', datetime(timestamp/1000, 'unixepoch', 'localtime')) AS hour,
                    COUNT(*) AS count
                FROM activity_events
                WHERE player_id = ? AND event_type = 'offline'
                GROUP BY hour
                ORDER BY count DESC
            `);
            
            this.getPlayerHistoryStmt = this.db.prepare(`
                SELECT 
                    e.event_type,
                    e.timestamp,
                    p.name
                FROM activity_events e
                JOIN players p ON e.player_id = p.id
                WHERE p.bm_id = ? AND p.server_id = ? AND p.guild_id = ?
                ORDER BY e.timestamp DESC
                LIMIT ?
            `);
            
            this.getPlayerInfoStmt = this.db.prepare(`
                SELECT * FROM players WHERE bm_id = ? AND server_id = ? AND guild_id = ?
            `);

            this.getRecentActivityStmt = this.db.prepare(`
                SELECT 
                    p.name,
                    p.bm_id,
                    e.event_type,
                    e.timestamp
                FROM activity_events e
                JOIN players p ON e.player_id = p.id
                WHERE p.server_id = ? AND p.guild_id = ?
                ORDER BY e.timestamp DESC
                LIMIT ?
            `);
            
            console.log('PlayerActivityDB initialized successfully');
        } catch (error) {
            console.error('Error initializing PlayerActivityDB:', error);
        }
    }

    /**
     * Record a player login event
     * @param {string} bmId - Player's Battlemetrics ID
     * @param {string} name - Player's name
     * @param {string} serverId - Server ID
     * @param {string} guildId - Discord Guild ID
     */
    recordLogin(bmId, name, serverId, guildId) {
        try {
            const playerId = this.getOrCreatePlayer(bmId, name, serverId, guildId);
            this.insertActivityEventStmt.run(playerId, 'online', Date.now());
        } catch (error) {
            console.error('Error recording login:', error);
        }
    }

    /**
     * Record a player logout event
     * @param {string} bmId - Player's Battlemetrics ID
     * @param {string} name - Player's name
     * @param {string} serverId - Server ID
     * @param {string} guildId - Discord Guild ID
     */
    recordLogout(bmId, name, serverId, guildId) {
        try {
            const playerId = this.getOrCreatePlayer(bmId, name, serverId, guildId);
            this.insertActivityEventStmt.run(playerId, 'offline', Date.now());
        } catch (error) {
            console.error('Error recording logout:', error);
        }
    }
    
    /**
     * Get or create a player record
     * @private
     */
    getOrCreatePlayer(bmId, name, serverId, guildId) {
        // Insert player if not exists
        this.insertPlayerStmt.run(bmId, name, serverId, guildId);

        // Get player ID
        const player = this.getPlayerIdStmt.get(bmId, serverId, guildId);
        const playerId = player ? player.id : null;

        if (playerId !== null) {
            // Update current name
            this.updatePlayerNameStmt.run(name, bmId, serverId, guildId);

            // Record name in history if not already there
            this.insertNameHistoryStmt.run(playerId, name, Date.now(), playerId, name);
        }

        return playerId;
    }
    

    
    /**
     * Get a player's activity history
     */
    getPlayerHistory(bmId, serverId, guildId, limit = 20) {
        try {
            return this.getPlayerHistoryStmt.all(bmId, serverId, guildId, limit);
        } catch (error) {
            console.error('Error getting player history:', error);
            return [];
        }
    }
    
    /**
     * Get offline patterns for a player
     */
    getOfflinePatterns(bmId, serverId, guildId) {
        try {
            const playerId = this.getPlayerIdStmt.get(bmId, serverId, guildId);
            if (!playerId) return [];
            
            return this.getOfflinePatternStmt.all(playerId.id);
        } catch (error) {
            console.error('Error getting offline patterns:', error);
            return [];
        }
    }
    
    /**
     * Get info about a player
     */
    getPlayerInfo(bmId, serverId, guildId) {
        try {
            return this.getPlayerInfoStmt.get(bmId, serverId, guildId);
        } catch (error) {
            console.error('Error getting player info:', error);
            return null;
        }
    }

    /**
     * Get name history for a player
     * @param {string} bmId - Player's Battlemetrics ID
     * @param {string} serverId - Server ID
     * @param {string} guildId - Discord Guild ID
     * @returns {Array} - Array of { name, first_seen } ordered oldest to newest
     */
    getNameHistory(bmId, serverId, guildId) {
        try {
            const player = this.getPlayerIdStmt.get(bmId, serverId, guildId);
            if (!player) return [];
            return this.getNameHistoryStmt.all(player.id);
        } catch (error) {
            console.error('Error getting name history:', error);
            return [];
        }
    }
    
    /**
     * Get recent activity for a server
     */
    getRecentActivity(serverId, guildId, limit = 20) {
        try {
            return this.getRecentActivityStmt.all(serverId, guildId, limit);
        } catch (error) {
            console.error('Error getting recent activity:', error);
            return [];
        }
    }
    
    /**
     * Analyze when a player is most likely to be offline
     * Returns the best time ranges to raid a player
     */
    analyzeOfflinePatterns(bmId, serverId, guildId) {
        try {
            const patterns = this.getOfflinePatterns(bmId, serverId, guildId);
            if (!patterns || patterns.length === 0) return null;
            
            // Group consecutive hours to find time ranges
            const hourCounts = Array(24).fill(0);
            patterns.forEach(p => {
                hourCounts[parseInt(p.hour)] = p.count;
            });
            
            // Find contiguous ranges of high offline probability
            const ranges = [];
            let currentRange = null;
            
            for (let i = 0; i < 24; i++) {
                const hour = i;
                const count = hourCounts[i];
                const nextCount = hourCounts[(i + 1) % 24];
                
                // Start a new range or extend the current one
                if (!currentRange && count > 0) {
                    currentRange = { start: hour, end: hour, totalEvents: count };
                } else if (currentRange && nextCount > 0) {
                    currentRange.end = (i + 1) % 24;
                    currentRange.totalEvents += nextCount;
                } else if (currentRange) {
                    ranges.push(currentRange);
                    currentRange = null;
                }
            }
            
            // Close the last range if it spans across midnight
            if (currentRange) {
                ranges.push(currentRange);
            }
            
            // Calculate the best raid times based on offline patterns
            const bestRaidTimes = ranges.map(range => {
                const duration = range.end >= range.start ? 
                    range.end - range.start + 1 : 
                    24 - range.start + range.end + 1;
                
                return {
                    startHour: range.start,
                    endHour: range.end,
                    duration: duration,
                    offlineEvents: range.totalEvents,
                    averageEventsPerHour: range.totalEvents / duration
                };
            }).sort((a, b) => b.averageEventsPerHour - a.averageEventsPerHour);
            
            return bestRaidTimes;
        } catch (error) {
            console.error('Error analyzing offline patterns:', error);
            return null;
        }
    }
    
    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = new PlayerActivityDB();
