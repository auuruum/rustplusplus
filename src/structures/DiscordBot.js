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

const FormatJS = require('@formatjs/intl');
const Discord = require('discord.js');
const Fs = require('fs');
const Path = require('path');

const Battlemetrics = require('../structures/Battlemetrics');
const Cctv = require('./Cctv');
const Config = require('../../config');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordTools = require('../discordTools/discordTools');
const LicenseService = require('../util/licenseService');
const InstanceUtils = require('../util/instanceUtils.js');
const Items = require('./Items');
const Logger = require('./Logger.js');
const PermissionHandler = require('../handlers/permissionHandler.js');
const RustLabs = require('../structures/RustLabs');
const RustPlus = require('../structures/RustPlus');
const WebhookService = require('../util/webhookservice');

class DiscordBot extends Discord.Client {
    constructor(props) {
        super(props);

        this.logger = new Logger(Path.join(__dirname, '..', '..', 'logs/discordBot.log'), 'default');

        this.commands = new Discord.Collection();
        this.fcmListeners = new Object();
        this.fcmListenersLite = new Object();
        this.instances = {};
        this.guildIntl = {};
        this.botIntl = null;
        this.enIntl = null;
        this.enMessages = JSON.parse(Fs.readFileSync(Path.join(__dirname, '..', 'languages', 'en.json')), 'utf8');

        this.rustplusInstances = new Object();
        this.activeRustplusInstances = new Object();
        this.rustplusReconnectTimers = new Object();
        this.rustplusLiteReconnectTimers = new Object();
        this.rustplusReconnecting = new Object();
        this.rustplusMaps = new Object();

        this.uptimeBot = null;

        this.items = new Items();
        this.rustlabs = new RustLabs();
        this.cctv = new Cctv();

        this.pollingIntervalMs = Config.general.pollingIntervalMs;

        this.battlemetricsInstances = new Object();

        this.battlemetricsIntervalId = null;
        this.battlemetricsIntervalCounter = 0;

        this.voiceLeaveTimeouts = new Object();

        // License system initialization
        this.licenseCheckInterval = null;

        this.loadDiscordCommands();
        this.loadDiscordEvents();
        this.loadEnIntl();
        this.loadBotIntl();
        this.setupLicenseChecking();
    }

