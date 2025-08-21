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

module.exports = {
    name: 'guildCreate',
    async execute(client, guild) {
        require('../util/CreateInstanceFile')(client, guild);
        require('../util/CreateCredentialsFile')(client, guild);
        client.fcmListenersLite[guild.id] = new Object();

        client.loadGuildIntl(guild.id);

        await client.setupGuild(guild);

        // After setting up, inform users about 1-hour activation requirement
        try {
            const instance = client.getInstance(guild.id);
            const infoChannelId = instance.channelId.information || instance.channelId.commands;
            const channel = guild.channels.cache.get(infoChannelId);
            if (channel) {
                const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
                const sent = await client.messageSend(
                    channel,
                    DiscordEmbeds.getActionInfoEmbed(
                        1,
                        client.intlGet(guild.id, 'licenseActivationWarning1h'),
                        client.intlGet(guild.id, 'licenseActivationRequiredTitle')
                    )
                );
                if (sent && sent.id) {
                    const inst = client.getInstance(guild.id);
                    inst.generalSettings.licenseActivationWarningMessageId = sent.id;
                    client.setInstance(guild.id, inst);
                }
            }
        } catch (e) { /* ignore */ }

        // Schedule 1-hour check for license activation
        const ONE_MINUTE = 60 * 1000; // 60 seconds × 1000 ms
        const ONE_HOUR = 60 * ONE_MINUTE; // 60 minutes
        if (!client.guildActivationTimeouts) client.guildActivationTimeouts = {};
        client.guildActivationTimeouts[guild.id] = setTimeout(async () => {
            try {
                const LicenseService = require('../util/licenseService');
                const status = await LicenseService.checkLicense(guild.id, true);

                // If active now, nothing to do
                if (status.status === 'active') return;

                // If license existed before and just expired, respect 2-week grace and do not leave/remove files
                if (status.status === 'expired') {
                    // Keep data and channels for 2 weeks, do nothing here
                    return;
                }

                // Otherwise, no license within 1h of join: cleanup and leave server
                try {
                    await require('../discordTools/RemoveGuildChannels')(client, guild);
                } catch (_) { /* ignore */ }

                const InstanceUtils = require('../util/instanceUtils');
                try { InstanceUtils.deleteInstanceFile(guild.id); } catch (_) {}
                try { InstanceUtils.deleteCredentialsFile(guild.id); } catch (_) {}

                // Inform server and then leave
                try {
                    const instance = client.getInstance(guild.id);
                    const infoChannelId = instance?.channelId?.information || instance?.channelId?.commands;
                    const channel = infoChannelId ? guild.channels.cache.get(infoChannelId) : null;
                    if (channel && channel.viewable && channel.permissionsFor(guild.members.me)?.has('SendMessages')) {
                        await client.messageSend(channel, client.intlGet(guild.id, 'licenseActivationTimeoutLeave'));
                    }
                } catch (_) { /* ignore */ }

                // Finally, leave the guild
                try { await guild.leave(); } catch (_) { /* ignore */ }
            } catch (err) {
                // Swallow errors to avoid crashing
            } finally {
                // Clear the stored timeout reference when it fires
                if (client.guildActivationTimeouts && client.guildActivationTimeouts[guild.id]) {
                    delete client.guildActivationTimeouts[guild.id];
                }
            }
        }, ONE_HOUR);
    },
}