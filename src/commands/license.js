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
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const LicenseService = require('../util/licenseService.js');

module.exports = {
    name: 'license',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('license')
            .setDescription('License management commands')
            .addSubcommand(subcommand => subcommand
                .setName('activate')
                .setDescription('Activate a license key for this server')
                .addStringOption(option => option
                    .setName('key')
                    .setDescription('The license key to activate')
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('status')
                .setDescription('Check the current license status for this server'));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        // Note: We don't use validatePermissions here for license commands
        // because if the license is invalid, the bot should still respond
        // to allow users to activate their license
        
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        try {
            switch (subcommand) {
                case 'activate': {
                    await handleActivateCommand(client, interaction, guildId, verifyId);
                } break;

                case 'status': {
                    await handleStatusCommand(client, interaction, guildId, verifyId);
                } break;

                default: {
                    const errorMsg = 'Unknown license subcommand';
                    await client.interactionEditReply(interaction, 
                        DiscordEmbeds.getActionInfoEmbed(1, errorMsg));
                } break;
            }
        } catch (error) {
            client.log(client.intlGet(null, 'errorCap'), 
                `License command error: ${error.message}`, 'error');
            
            const errorMsg = 'An error occurred while processing the license command';
            await client.interactionEditReply(interaction, 
                DiscordEmbeds.getActionInfoEmbed(1, errorMsg));
        }

        // Log the command execution
        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${subcommand} ${interaction.options.getString('key') || ''}`
        }));
    },
};

/**
 * Handle the license activate subcommand
 * @param {Object} client - The Discord client
 * @param {Object} interaction - The Discord interaction
 * @param {string} guildId - The guild ID
 * @param {number} verifyId - The verification ID for logging
 */
async function handleActivateCommand(client, interaction, guildId, verifyId) {
    const licenseKey = interaction.options.getString('key');
    
    if (!licenseKey || licenseKey.trim().length === 0) {
        const errorMsg = '❌ Please provide a valid license key';
        await client.interactionEditReply(interaction, 
            DiscordEmbeds.getActionInfoEmbed(1, errorMsg));
        return;
    }

    // Show a "processing" message since activation might take a moment
    await client.interactionEditReply(interaction, 
        DiscordEmbeds.getActionInfoEmbed(0, '🔄 Activating license, please wait...'));

    try {
        // Check if guild already has an active license (for stacking detection)
        const currentLicense = await LicenseService.checkLicense(guildId);
        const isStacking = currentLicense.status === 'active';
        
        // Attempt to activate the license
        const result = await LicenseService.activateLicense(guildId, licenseKey.trim());
        
        if (result.success) {
            // Trigger periodic license check to update connection status immediately
            try {
                await client.triggerLicenseCheck(guildId);
            } catch (checkError) {
                client.log(client.intlGet(null, 'warningCap'), 
                    `Failed to trigger license check after activation: ${checkError.message}`);
            }
            
            let successMsg;
            
            // Add expiry information if available
            if (result.data && result.data.expires_at) {
                const expiryDate = new Date(result.data.expires_at);
                const timestamp = Math.floor(expiryDate.getTime() / 1000);
                const discordTimestamp = `<t:${timestamp}:f>`;
                
                // Use different message for stacking vs new activation
                if (isStacking) {
                    successMsg = client.intlGet(interaction.guildId, 'licenseStacked', { expires_at: discordTimestamp });
                } else {
                    successMsg = client.intlGet(interaction.guildId, 'licenseActivated', { expires_at: discordTimestamp });
                }
            } else {
                successMsg = client.intlGet(guildId, 'licenseActivated', { expires_at: 'indefinite' });
            }
            
            await client.interactionEditReply(interaction, 
                DiscordEmbeds.getActionInfoEmbed(0, successMsg));
            
            const logAction = isStacking ? 'stacked' : 'activated';
            client.log(client.intlGet(null, 'infoCap'), 
                `License ${logAction} for guild ${guildId} by ${interaction.user.username}`);
        } else {
            const errorMsg = client.intlGet(guildId, 'licenseActivationFailed', { error: result.error || 'Unknown error' });
            await client.interactionEditReply(interaction, 
                DiscordEmbeds.getActionInfoEmbed(1, errorMsg));
            
            client.log(client.intlGet(null, 'warningCap'), 
                `License activation failed for guild ${guildId}: ${result.error}`);
        }
    } catch (error) {
        const errorMsg = `❌ Activation failed: ${error.message}`;
        await client.interactionEditReply(interaction, 
            DiscordEmbeds.getActionInfoEmbed(1, errorMsg));
        
        client.log(client.intlGet(null, 'errorCap'), 
            `License activation error for guild ${guildId}: ${error.message}`, 'error');
    }
}

/**
 * Handle the license status subcommand
 * @param {Object} client - The Discord client
 * @param {Object} interaction - The Discord interaction
 * @param {string} guildId - The guild ID
 * @param {number} verifyId - The verification ID for logging
 */
async function handleStatusCommand(client, interaction, guildId, verifyId) {
    try {
        // Trigger periodic license check to ensure current status
        try {
            await client.triggerLicenseCheck(guildId);
        } catch (checkError) {
            client.log(client.intlGet(null, 'warningCap'), 
                `Failed to trigger license check during status command: ${checkError.message}`);
        }
        
        // Get the current license status
        const licenseStatus = await LicenseService.checkLicense(guildId);
        const statusMessage = await LicenseService.getLicenseStatusMessage(
            guildId, 
            (guildId, key, vars) => client.intlGet(guildId, key, vars)
        );
        
        // Determine embed color based on license status
        const embedType = (licenseStatus.status === 'active') ? 0 : 1;
        
        await client.interactionEditReply(interaction, 
            DiscordEmbeds.getActionInfoEmbed(embedType, statusMessage));
        
        client.log(client.intlGet(null, 'infoCap'), 
            `License status checked for guild ${guildId} by ${interaction.user.username}`);
    } catch (error) {
        const errorMsg = '❌ Unable to check license status';
        await client.interactionEditReply(interaction, 
            DiscordEmbeds.getActionInfoEmbed(1, errorMsg));
        
        client.log(client.intlGet(null, 'errorCap'), 
            `License status check error for guild ${guildId}: ${error.message}`, 'error');
    }
}