/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

const axios = require('axios');
const Config = require('../../config');
const Path = require('path');
const Logger = require('../structures/Logger');

/**
 * License Service - Handles all license-related operations
 * This service manages license checking and activation for Discord guilds
 */
class LicenseService {
    constructor() {
        // Base URL for the license server API
        this.baseUrl = Config.license.serverUrl;
        
        // Cache to store license status to avoid excessive API calls
        this.licenseCache = new Map();
        
        // Cache expiry time in milliseconds (5 minutes)
        this.cacheExpiry = 5 * 60 * 1000;
        
        // Track webhook notifications to prevent spam (guild_id -> timestamp)
        this.webhookNotificationsSent = new Map();
        
        // Webhook notification cooldown in milliseconds (30 minutes)
        this.webhookCooldown = 30 * 60 * 1000;
        
        // Set up periodic license checking every 5 minutes
        this.setupPeriodicCheck();

        // Initialize built-in logger
        this.logger = new Logger(Path.join(__dirname, '..', '..', 'logs/licenseService.log'), 'default');
    }

    /**
     * Check the license status for a specific guild
     * @param {string} guildId - The Discord guild ID
     * @param {boolean} forceRefresh - Force refresh from API (bypass cache)
     * @returns {Promise<Object>} License status object
     */
    async checkLicense(guildId, forceRefresh = false) {
        try {
            // Check cache first unless force refresh is requested
            if (!forceRefresh && this.licenseCache.has(guildId)) {
                const cached = this.licenseCache.get(guildId);
                const now = Date.now();
                
                // Return cached result if it's still valid
                if (now - cached.timestamp < this.cacheExpiry) {
                    return cached.data;
                }
            }

            // Make API request to check license status
            const response = await axios.get(`${this.baseUrl}/check`, {
                params: { 
                    guild_id: guildId,
                    password: Config.license.password
                },
                timeout: 10000 // 10 second timeout
            });

            const licenseData = response.data;
            
            // Cache the result
            this.licenseCache.set(guildId, {
                data: licenseData,
                timestamp: Date.now()
            });

            return licenseData;
        } catch (error) {
            this.logger.log('[License Service]', `Error checking license for guild ${guildId}: ${error.message}`, 'error');
            
            // Check if this is a connection refused error and send webhook notification
            if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                await this.sendLicenseServerDownNotification(guildId, error.message);
            }
            
            // Return a default "none" status if API is unreachable
            // This prevents the bot from being completely unusable if license server is down
            return {
                status: 'none',
                error: 'Unable to verify license status'
            };
        }
    }

    /**
     * Activate a license for a specific guild
     * @param {string} guildId - The Discord guild ID
     * @param {string} licenseKey - The license key to activate
     * @returns {Promise<Object>} Activation result
     */
    async activateLicense(guildId, licenseKey) {
        try {
            // Make API request to activate license
            const response = await axios.post(`${this.baseUrl}/activate`, {
                guild_id: guildId,
                key: licenseKey,
                password: Config.license.password
            }, {
                timeout: 15000, // 15 second timeout for activation
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = response.data;
            
            // Clear cache for this guild to force fresh check next time
            this.licenseCache.delete(guildId);
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            this.logger.log('[License Service]', `Error activating license for guild ${guildId}: ${error.message}`, 'error');
            
            // Check if this is a connection refused error and send webhook notification
            if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                await this.sendLicenseServerDownNotification(guildId, error.message);
            }
            
            // Extract error message from API response if available (support both "error" and FastAPI "detail")
            let errorMessage = 'Activation failed';
            if (error.response && error.response.data) {
                const data = error.response.data;
                if (typeof data === 'string') {
                    errorMessage = data;
                } else if (data.error) {
                    errorMessage = data.error;
                } else if (data.detail) {
                    if (typeof data.detail === 'string') {
                        errorMessage = data.detail;
                    } else if (typeof data.detail === 'object') {
                        errorMessage = data.detail.error || data.detail.message || JSON.stringify(data.detail);
                    }
                }
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Check if a guild has a valid (active) license
     * @param {string} guildId - The Discord guild ID
     * @returns {Promise<boolean>} True if license is active, false otherwise
     */
    async isLicenseValid(guildId) {
        const licenseStatus = await this.checkLicense(guildId);
        return licenseStatus.status === 'active';
    }

    /**
     * Check if a license is expiring soon (within 24 hours)
     * @param {string} guildId - The Discord guild ID
     * @returns {Promise<Object>} Object with isExpiringSoon boolean and timeRemaining in hours
     */
    async isLicenseExpiringSoon(guildId) {
        try {
            const licenseStatus = await this.checkLicense(guildId);
            
            if (licenseStatus.status !== 'active' || !licenseStatus.expires_at) {
                return { isExpiringSoon: false, timeRemaining: null };
            }

            const expiryDate = new Date(licenseStatus.expires_at);
            const now = new Date();
            const timeDiff = expiryDate.getTime() - now.getTime();
            const hoursRemaining = Math.floor(timeDiff / (1000 * 60 * 60));
            
            // Consider license expiring soon if less than 24 hours remain
            const isExpiringSoon = hoursRemaining <= 24 && hoursRemaining > 0;
            
            return {
                isExpiringSoon,
                timeRemaining: hoursRemaining,
                expiryDate: licenseStatus.expires_at
            };
        } catch (error) {
            this.logger.log('[License Service]', `Error checking expiration for guild ${guildId}: ${error.message}`, 'error');
            return { isExpiringSoon: false, timeRemaining: null };
        }
    }

    /**
     * Get formatted license status message for Discord
     * @param {string} guildId - The Discord guild ID
     * @param {Function} intlGet - Internationalization function
     * @returns {Promise<string>} Formatted status message
     */
    async getLicenseStatusMessage(guildId, intlGet) {
        const licenseStatus = await this.checkLicense(guildId);
        
        let statusMessage;
        switch (licenseStatus.status) {
            case 'active':
                if (licenseStatus.expires_at) {
                     const expiryDate = new Date(licenseStatus.expires_at);
                     const timestamp = Math.floor(expiryDate.getTime() / 1000);
                     const discordTimestamp = `<t:${timestamp}:f>`;
                     statusMessage = intlGet(guildId, 'licenseStatusActive', { expires_at: discordTimestamp });
                 } else {
                     statusMessage = intlGet(guildId, 'licenseStatusActiveNoExpiry');
                 }
                break;
            case 'expired':
                statusMessage = intlGet(guildId, 'licenseStatusExpired');
                break;
            case 'none':
                statusMessage = intlGet(guildId, 'licenseStatusNone');
                break;
            default:
                statusMessage = intlGet(guildId, 'licenseCheckFailed');
                break;
        }
        
        // Append guild ID to the status message
        return `${statusMessage}\n\n**Guild ID:** \`${guildId}\``;
    }

    /**
     * Get the inactive bot message when license is not valid
     * @param {Function} intlGet - Internationalization function
     * @param {string} guildId - Guild ID for internationalization
     * @returns {string} Inactive bot message
     */
    getInactiveBotMessage(intlGet, guildId) {
        return intlGet(guildId, 'botInactiveMessage');
    }

    /**
     * Setup periodic license checking for all active guilds
     * This runs every 5 minutes to ensure license status is up to date
     */
    setupPeriodicCheck() {
        setInterval(() => {
            // Clear old cache entries to force fresh checks
            const now = Date.now();
            for (const [guildId, cached] of this.licenseCache.entries()) {
                if (now - cached.timestamp >= this.cacheExpiry) {
                    this.licenseCache.delete(guildId);
                }
            }
        }, this.cacheExpiry);
    }

    /**
     * Clear cache for a specific guild (useful after activation/deactivation)
     * @param {string} guildId - The Discord guild ID
     */
    clearCache(guildId) {
        this.licenseCache.delete(guildId);
    }

    /**
     * Clear all cached license data
     */
    clearAllCache() {
        this.licenseCache.clear();
    }

    /**
     * Send webhook notification when license server is down
     * @param {string} guildId - The Discord guild ID
     * @param {string} errorMessage - The error message
     */
    async sendLicenseServerDownNotification(guildId, errorMessage) {
        try {
            // Check if we've already sent a notification for this guild recently
            const now = Date.now();
            const lastNotification = this.webhookNotificationsSent.get(guildId);
            
            if (lastNotification && (now - lastNotification) < this.webhookCooldown) {
                this.logger.log('[License Service]', `Webhook notification for guild ${guildId} skipped due to cooldown`, 'info');
                return;
            }
            
            const webhookUrl = Config.license.webhookUrl;
            const roleId = Config.license.alertRoleId;
            
            const embed = {
                title: '🚨 License Server Down',
                description: `The license server is not accessible for guild \`${guildId}\`.\n\n**Error:** ${errorMessage}`,
                color: 0xFF0000, // Red color
                timestamp: new Date().toISOString(),
                fields: [
                    {
                        name: 'Guild ID',
                        value: guildId,
                        inline: true
                    },
                    {
                        name: 'Error Type',
                        value: 'ECONNREFUSED',
                        inline: true
                    },
                    {
                        name: 'Next Notification',
                        value: `<t:${Math.floor((now + this.webhookCooldown) / 1000)}:R>`,
                        inline: true
                    }
                ]
            };

            const payload = {
                content: `<@&${roleId}>`,
                embeds: [embed]
            };

            await axios.post(webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            // Record the notification timestamp
            this.webhookNotificationsSent.set(guildId, now);
            
            this.logger.log('[License Service]', `Webhook notification sent for guild ${guildId}`,'info');
        } catch (webhookError) {
            this.logger.log('[License Service]', `Failed to send webhook notification: ${webhookError.message}`, 'error');
        }
    }
}

// Export a singleton instance
module.exports = new LicenseService();