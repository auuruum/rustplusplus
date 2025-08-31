/*
    Webhook Service utility for sending Discord webhook notifications
*/

const axios = require('axios');
const Config = require('../../config');
const Path = require('path');
const Logger = require('../structures/Logger');

class WebhookService {
    constructor() {
        this.webhookUrl = Config.license?.webhookUrl || '';
        this.alertRoleId = Config.license?.alertRoleId || '';
        this.logger = new Logger(Path.join(__dirname, '..', '..', 'logs/webhookService.log'), 'default');
    }

    hasWebhook() {
        return typeof this.webhookUrl === 'string' && this.webhookUrl.length > 0;
    }

    async send(payload) {
        if (!this.hasWebhook()) {
            this.logger.log('[Webhook Service]', 'No webhook URL configured, skipping notification', 'info');
            return void 0;
        }
        try {
            await axios.post(this.webhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000,
            });
            this.logger.log('[Webhook Service]', 'Webhook POST succeeded', 'info');
        } catch (err) {
            this.logger.log('[Webhook Service]', `Failed to send webhook: ${err.message}`, 'error');
        }
    }

    roleMention() {
        return this.alertRoleId ? `<@&${this.alertRoleId}>` : undefined;
    }

    // Guild joined
    async sendGuildJoined(guild) {
        const embed = {
            title: '✅ Bot Joined Guild',
            description: `The bot has joined a new guild.`,
            color: 0x3BA55D,
            timestamp: new Date().toISOString(),
            fields: [
                { name: 'Guild Name', value: guild?.name ? `${guild.name}` : 'Unknown', inline: true },
                { name: 'Guild ID', value: `${guild?.id || 'unknown'}`, inline: true },
            ],
        };
        const payload = {
            content: this.roleMention() || undefined,
            embeds: [embed],
        };
        await this.send(payload);
    }

    // Guild left
    async sendGuildLeft(guild) {
        const embed = {
            title: '⚠️ Bot Left Guild',
            description: `The bot has been removed from a guild or left due to inactivity.`,
            color: 0xED4245,
            timestamp: new Date().toISOString(),
            fields: [
                { name: 'Guild Name', value: guild?.name ? `${guild.name}` : 'Unknown', inline: true },
                { name: 'Guild ID', value: `${guild?.id || 'unknown'}`, inline: true },
            ],
        };
        const payload = {
            content: this.roleMention() || undefined,
            embeds: [embed],
        };
        await this.send(payload);
    }

    // License activated
    async sendLicenseActivated(guildId, expiresAt) {
        let expiryFieldValue = 'Unknown';
        if (expiresAt) {
            try {
                const expiryDate = new Date(expiresAt);
                const ts = Math.floor(expiryDate.getTime() / 1000);
                expiryFieldValue = `<t:${ts}:f>`;
            } catch (_) { /* ignore */ }
        }
        const embed = {
            title: '🔓 License Activated',
            description: 'A license has been activated for a guild.',
            color: 0x57F287,
            timestamp: new Date().toISOString(),
            fields: [
                { name: 'Guild ID', value: `${guildId}`, inline: true },
                { name: 'Expires At', value: `${expiryFieldValue}`, inline: true },
            ],
        };
        const payload = {
            content: this.roleMention() || undefined,
            embeds: [embed],
        };
        await this.send(payload);
    }

    // License expired
    async sendLicenseExpired(guildId, expiresAt) {
        let expiryFieldValue = 'Unknown';
        if (expiresAt) {
            try {
                const expiryDate = new Date(expiresAt);
                const ts = Math.floor(expiryDate.getTime() / 1000);
                expiryFieldValue = `<t:${ts}:f>`;
            } catch (_) { /* ignore */ }
        }
        const embed = {
            title: '⛔ License Expired',
            description: 'A guild license has expired. Grace period handling may apply.',
            color: 0xED4245,
            timestamp: new Date().toISOString(),
            fields: [
                { name: 'Guild ID', value: `${guildId}`, inline: true },
                { name: 'Expired At', value: `${expiryFieldValue}`, inline: true },
            ],
        };
        const payload = {
            content: this.roleMention() || undefined,
            embeds: [embed],
        };
        await this.send(payload);
    }
}

module.exports = new WebhookService();