/*
    Copyright (C) 2025

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
const Crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const Config = require('../../config');
const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');

module.exports = {
    name: 'streamdeck',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('streamdeck')
            .setDescription('View Stream Deck API information for this server');
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        if (Config.discord.needAdminPrivileges && !client.isAdministrator(interaction)) {
            const str = client.intlGet(interaction.guildId, 'missingPermission');
            await client.interactionReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            client.log(client.intlGet(null, 'warningCap'), str);
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const guildId = interaction.guildId;
            const instance = client.getInstance(guildId);

            if (!instance.generalSettings) instance.generalSettings = {};

            // Ensure apiPassword exists (backfill for legacy instances)
            if (!instance.generalSettings.apiPassword) {
                instance.generalSettings.apiPassword = Crypto.randomBytes(16).toString('hex');
                client.setInstance(guildId, instance);
            }

            // Compute API base URL
            let host = process.env.RPP_API_HOST;
            
            // If no custom host is set, try to get public IP
            if (!host) {
                try {
                    const https = require('https');
                    const publicIpResponse = await new Promise((resolve, reject) => {
                        const req = https.get('https://api.ipify.org', (res) => {
                            let data = '';
                            res.on('data', (chunk) => data += chunk);
                            res.on('end', () => resolve(data.trim()));
                        });
                        req.on('error', reject);
                        req.setTimeout(5000, () => {
                            req.destroy();
                            reject(new Error('Timeout'));
                        });
                    });
                    host = `http://${publicIpResponse}`;
                } catch (error) {
                    // Fallback to localhost if public IP detection fails
                    host = 'http://localhost';
                }
            } else if (!host.startsWith('http://') && !host.startsWith('https://')) {
                host = 'http://' + host;
            }
            
            const port = process.env.RPP_API_PORT || 8074;
            const baseUrl = `${host.replace(/\/+$/, '')}:${port}`;

            const embed = DiscordEmbeds.getEmbed({
                title: 'RustPlusPlus API',
                color: Constants.COLOR_DEFAULT,
                fields: [
                    { name: 'Guild ID', value: '`' + guildId + '`', inline: false },
                    { name: 'Base URL', value: '`' + baseUrl + '/' + guildId + '`', inline: false },
                    { name: 'API Password', value: '`' + instance.generalSettings.apiPassword + '`', inline: false }
                ],
                timestamp: true
            });

            // Create button for rust-deck GitHub repository
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Rust Deck GitHub')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://github.com/auuruum/rust-deck')
                );

            await client.interactionEditReply(interaction, { embeds: [embed], components: [row] });

            client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                id: `${verifyId}`,
                value: 'streamdeck'
            }));
        } catch (e) {
            const str = 'Failed to show Stream Deck API information.';
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            client.log(client.intlGet(null, 'errorCap'), `${str} Error: ${e.message}`, 'error');
        }
    },
};