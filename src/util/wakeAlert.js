const Discord = require('discord.js');

const Client = require('../../index.ts');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordTools = require('../discordTools/discordTools.js');

const CALLMEBOT_URL = 'http://api.callmebot.com/start.php';
const CALLMEBOT_TEXT_URL = 'https://api.callmebot.com/text.php';
const DEFAULT_REPEAT_SECONDS = 75;
const DEFAULT_MAX_CALLS = 3;

function getWakeProfiles(instance) {
    if (!instance.wakeProfiles) instance.wakeProfiles = {};
    return instance.wakeProfiles;
}

function getEnabledProfiles(instance) {
    return Object.entries(getWakeProfiles(instance))
        .filter(([, profile]) => profile.enabled && profile.callmebotTelegramUser)
        .map(([discordUserId, profile]) => ({ discordUserId, profile }));
}

function buildUrl(telegramUser, text, mode = 'call') {
    const url = new URL(mode === 'message' ? CALLMEBOT_TEXT_URL : CALLMEBOT_URL);
    url.searchParams.set('user', telegramUser);
    url.searchParams.set('text', text.slice(0, 256));

    if (mode === 'call') {
        url.searchParams.set('lang', 'en-GB-Standard-B');
        url.searchParams.set('rpt', '3');
        url.searchParams.set('cc', 'yes');
    }

    return url;
}

function cleanResponse(text, maxLength = 1500) {
    const cleaned = `${text}`.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function classifyResponse(text, mode = 'call') {
    const cleaned = cleanResponse(text);
    const lower = cleaned.toLowerCase();

    if ((lower.includes('authorization for user') && lower.includes('is not received')) ||
        lower.includes('permission denied') || lower.includes('you need to authorize callmebot') ||
        lower.includes('click here to authenticate')) {
        return {
            ok: false,
            status: 'not_authorized',
            title: 'CallMeBot not authorized',
            description: 'Telegram account is not authorized for CallMeBot calls yet.',
            hint: 'Open https://api2.callmebot.com/txt/auth.php and authorize this Telegram username, then run /wake test again.'
        };
    }

    if (lower.includes('two calls to the same user') || lower.includes('within 65 seconds is not allowed')) {
        return {
            ok: false,
            status: 'rate_limited',
            title: 'CallMeBot rate limit',
            description: 'CallMeBot blocks repeated calls to the same user within 65 seconds.',
            hint: 'Wait about 65 seconds before testing again. Bot raid repeats now use a safer 75 second interval.'
        };
    }

    if (lower.includes('call rejected by user')) {
        return {
            ok: true,
            status: 'rejected',
            title: 'Telegram call reached you',
            description: 'CallMeBot started the Telegram call, but it was rejected by the user/device.',
            hint: 'Wake call delivery works. For real raids, do not reject the call.'
        };
    }

    if (lower.includes('queued') || lower.includes('calling') || lower.includes('call queued') ||
        lower.includes('call is being processed') || lower.includes('starting telegram audio call') ||
        lower.includes('script started') || lower.includes('autorization ok') ||
        lower.includes('authorization ok') || lower.includes('message sent') ||
        lower.includes('message queued') || lower.includes('telegram message sent') ||
        lower.includes('status: successful')) {
        const isMessage = mode === 'message';
        return {
            ok: true,
            status: isMessage ? 'sent' : 'queued',
            title: isMessage ? 'Telegram message sent' : 'CallMeBot call queued',
            description: isMessage ? 'CallMeBot sent the test Telegram message.' :
                'Test call was accepted by CallMeBot.',
            hint: isMessage ? 'Use /wake test mode:call to verify real wake calls.' :
                'If phone did not ring, check Telegram username and CallMeBot authorization.'
        };
    }

    return {
        ok: false,
        status: 'unknown',
        title: 'CallMeBot response unclear',
        description: cleaned || 'Empty response from CallMeBot.',
        hint: 'Raw response logged in bot logs.'
    };
}

function getAckButton(alertId) {
    return new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder()
            .setCustomId(`WakeAck${JSON.stringify({ alertId })}`)
            .setLabel('ACK RAID')
            .setStyle(Discord.ButtonStyle.Danger)
    );
}

async function callProfile(profile, alertText, mode = 'call') {
    const url = buildUrl(profile.callmebotTelegramUser, alertText, mode);
    Client.client.log(Client.client.intlGet(null, 'infoCap'),
        `CallMeBot ${mode} request: ${profile.callmebotTelegramUser} ${url.origin}${url.pathname}`);
    const response = await fetch(url);
    const text = await response.text();
    const parsed = classifyResponse(text, mode);
    Client.client.log(Client.client.intlGet(null, 'infoCap'),
        `CallMeBot ${mode} response for ${profile.callmebotTelegramUser}: ${parsed.status}. ` +
        `Raw: ${cleanResponse(text, 700)}`);
    return text;
}

async function sendWakeDm(guildId, discordUserId, alarmName, alertText, alertId) {
    const user = await DiscordTools.getUserById(guildId, discordUserId);
    if (!user) return;

    await Client.client.messageSend(user, {
        embeds: [DiscordEmbeds.getEmbed({
            color: 0xff0000,
            title: 'RAID WAKE ALERT',
            description: `${alarmName}\n${alertText}`
        })]
    });
}

