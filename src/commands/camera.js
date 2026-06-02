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

const Builder = require('@discordjs/builders');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');

module.exports = {
    name: 'camera',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('camera')
            .setDescription(client.intlGet(guildId, 'commandsCameraDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('add')
                .setDescription(client.intlGet(guildId, 'commandsCameraAddDesc'))
                .addStringOption(option => option
                    .setName('identifier')
                    .setDescription(client.intlGet(guildId, 'commandsCameraIdentifierDesc'))
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('name')
                    .setDescription(client.intlGet(guildId, 'commandsCameraNameDesc'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription(client.intlGet(guildId, 'commandsCameraRemoveDesc'))
                .addStringOption(option => option
                    .setName('identifier')
                    .setDescription(client.intlGet(guildId, 'commandsCameraIdentifierDesc'))
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('list')
                .setDescription(client.intlGet(guildId, 'commandsCameraListDesc')));
    },

    async execute(client, interaction) {
        const instance = client.getInstance(interaction.guildId);
        const rustplus = client.rustplusInstances[interaction.guildId];

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        if (!rustplus || (rustplus && !rustplus.isOperational)) {
            const str = client.intlGet(interaction.guildId, 'notConnectedToRustServer');
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            client.log(client.intlGet(null, 'warningCap'), str);
            return;
        }

        const serverId = rustplus.serverId;
        const server = instance.serverList[serverId];
        if (!server) {
            const str = client.intlGet(interaction.guildId, 'activeRustServerNotFound');
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            client.log(client.intlGet(null, 'warningCap'), str);
            return;
        }
        if (!server.cameras) {
            server.cameras = {};
            client.setInstance(interaction.guildId, instance);
        }

        switch (interaction.options.getSubcommand()) {
            case 'add': {
                const identifier = interaction.options.getString('identifier');
                const name = interaction.options.getString('name') || identifier;

                if (!identifier || identifier.trim() === '') {
                    const str = client.intlGet(interaction.guildId, 'cameraIdentifierEmpty');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    return;
                }

                if (server.cameras.hasOwnProperty(identifier)) {
                    const str = client.intlGet(interaction.guildId, 'cameraAlreadyExists', {
                        identifier: identifier
                    });
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                    return;
                }

                server.cameras[identifier] = {
                    identifier: identifier,
                    name: name,
                    reachable: true,
                    frame: 0,
                    messageId: null,
                    notifyInGame: false,
                    notifyDiscord: false,
                    mode: 'slow',
                    refreshRequested: true
                };
                client.setInstance(interaction.guildId, instance);

                const CameraHandler = require('../handlers/cameraHandler.js');
                if (!rustplus.cameraCyclingActive) {
                    CameraHandler.startCycling(rustplus, client);
                }

                const str = client.intlGet(interaction.guildId, 'cameraAdded', {
                    name: name,
                    identifier: identifier
                });
                const status = rustplus.team ? rustplus.team.getPlayer(rustplus.playerId) : null;
                const message = status && status.isOnline
                    ? `${str}\n${client.intlGet(interaction.guildId, 'cameraMonitoringRequiresInactivePlayer')}`
                    : str;
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, message,
                    server.title));
                rustplus.log(client.intlGet(interaction.guildId, 'infoCap'), str);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `add, ${identifier}`
                }));
            } break;

            case 'remove': {
                const identifier = interaction.options.getString('identifier');

                if (!server.cameras.hasOwnProperty(identifier)) {
                    const str = client.intlGet(interaction.guildId, 'cameraDoesNotExist', {
                        identifier: identifier
                    });
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                    return;
                }

                const CameraHandler = require('../handlers/cameraHandler.js');
                await CameraHandler.deleteCameraArtifacts(client, interaction.guildId, serverId, identifier);

                delete server.cameras[identifier];
                client.setInstance(interaction.guildId, instance);

                if (Object.keys(server.cameras).length === 0) {
                    CameraHandler.stopCycling(rustplus);
                }

                const str = client.intlGet(interaction.guildId, 'cameraRemoved', {
                    identifier: identifier
                });
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str,
                    server.title));
                rustplus.log(client.intlGet(interaction.guildId, 'infoCap'), str);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `remove, ${identifier}`
                }));
            } break;

            case 'list': {
                const cameras = server.cameras;
                const cameraKeys = Object.keys(cameras);

                if (cameraKeys.length === 0) {
                    const str = client.intlGet(interaction.guildId, 'cameraListEmpty');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    return;
                }

                const fields = [];
                for (const identifier of cameraKeys) {
                    const camera = cameras[identifier];
                    const statusEmoji = camera.reachable
                        ? Constants.ONLINE_EMOJI : Constants.NOT_FOUND_EMOJI;
                    fields.push({
                        name: `${statusEmoji} ${camera.name}`,
                        value: `\`${identifier}\``,
                        inline: true
                    });
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `list`
                }));

                await client.interactionEditReply(interaction, {
                    embeds: [DiscordEmbeds.getEmbed({
                        color: Constants.COLOR_DEFAULT,
                        title: client.intlGet(interaction.guildId, 'cameraListTitle'),
                        footer: { text: server.title },
                        fields: fields
                    })],
                    ephemeral: true
                });
            } break;

            default: {
            } break;
        }
    },
};