    loadDiscordCommands() {
        const commandFiles = Fs.readdirSync(Path.join(__dirname, '..', 'commands'))
            .filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(`../commands/${file}`);
            this.commands.set(command.name, command);
        }
    }

    loadDiscordEvents() {
        const eventFiles = Fs.readdirSync(Path.join(__dirname, '..', 'discordEvents'))
            .filter(file => file.endsWith('.js'));
        for (const file of eventFiles) {
            const event = require(`../discordEvents/${file}`);

            if (event.name === 'rateLimited') {
                this.rest.on(event.name, (...args) => event.execute(this, ...args));
            }
            else if (event.once) {
                this.once(event.name, (...args) => event.execute(this, ...args));
            }
            else {
                this.on(event.name, (...args) => event.execute(this, ...args));
            }
        }
    }

    loadEnIntl() {
        const language = 'en';
        const path = Path.join(__dirname, '..', 'languages', `${language}.json`);
        const messages = JSON.parse(Fs.readFileSync(path, 'utf8'));
        const cache = FormatJS.createIntlCache();
        this.enIntl = FormatJS.createIntl({
            locale: language,
            defaultLocale: 'en',
            messages: messages
        }, cache);
    }

    loadBotIntl() {
        const language = Config.general.language;
        const path = Path.join(__dirname, '..', 'languages', `${language}.json`);
        const messages = JSON.parse(Fs.readFileSync(path, 'utf8'));
        const cache = FormatJS.createIntlCache();
        this.botIntl = FormatJS.createIntl({
            locale: language,
            defaultLocale: 'en',
            messages: messages
        }, cache);
    }

    loadGuildIntl(guildId) {
        const instance = InstanceUtils.readInstanceFile(guildId);
        const language = instance.generalSettings.language;
        const path = Path.join(__dirname, '..', 'languages', `${language}.json`);
        const messages = JSON.parse(Fs.readFileSync(path, 'utf8'));
        const cache = FormatJS.createIntlCache();
        this.guildIntl[guildId] = FormatJS.createIntl({
            locale: language,
            defaultLocale: 'en',
            messages: messages
        }, cache);
    }

    loadGuildsIntl() {
        for (const guild of this.guilds.cache) {
            this.loadGuildIntl(guild[0]);
        }
    }

    intlGet(guildId, id, variables = {}) {
        let intl = null;
        if (guildId && guildId !== 'en') {
            // Fallback to botIntl if guild-specific intl is missing (e.g., after guildDelete)
            intl = (this.guildIntl && this.guildIntl[guildId]) ? this.guildIntl[guildId] : this.botIntl;
        }
        else if (guildId === 'en') {
            intl = this.enIntl || this.botIntl;
        }
        else {
            intl = this.botIntl;
        }

        if (!intl) {
            // Absolute fallback to avoid runtime errors
            intl = this.botIntl;
        }

        return intl.formatMessage({
            id: id,
            defaultMessage: this.enMessages[id]
        }, variables);
    }

    build() {
        this.login(Config.discord.token).catch(error => {
            switch (error.code) {
                case 502: {
                    this.log(this.intlGet(null, 'errorCap'),
                        this.intlGet(null, 'badGateway', { error: JSON.stringify(error) }), 'error')
                } break;

                case 503: {
                    this.log(this.intlGet(null, 'errorCap'),
                        this.intlGet(null, 'serviceUnavailable', { error: JSON.stringify(error) }), 'error')
                } break;

                default: {
                    this.log(this.intlGet(null, 'errorCap'), `${JSON.stringify(error)}`, 'error');
                } break;
            }
        });
    }

    log(title, text, level = 'info') {
        this.logger.log(title, text, level);
    }

    logInteraction(interaction, verifyId, type) {
        const channel = DiscordTools.getTextChannelById(interaction.guildId, interaction.channelId);
        const args = new Object();
        args['guild'] = `${interaction.member.guild.name} (${interaction.member.guild.id})`;
        args['channel'] = `${channel.name} (${interaction.channelId})`;
        args['user'] = `${interaction.user.username} (${interaction.user.id})`;
        args[(type === 'slashCommand') ? 'command' : 'customid'] = (type === 'slashCommand') ?
            `${interaction.commandName}` : `${interaction.customId}`;
        args['id'] = `${verifyId}`;

        this.log(this.intlGet(null, 'infoCap'), this.intlGet(null, `${type}Interaction`, args));
    }

    async setupGuild(guild) {
        const instance = this.getInstance(guild.id);
        const firstTime = instance.firstTime;

        await require('../discordTools/RegisterSlashCommands')(this, guild);

        let category = await require('../discordTools/SetupGuildCategory')(this, guild);
        await require('../discordTools/SetupGuildChannels')(this, guild, category);
        if (firstTime) {
            const perms = PermissionHandler.getPermissionsRemoved(this, guild);
            try {
                await category.permissionOverwrites.set(perms);
            }
            catch (e) {
                /* Ignore */
            }
        }
        else {
            await PermissionHandler.resetPermissionsAllChannels(this, guild);
        }

        require('../util/FcmListener')(this, guild);
        const credentials = InstanceUtils.readCredentialsFile(guild.id);
        for (const steamId of Object.keys(credentials)) {
            if (steamId !== credentials.hoster && steamId !== 'hoster') {
                require('../util/FcmListenerLite')(this, guild, steamId);
            }
        }

        await require('../discordTools/SetupSettingsMenu')(this, guild);

        if (firstTime) await PermissionHandler.resetPermissionsAllChannels(this, guild);

        this.resetRustplusVariables(guild.id);
    }

    async syncCredentialsWithUsers(guild) {
        const credentials = InstanceUtils.readCredentialsFile(guild.id);

        const members = await guild.members.fetch();
        const memberIds = [];
        for (const member of members) {
            memberIds.push(member[0]);
        }

        const steamIdRemoveCredentials = [];
        for (const [steamId, content] of Object.entries(credentials)) {
            if (steamId === 'hoster') continue;

            if (!(memberIds.includes(content.discord_user_id))) {
                steamIdRemoveCredentials.push(steamId);
            }
        }

        for (const steamId of steamIdRemoveCredentials) {
            if (steamId === credentials.hoster) {
                if (this.fcmListeners[guild.id]) {
                    this.fcmListeners[guild.id].destroy();
                }
                delete this.fcmListeners[guild.id];
                credentials.hoster = null;
            }
            else {
                if (this.fcmListenersLite[guild.id][steamId]) {
                    this.fcmListenersLite[guild.id][steamId].destroy();
                }
                delete this.fcmListenersLite[guild.id][steamId];
            }

            delete credentials[steamId];
        }

        InstanceUtils.writeCredentialsFile(guild.id, credentials);
    }

    getInstance(guildId) {
        return this.instances[guildId];
    }

    setInstance(guildId, instance) {
        this.instances[guildId] = instance;
        InstanceUtils.writeInstanceFile(guildId, instance);
    }

    readNotificationSettingsTemplate() {
        return JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'templates/notificationSettingsTemplate.json'), 'utf8'));
    }

    readGeneralSettingsTemplate() {
        return JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'templates/generalSettingsTemplate.json'), 'utf8'));
    }

    async createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken) {
        // Check license before creating connection
        const licenseStatus = await LicenseService.checkLicense(guildId);
        if (licenseStatus.status !== 'active') {
            this.log(this.intlGet(guildId, 'licenseInvalidConnectionBlocked'), 'warning');
            return null;
        }

        let rustplus = new RustPlus(guildId, serverIp, appPort, steamId, playerToken);

        /* Add rustplus instance to Object */
        this.rustplusInstances[guildId] = rustplus;
        this.activeRustplusInstances[guildId] = true;

        rustplus.build();

        return rustplus;
    }

    async createRustplusInstancesFromConfig() {
        const files = Fs.readdirSync(Path.join(__dirname, '..', '..', 'instances'));

        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const guildId = file.replace('.json', '');
            const instance = this.getInstance(guildId);
            if (!instance) continue;

            if (instance.activeServer !== null && instance.serverList.hasOwnProperty(instance.activeServer)) {
                await this.createRustplusInstance(
                    guildId,
                    instance.serverList[instance.activeServer].serverIp,
                    instance.serverList[instance.activeServer].appPort,
                    instance.serverList[instance.activeServer].steamId,
                    instance.serverList[instance.activeServer].playerToken);
            }
        }
    }

    resetRustplusVariables(guildId) {
        this.activeRustplusInstances[guildId] = false;
        this.rustplusReconnecting[guildId] = false;
        delete this.rustplusMaps[guildId];

        if (this.rustplusReconnectTimers[guildId]) {
            clearTimeout(this.rustplusReconnectTimers[guildId]);
            this.rustplusReconnectTimers[guildId] = null;
        }
        if (this.rustplusLiteReconnectTimers[guildId]) {
            clearTimeout(this.rustplusLiteReconnectTimers[guildId]);
            this.rustplusLiteReconnectTimers[guildId] = null;
        }
    }

    isJpgImageChanged(guildId, map) {
        return ((JSON.stringify(this.rustplusMaps[guildId])) !== (JSON.stringify(map.jpgImage)));
    }

    findAvailableTrackerId(guildId) {
        const instance = this.getInstance(guildId);

        while (true) {
            const randomNumber = Math.floor(Math.random() * 1000);
            if (!instance.trackers.hasOwnProperty(randomNumber)) {
                return randomNumber;
            }
        }
    }

    createTrackerInstance(guildId, serverId, customId = null) {
        const instance = this.getInstance(guildId);
        const server = instance?.serverList?.[serverId];
        if (!server) return null;
    
        const trackerId = customId || this.findAvailableTrackerId(guildId);
    
        if (instance.trackers.hasOwnProperty(trackerId)) {
            return null;
        }
    
        instance.trackers[trackerId] = {
            name: 'Tracker',
            serverId,
            battlemetricsId: server.battlemetricsId,
            title: server.title ?? 'Untitled',
            img: server.img ?? null,
            clanTag: '',
            trackerId,
            everyone: false,
            inGame: true,
            players: [],
            messageId: null,
            createdAt: Date.now()
        };
    
        this.setInstance(guildId, instance);
        return trackerId;
    }
    

    findAvailableGroupId(guildId, serverId) {
        const instance = this.getInstance(guildId);

        while (true) {
            const randomNumber = Math.floor(Math.random() * 1000);
            if (!instance.serverList[serverId].switchGroups.hasOwnProperty(randomNumber)) {
                return randomNumber;
            }
        }
    }

    /**
     *  Check if Battlemetrics instances are missing/not required/need update.
     */
    async updateBattlemetricsInstances() {
        const activeInstances = [];

        /* Check for instances that are missing or need update. */
        for (const guild of this.guilds.cache) {
            const guildId = guild[0];
            const instance = this.getInstance(guildId);
            const activeServer = instance.activeServer;
            if (activeServer !== null && instance.serverList.hasOwnProperty(activeServer)) {
                if (instance.serverList[activeServer].battlemetricsId !== null) {
                    /* A Battlemetrics ID exist. */
                    const battlemetricsId = instance.serverList[activeServer].battlemetricsId;
                    if (!activeInstances.includes(battlemetricsId)) {
                        activeInstances.push(battlemetricsId);
                        if (this.battlemetricsInstances.hasOwnProperty(battlemetricsId)) {
                            /* Update */
                            await this.battlemetricsInstances[battlemetricsId].evaluation();
                        }
                        else {
                            /* Add */
                            const bmInstance = new Battlemetrics(battlemetricsId);
                            await bmInstance.setup();
                            this.battlemetricsInstances[battlemetricsId] = bmInstance;
                        }
                    }
                }
                else {
                    /* Battlemetrics ID is missing, try with server name. */
                    const name = instance.serverList[activeServer].title;
                    const bmInstance = new Battlemetrics(null, name);
                    await bmInstance.setup();
                    if (bmInstance.lastUpdateSuccessful) {
                        /* Found an Id, is it a new Id? */
                        instance.serverList[activeServer].battlemetricsId = bmInstance.id;
                        this.setInstance(guildId, instance);

                        if (this.battlemetricsInstances.hasOwnProperty(bmInstance.id)) {
                            if (!activeInstances.includes(bmInstance.id)) {
                                activeInstances.push(bmInstance.id);
                                await this.battlemetricsInstances[bmInstance.id].evaluation(bmInstance.data);
                            }
                        }
                        else {
                            activeInstances.push(bmInstance.id);
                            this.battlemetricsInstances[bmInstance.id] = bmInstance;
                        }
                    }
                }
            }

            for (const [trackerId, content] of Object.entries(instance.trackers)) {
                if (!activeInstances.includes(content.battlemetricsId)) {
                    activeInstances.push(content.battlemetricsId);
                    if (this.battlemetricsInstances.hasOwnProperty(content.battlemetricsId)) {
                        /* Update */
                        await this.battlemetricsInstances[content.battlemetricsId].evaluation();
                    }
                    else {
                        /* Add */
                        const bmInstance = new Battlemetrics(content.battlemetricsId);
                        await bmInstance.setup();
                        this.battlemetricsInstances[content.battlemetricsId] = bmInstance;
                    }
                }
            }
        }

        /* Find instances that are no longer required and delete them. */
        const remove = Object.keys(this.battlemetricsInstances).filter(e => !activeInstances.includes(e));
        for (const id of remove) {
            delete this.battlemetricsInstances[id];
        }
    }

    async interactionReply(interaction, content) {
        // Normalize deprecated ephemeral option to flags to avoid warnings
        if (content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, 'ephemeral')) {
            const ephemeral = content.ephemeral === true;
            const flags = content.flags ?? 0;
            const EPHEMERAL_FLAG = (Discord && Discord.MessageFlags && typeof Discord.MessageFlags.Ephemeral === 'number') ? Discord.MessageFlags.Ephemeral : 64;
            const { ephemeral: _omit, ...rest } = content;
            content = ephemeral ? { ...rest, flags: (flags | EPHEMERAL_FLAG) } : rest;
        }
        try {
            return await interaction.reply(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async interactionEditReply(interaction, content) {
        // Normalize deprecated ephemeral option to flags to avoid warnings
        if (content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, 'ephemeral')) {
            const ephemeral = content.ephemeral === true;
            const flags = content.flags ?? 0;
            const EPHEMERAL_FLAG = (Discord && Discord.MessageFlags && typeof Discord.MessageFlags.Ephemeral === 'number') ? Discord.MessageFlags.Ephemeral : 64;
            const { ephemeral: _omit, ...rest } = content;
            content = ephemeral ? { ...rest, flags: (flags | EPHEMERAL_FLAG) } : rest;
        }
        try {
            return await interaction.editReply(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionEditReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async interactionUpdate(interaction, content) {
        // Normalize deprecated ephemeral option to flags to avoid warnings
        if (content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, 'ephemeral')) {
            const ephemeral = content.ephemeral === true;
            const flags = content.flags ?? 0;
            const EPHEMERAL_FLAG = (Discord && Discord.MessageFlags && typeof Discord.MessageFlags.Ephemeral === 'number') ? Discord.MessageFlags.Ephemeral : 64;
            const { ephemeral: _omit, ...rest } = content;
            content = ephemeral ? { ...rest, flags: (flags | EPHEMERAL_FLAG) } : rest;
        }
        try {
            return await interaction.update(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionUpdateFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async interactionDeleteReply(interaction) {
        try {
            return await interaction.deleteReply();
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionDeleteReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async messageEdit(message, content) {
        try {
            return await message.edit(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'messageEditFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async messageSend(channel, content) {
        try {
            return await channel.send(content);
        }
        catch (e) {
            // Downgrade common post-kick errors to warnings to avoid noisy logs
            if (e && (e.code === 50001 || e.code === 50013)) {
                const reason = (e.code === 50001) ? 'Missing Access' : 'Missing Permissions';
                this.log(this.intlGet(null, 'warningCap'), `Skipping message send in channel ${channel?.id || 'unknown'}: ${reason}`);
            } else {
                this.log(this.intlGet(null, 'errorCap'),
                    this.intlGet(null, 'messageSendFailed', { error: e }), 'error');
            }
        }

        return undefined;
    }

    async messageReply(message, content) {
        try {
            return await message.reply(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'messageReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async validatePermissions(interaction) {
        const instance = this.getInstance(interaction.guildId);

        if (instance.blacklist['discordIds'].includes(interaction.user.id) &&
            !interaction.member.permissions.has(Discord.PermissionsBitField.Flags.Administrator)) {
            return false;
        }

        /* If role isn't setup yet, validate as true */
        if (instance.role === null) return true;

        if (!interaction.member.permissions.has(Discord.PermissionsBitField.Flags.Administrator) &&
            !interaction.member.roles.cache.has(instance.role)) {
            let role = DiscordTools.getRole(interaction.guildId, instance.role);
            const str = this.intlGet(interaction.guildId, 'notPartOfRole', { role: role.name });
            await this.interactionReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            this.log(this.intlGet(null, 'warningCap'), str);
            return false;
        }
        return true;
    }

    isAdministrator(interaction) {
        return interaction.member.permissions.has(Discord.PermissionFlagsBits.Administrator);
    }

    /**
     * Setup periodic license checking for all active guilds
     * This ensures license status is checked every 5 minutes
     */
    setupLicenseChecking() {
        // Clear any existing interval
        if (this.licenseCheckInterval) {
            clearInterval(this.licenseCheckInterval);
        }

        // Initialize tracking for expiration warnings to avoid spam
        this.expirationWarningsSent = new Set();

        // Set up periodic license checking every 5 minutes (300,000 ms)
        this.licenseCheckInterval = setInterval(async () => {
            try {
                // Check licenses for all active guilds
                for (const guildId of this.guilds.cache.keys()) {
                    try {
                        // Force refresh license status from API
                        const licenseStatus = await LicenseService.checkLicense(guildId, true);
                        
                        // Handle license status
                        if (licenseStatus.status === 'expired') {
                            await this.handleExpiredLicenseGrace(guildId, licenseStatus);
                            // Remove from warning tracking since license is no longer active
                            this.expirationWarningsSent.delete(guildId);
                        } else if (licenseStatus.status !== 'active') {
                            await this.disconnectFromRustServer(guildId, licenseStatus.status);
                            // Remove from warning tracking since license is no longer active
                            this.expirationWarningsSent.delete(guildId);
                        } else {
                            // Check if license is expiring soon and send warning if needed
                            await this.checkAndSendExpirationWarning(guildId);
                        }
                        
                        this.log(this.intlGet(null, 'infoCap'), 
                            this.intlGet(null, 'licensePeriodicCheckCompleted', { guildId: guildId }));
                    } catch (error) {
                        this.log(this.intlGet(null, 'warningCap'), 
                            this.intlGet(null, 'licensePeriodicCheckFailed', { guildId: guildId, error: error.message }));
                    }
                }
            } catch (error) {
                this.log(this.intlGet(null, 'errorCap'), 
                    `Error during periodic license checking: ${error.message}`, 'error');
            }
        }, 300000); // 5 minutes

        this.log(this.intlGet(null, 'infoCap'), this.intlGet(null, 'licenseSystemInitialized'));
    }

    /**
     * Disconnect from Rust server when license is invalid
     * @param {string} guildId - The Discord guild ID
     * @param {string} licenseStatus - The license status (expired, none, etc.)
     */
    async disconnectFromRustServer(guildId, licenseStatus) {
        try {
            // Check if there's an active RustPlus instance for this guild
            if (this.rustplusInstances[guildId] && this.activeRustplusInstances[guildId]) {
                const rustplus = this.rustplusInstances[guildId];
                const serverId = rustplus.serverId;
                
                // Disconnect from the Rust server
                if (rustplus && rustplus.isConnected) {
                    rustplus.disconnect();
                    this.activeRustplusInstances[guildId] = false;
                    
                    this.log(this.intlGet(null, 'warningCap'), 
                        this.intlGet(null, 'licenseExpiredDisconnected', { 
                            guildId: guildId, 
                            status: licenseStatus 
                        }));
                    
                    // Update Discord server message to reflect disconnection
                    const DiscordMessages = require('../discordTools/discordMessages.js');
                    await DiscordMessages.sendServerMessage(guildId, serverId, 0);
                }
            }
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed to disconnect from Rust server for guild ${guildId}: ${error.message}`, 'error');
        }
    }

    /**
     * Check if a license is expiring soon and send warning message if needed
     * @param {string} guildId - The Discord guild ID to check
     */
    async checkAndSendExpirationWarning(guildId) {
        try {
            // Skip if we've already sent a warning for this guild
            if (this.expirationWarningsSent.has(guildId)) {
                return;
            }

            const expirationInfo = await LicenseService.isLicenseExpiringSoon(guildId);
            
            if (expirationInfo.isExpiringSoon) {
                // Mark that we've sent a warning for this guild
                this.expirationWarningsSent.add(guildId);
                
                // Send warning message to the guild
                await this.sendExpirationWarningMessage(guildId, expirationInfo);
                
                this.log(this.intlGet(null, 'warningCap'), 
                    `License expiration warning sent to guild ${guildId} (${expirationInfo.timeRemaining} hours remaining)`);
            }
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed to check/send expiration warning for guild ${guildId}: ${error.message}`, 'error');
        }
    }

    /**
     * Send license expiration warning message to a guild
     * @param {string} guildId - The Discord guild ID
     * @param {Object} expirationInfo - Expiration information object
     */
    async sendExpirationWarningMessage(guildId, expirationInfo) {
        try {
            const guild = this.guilds.cache.get(guildId);
            if (!guild) {
                this.log(this.intlGet(null, 'warningCap'), 
                    `Cannot send expiration warning: Guild ${guildId} not found`);
                return;
            }

            const instance = this.getInstance(guildId);
            if (!instance || !instance.channelId.general) {
                this.log(this.intlGet(null, 'warningCap'), 
                    `Cannot send expiration warning: No general channel configured for guild ${guildId}`);
                return;
            }

            const channel = guild.channels.cache.get(instance.channelId.general);
            if (!channel) {
                this.log(this.intlGet(null, 'warningCap'), 
                    `Cannot send expiration warning: General channel not found for guild ${guildId}`);
                return;
            }

            // Format expiry date for display
            const expiryDate = new Date(expirationInfo.expiryDate);
            const timestamp = Math.floor(expiryDate.getTime() / 1000);
            const discordTimestamp = `<t:${timestamp}:f>`;

            // Create warning embed
            const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
            const embed = DiscordEmbeds.getActionInfoEmbed(
                1, // Warning color (orange/yellow)
                this.intlGet(guildId, 'licenseExpiringSoonWarning', {
                    hours: expirationInfo.timeRemaining,
                    expires_at: discordTimestamp
                }),
                this.intlGet(guildId, 'licenseExpiringSoonTitle')
            );

            // Add description field
            embed.addFields({
                name: '\u200B', // Invisible character for spacing
                value: this.intlGet(guildId, 'licenseExpiringSoonDescription'),
                inline: false
            });

            await channel.send({ embeds: [embed] });
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed to send expiration warning message to guild ${guildId}: ${error.message}`, 'error');
        }
    }

    /**
     * Manually trigger license check for a specific guild
     * @param {string} guildId - The Discord guild ID to check
     */
    async triggerLicenseCheck(guildId) {
        try {
            // Force refresh license status from API
            const licenseStatus = await LicenseService.checkLicense(guildId, true);
            
            // Handle license status
            if (licenseStatus.status === 'expired') {
                await this.handleExpiredLicenseGrace(guildId, licenseStatus);
                // Remove from warning tracking since license is no longer active
                this.expirationWarningsSent.delete(guildId);
            } else if (licenseStatus.status !== 'active') {
                await this.disconnectFromRustServer(guildId, licenseStatus.status);
                // Remove from warning tracking since license is no longer active
                this.expirationWarningsSent.delete(guildId);
            } else {
                // Check if license is expiring soon and send warning if needed
                await this.checkAndSendExpirationWarning(guildId);
            }
            
            this.log(this.intlGet(null, 'infoCap'), 
                this.intlGet(null, 'licensePeriodicCheckCompleted', { guildId: guildId }));
            
            return licenseStatus;
        } catch (error) {
            this.log(this.intlGet(null, 'warningCap'), 
                this.intlGet(null, 'licensePeriodicCheckFailed', { guildId: guildId, error: error.message }));
            throw error;
        }
    }

    /**
     * Stop periodic license checking (useful for cleanup)
     */
    stopLicenseChecking() {
        if (this.licenseCheckInterval) {
            clearInterval(this.licenseCheckInterval);
            this.licenseCheckInterval = null;
            this.log(this.intlGet(null, 'infoCap'), this.intlGet(null, 'licenseSystemStopped'));
        }
        
        // Clear expiration warnings tracking
        if (this.expirationWarningsSent) {
            this.expirationWarningsSent.clear();
        }
    }
}

module.exports = DiscordBot;

    DiscordBot.prototype.handleExpiredLicenseGrace = async function(guildId, licenseStatus) {
        try {
            // Always ensure we are disconnected from Rust server for expired licenses
            await this.disconnectFromRustServer(guildId, 'expired');

            const instance = this.getInstance(guildId);
            if (!instance || !instance.generalSettings) return;

            const gs = instance.generalSettings;
            // Initialize timestamps/flags if missing
            if (!gs.licenseExpiredTimestamp) {
                gs.licenseExpiredTimestamp = Date.now();
                gs.licenseGraceFinalNoticeSent = false;
                gs.licenseGraceWarningLastSent = null;
                this.setInstance(guildId, instance);

                // Send webhook about license expiration (only once per expiration event)
                try { await WebhookService.sendLicenseExpired(guildId, licenseStatus?.expires_at); } catch (_) { /* ignore */ }
            }

            const now = Date.now();
            const expiredAtMs = (licenseStatus && licenseStatus.expires_at) ? (new Date(licenseStatus.expires_at)).getTime() : gs.licenseExpiredTimestamp;
            const graceStartMs = gs.licenseExpiredTimestamp || expiredAtMs || now;
            const msSince = now - graceStartMs;
            const daysElapsed = Math.floor(msSince / (1000 * 60 * 60 * 24));
            const daysRemaining = Math.max(0, 14 - daysElapsed);

            // If grace period ended, perform cleanup
            if (msSince >= 14 * 24 * 60 * 60 * 1000) {
                await this.performGraceCleanup(guildId, graceStartMs);
                return;
            }

            // Send initial grace notice once
            const oneDayMs = 24 * 60 * 60 * 1000;
            if (!gs.licenseGraceWarningLastSent) {
                await this.sendGraceNoticeMessage(guildId, daysRemaining, graceStartMs);
                gs.licenseGraceWarningLastSent = now;
                this.setInstance(guildId, instance);
                return;
            }

            // Send final notice once within the last 24 hours before cleanup
            const cleanupAtMs = graceStartMs + 14 * oneDayMs;
            const isWithinLastDay = (cleanupAtMs - now) <= oneDayMs;
            if (isWithinLastDay && !gs.licenseGraceFinalNoticeSent) {
                await this.sendFinalGraceNoticeMessage(guildId, cleanupAtMs);
                gs.licenseGraceFinalNoticeSent = true;
                gs.licenseGraceWarningLastSent = now;
                this.setInstance(guildId, instance);
            }
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed grace-period handling for guild ${guildId}: ${error.message}`, 'error');
        }
    }

    DiscordBot.prototype.sendGraceNoticeMessage = async function(guildId, daysRemaining, graceStartMs) {
        try {
            const guild = this.guilds.cache.get(guildId);
            if (!guild) return;

            const instance = this.getInstance(guildId);
            if (!instance || !instance.channelId.general) return;

            const channel = guild.channels.cache.get(instance.channelId.general);
            if (!channel) return;

            const expiredAtTs = Math.floor((graceStartMs) / 1000);
            const expiredAtDiscord = `<t:${expiredAtTs}:f>`;

            const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
            const embed = DiscordEmbeds.getActionInfoEmbed(
                1,
                this.intlGet(guildId, 'licenseExpiredGraceNotice', {
                    expired_at: expiredAtDiscord,
                    days_remaining: daysRemaining
                })
            );

            await channel.send({ embeds: [embed] });
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed to send grace notice to guild ${guildId}: ${error.message}`, 'error');
        }
    }

    DiscordBot.prototype.sendFinalGraceNoticeMessage = async function(guildId, cleanupAtMs) {
        try {
            const guild = this.guilds.cache.get(guildId);
            if (!guild) return;

            const instance = this.getInstance(guildId);
            if (!instance || !instance.channelId.general) return;

            const channel = guild.channels.cache.get(instance.channelId.general);
            if (!channel) return;

            const cleanupTs = Math.floor((cleanupAtMs) / 1000);
            const cleanupDiscord = `<t:${cleanupTs}:f>`;

            const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
            const embed = DiscordEmbeds.getActionInfoEmbed(
                1,
                this.intlGet(guildId, 'licenseExpiredFinalNotice', {
                    cleanup_at: cleanupDiscord
                })
            );

            await channel.send({ embeds: [embed] });
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed to send final grace notice to guild ${guildId}: ${error.message}`, 'error');
        }
    }

    DiscordBot.prototype.performGraceCleanup = async function(guildId, graceStartMs) {
        try {
            const guild = this.guilds.cache.get(guildId);
            if (!guild) return;

            const instance = this.getInstance(guildId);
            const generalId = instance?.channelId?.general;
            if (generalId) {
                try {
                    const channel = guild.channels.cache.get(generalId);
                    if (channel) {
                        const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
                        const embed = DiscordEmbeds.getActionInfoEmbed(1, this.intlGet(guildId, 'licenseExpiredCleanupLeave'));
                        await channel.send({ embeds: [embed] });
                    }
                } catch (_) { /* ignore */ }
            }

            // Remove channels
            const RemoveGuildChannels = require('../discordTools/RemoveGuildChannels.js');
            await RemoveGuildChannels(this, guild);

            // Attempt to leave guild
            try { await guild.leave(); } catch (_) { /* ignore */ }
        } catch (error) {
            this.log(this.intlGet(null, 'errorCap'), 
                `Failed grace-period cleanup for guild ${guildId}: ${error.message}`, 'error');
        }
    }