async function sendWakeActivityMessage(guildId, serverId, alarmName, count, alertId) {
    const instance = Client.client.getInstance(guildId);
    const text = `Wake calls started for ${count} profile(s): ${alarmName}`;

    await DiscordMessages.sendMessage(guildId, {
        embeds: [DiscordEmbeds.getEmbed({
            color: 0xff0000,
            title: 'Wake alert started',
            description: text,
            footer: { text: serverId }
        })],
        components: [getAckButton(alertId)]
    }, null, instance.channelId.activity);
}

async function runCallRound(guildId, alertId) {
    const alert = Client.client.activeWakeAlerts[alertId];
    if (!alert || alert.acked) return;

    alert.callsMade += 1;
    const results = [];

    for (const target of alert.targets) {
        try {
            const result = await callProfile(target.profile, alert.text, 'call');
            results.push(`${target.profile.callmebotTelegramUser}: ${cleanResponse(result, 500)}`);
        }
        catch (error) {
            results.push(`${target.profile.callmebotTelegramUser}: ${error.message}`);
        }
    }

    Client.client.log(Client.client.intlGet(null, 'infoCap'),
        `Wake alert ${alertId} call round ${alert.callsMade}: ${results.join(' | ')}`);

    if (alert.callsMade >= alert.maxCalls) {
        delete Client.client.activeWakeAlerts[alertId];
        return;
    }

    alert.timer = setTimeout(runCallRound, alert.repeatSeconds * 1000, guildId, alertId);
}

module.exports = {
    ensureInstance(instance) {
        getWakeProfiles(instance);
        if (!instance.wakeSettings) {
            instance.wakeSettings = {
                repeatSeconds: DEFAULT_REPEAT_SECONDS,
                maxCalls: DEFAULT_MAX_CALLS
            };
        }
        if (!instance.wakeSettings.repeatSeconds) instance.wakeSettings.repeatSeconds = DEFAULT_REPEAT_SECONDS;
        if (instance.wakeSettings.repeatSeconds < 75) instance.wakeSettings.repeatSeconds = DEFAULT_REPEAT_SECONDS;
        if (!instance.wakeSettings.maxCalls) instance.wakeSettings.maxCalls = DEFAULT_MAX_CALLS;
    },

    setProfile(client, guildId, discordUserId, telegramUser, enabled = true) {
        const instance = client.getInstance(guildId);
        this.ensureInstance(instance);

        instance.wakeProfiles[discordUserId] = {
            enabled,
            callmebotTelegramUser: telegramUser,
            updatedAt: Date.now()
        };
        client.setInstance(guildId, instance);
        return instance.wakeProfiles[discordUserId];
    },

    setProfileEnabled(client, guildId, discordUserId, enabled) {
        const instance = client.getInstance(guildId);
        this.ensureInstance(instance);

        if (!instance.wakeProfiles[discordUserId]) return null;
        instance.wakeProfiles[discordUserId].enabled = enabled;
        instance.wakeProfiles[discordUserId].updatedAt = Date.now();
        client.setInstance(guildId, instance);
        return instance.wakeProfiles[discordUserId];
    },

    removeProfile(client, guildId, discordUserId) {
        const instance = client.getInstance(guildId);
        this.ensureInstance(instance);
        delete instance.wakeProfiles[discordUserId];
        client.setInstance(guildId, instance);
    },

    async testProfile(profile, message, mode = 'message') {
        return await callProfile(profile, message, mode);
    },

    cleanResponse,
    classifyResponse,

    async trigger(guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        this.ensureInstance(instance);

        const server = instance.serverList[serverId];
        if (!server || !server.alarms[entityId]) return;

        const targets = getEnabledProfiles(instance);
        if (targets.length === 0) return;

        const alarm = server.alarms[entityId];
        const grid = alarm.location ? ` (${alarm.location})` : '';
        const alertText = `RAID ALERT: ${alarm.name}${grid}. ${alarm.message}. Server: ${server.title}`;
        const alertId = `${Date.now().toString(36)}${Math.floor(Math.random() * 100000).toString(36)}`;

        Client.client.activeWakeAlerts[alertId] = {
            guildId,
            serverId,
            entityId,
            text: alertText,
            targets,
            callsMade: 0,
            maxCalls: instance.wakeSettings.maxCalls,
            repeatSeconds: instance.wakeSettings.repeatSeconds,
            acked: false,
            timer: null
        };

        await sendWakeActivityMessage(guildId, serverId, alarm.name, targets.length, alertId);
        for (const target of targets) {
            await sendWakeDm(guildId, target.discordUserId, alarm.name, alertText, alertId);
        }
        await runCallRound(guildId, alertId);
    },

    async ack(client, interaction, alertId) {
        const alert = client.activeWakeAlerts[alertId];
        if (!alert) {
            await interaction.reply({ content: 'Wake alert already stopped.', ephemeral: true });
            return;
        }

        alert.acked = true;
        if (alert.timer) clearTimeout(alert.timer);
        delete client.activeWakeAlerts[alertId];

        await interaction.reply({ content: `Wake alert acknowledged by ${interaction.user.username}.`, ephemeral: false });
    },

    formatProfiles(client, guildId) {
        const instance = client.getInstance(guildId);
        this.ensureInstance(instance);
        const rows = Object.entries(instance.wakeProfiles);
        if (rows.length === 0) return 'No wake profiles configured.';

        return rows.map(([discordUserId, profile]) => {
            const state = profile.enabled ? 'enabled' : 'disabled';
            return `<@${discordUserId}>: ${state}, ${profile.callmebotTelegramUser}`;
        }).join('\n');
    }
};
