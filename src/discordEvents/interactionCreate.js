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

const Discord = require('discord.js');

const DiscordEmbeds = require('../discordTools/discordEmbeds');
const LicenseService = require('../util/licenseService');

module.exports = {
    name: 'interactionCreate',
    async execute(client, interaction) {
        const instance = client.getInstance(interaction.guildId);

        /* Check so that the interaction comes from valid channels */
        if (!Object.values(instance.channelId).includes(interaction.channelId) && !interaction.isCommand) {
            client.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'interactionInvalidChannel'))
            if (interaction.isButton()) {
                try {
                    interaction.deferUpdate();
                }
                catch (e) {
                    client.log(client.intlGet(null, 'errorCap'),
                        client.intlGet(null, 'couldNotDeferInteraction'), 'error');
                }
            }
        }

        /* License checking for all interactions except license commands */
        const shouldCheckLicense = interaction.type === Discord.InteractionType.ApplicationCommand ? 
            interaction.commandName !== 'license' : true;
            
        if (shouldCheckLicense) {
            try {
                const licenseStatus = await LicenseService.checkLicense(interaction.guildId);
                
                if (licenseStatus.status !== 'active') {
                    /* License is not active - send inactive bot message */
                    const inactiveEmbed = DiscordEmbeds.getBotInactiveEmbed(interaction.guildId);
                    
                    if (interaction.isButton() || interaction.isStringSelectMenu()) {
                        await interaction.reply({
                            embeds: [inactiveEmbed],
                            ephemeral: true
                        });
                    } else if (interaction.type === Discord.InteractionType.ModalSubmit) {
                        await interaction.reply({
                            embeds: [inactiveEmbed],
                            ephemeral: true
                        });
                    } else {
                        await interaction.reply({
                            embeds: [inactiveEmbed],
                            ephemeral: true
                        });
                    }
                    
                    client.log(client.intlGet(null, 'warningCap'), 
                        `Interaction ${interaction.customId || interaction.commandName} blocked due to invalid license for guild ${interaction.guildId}`);
                    return;
                }
            } catch (licenseError) {
                client.log(client.intlGet(null, 'errorCap'), 
                    `License check failed for guild ${interaction.guildId}: ${licenseError.message}`, 'error');
                
                /* If license check fails, send inactive message as fallback */
                const inactiveEmbed = DiscordEmbeds.getBotInactiveEmbed(interaction.guildId);
                
                if (interaction.isButton() || interaction.isStringSelectMenu()) {
                    await interaction.reply({
                        embeds: [inactiveEmbed],
                        ephemeral: true
                    });
                } else if (interaction.type === Discord.InteractionType.ModalSubmit) {
                    await interaction.reply({
                        embeds: [inactiveEmbed],
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        embeds: [inactiveEmbed],
                        ephemeral: true
                    });
                }
                return;
            }
        }

        if (interaction.isButton()) {
            require('../handlers/buttonHandler')(client, interaction);
        }
        else if (interaction.isStringSelectMenu()) {
            require('../handlers/selectMenuHandler')(client, interaction);
        }
        else if (interaction.type === Discord.InteractionType.ApplicationCommand) {
            const command = interaction.client.commands.get(interaction.commandName);

            /* If the command doesn't exist, return */
            if (!command) return;

            try {
                await command.execute(client, interaction);
            }
            catch (e) {
                client.log(client.intlGet(null, 'errorCap'), e, 'error');

                const str = client.intlGet(interaction.guildId, 'errorExecutingCommand');
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                client.log(client.intlGet(null, 'errorCap'), str, 'error');
            }
        }
        else if (interaction.type === Discord.InteractionType.ModalSubmit) {
            require('../handlers/modalHandler')(client, interaction);
        }
        else {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'unknownInteraction'), 'error');

            if (interaction.isButton()) {
                try {
                    interaction.deferUpdate();
                }
                catch (e) {
                    client.log(client.intlGet(null, 'errorCap'),
                        client.intlGet(null, 'couldNotDeferInteraction'), 'error');
                }
            }
        }
    },
};