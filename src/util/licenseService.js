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

/**
 * License Service - Handles all license-related operations
 * This service manages license checking and activation for Discord guilds
 */
class LicenseService {
    constructor() {
        // Base URL for the license server API
        this.baseUrl = 'http://127.0.0.1:8000';
        
        // Cache to store license status to avoid excessive API calls
        this.licenseCache = new Map();
        
        // Cache expiry time in milliseconds (5 minutes)
        this.cacheExpiry = 5 * 60 * 1000;
        
        // Set up periodic license checking every 5 minutes
        this.setupPeriodicCheck();
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
                params: { guild_id: guildId },
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
            console.error(`[License Service] Error checking license for guild ${guildId}:`, error.message);
            
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
                key: licenseKey
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
            console.error(`[License Service] Error activating license for guild ${guildId}:`, error.message);
            
            // Extract error message from API response if available
            let errorMessage = 'Activation failed';
            if (error.response && error.response.data && error.response.data.error) {
                errorMessage = error.response.data.error;
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
     * Get formatted license status message for Discord
     * @param {string} guildId - The Discord guild ID
     * @param {Function} intlGet - Internationalization function
     * @returns {Promise<string>} Formatted status message
     */
    async getLicenseStatusMessage(guildId, intlGet) {
        const licenseStatus = await this.checkLicense(guildId);
        
        switch (licenseStatus.status) {
            case 'active':
                if (licenseStatus.expires_at) {
                     const expiryDate = new Date(licenseStatus.expires_at);
                     const timestamp = Math.floor(expiryDate.getTime() / 1000);
                     return intlGet(guildId, 'licenseStatusActive', { expires_at: `<t:${timestamp}:f>` });
                 } else {
                     return intlGet(guildId, 'licenseStatusActiveNoExpiry');
                 }
            case 'expired':
                return intlGet(guildId, 'licenseStatusExpired');
            case 'none':
                return intlGet(guildId, 'licenseStatusNone');
            default:
                return intlGet(guildId, 'licenseCheckFailed');
        }
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
}

// Export a singleton instance
module.exports = new LicenseService();