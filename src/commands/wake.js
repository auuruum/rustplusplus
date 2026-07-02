const Builder = require('@discordjs/builders');

const Config = require('../../config');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const RustWakeFcmClient = require('../util/rustWakeFcmClient.js');
const RustWakeStore = require('../util/rustWakeStore.js');

module.exports = {
    name: 'wake',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('wake')
            .setDescription('Rust Wake phone alarms')
            .addSubcommand(subcommand => subcommand
                .setName('token')
                .setDescription('Link this Discord user to a Rust Wake Android FCM token')
                .addStringOption(option => option
                    .setName('value')
                    .setDescription('FCM token copied from the Rust Wake Android app')
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('device')
                    .setDescription('Optional device name')
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('test')
                .setDescription('Send a test wake alarm to your linked phone')
                .addStringOption(option => option
                    .setName('base')
                    .setDescription('Base name')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('grid')
                    .setDescription('Map grid')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('server')
                    .setDescription('Server name')
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('trigger')
                    .setDescription('Alarm source')
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('status')
                .setDescription('Show Rust Wake link/config status'))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription('Remove your linked Rust Wake device'));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'token': await tokenHandler(client, interaction); break;
            case 'test': await testHandler(client, interaction); break;
            case 'status': await statusHandler(client, interaction); break;
            case 'remove': await removeHandler(client, interaction); break;
            default: break;
        }
    },
};

function getFcmClient() {
    return new RustWakeFcmClient(Config.rustWake.fcmServiceAccount);
}

async function tokenHandler(client, interaction) {
    const token = interaction.options.getString('value').trim();
    const deviceName = interaction.options.getString('device') || 'Rust Wake Android';

    if (token.length < 80 || !token.includes(':')) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake',
                color: 0xC0392B,
                description: 'This does not look like an FCM token. Copy it from the Rust Wake Android app.'
            })]
        });
        return;
    }

    RustWakeStore.saveDevice(interaction.guildId, interaction.user.id, token, deviceName);
    await interaction.editReply({
        embeds: [DiscordEmbeds.getEmbed({
            title: 'Rust Wake linked',
            color: 0x2ECC71,
            description: `Device saved: **${escapeMarkdown(deviceName)}**\nRun \`/wake test\` to send a test alarm.`
        })]
    });
}

async function testHandler(client, interaction) {
    const fcm = getFcmClient();
    if (!Config.rustWake.enabled) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake disabled',
                color: 0xC0392B,
                description: 'Set `RPP_RUST_WAKE_ENABLED=true` in `.env`.'
            })]
        });
        return;
    }

    if (!fcm.isConfigured()) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake FCM not configured',
                color: 0xC0392B,
                description: 'Set `RPP_RUST_WAKE_FCM_SERVICE_ACCOUNT=/absolute/path/to/firebase-adminsdk.json` in `.env`.'
            })]
        });
        return;
    }

    const device = RustWakeStore.getDevice(interaction.guildId, interaction.user.id);
    if (!device) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'No Rust Wake device linked',
                color: 0xC0392B,
                description: 'Copy the FCM token from the Android app and run `/wake token value:<token>` first.'
            })]
        });
        return;
    }

    const alert = {
        title: 'RAID WAKE',
        base: interaction.options.getString('base') || 'Main Base',
        grid: interaction.options.getString('grid') || 'H12',
        server: interaction.options.getString('server') || 'EU Monthly',
        trigger: interaction.options.getString('trigger') || 'Seismic Sensor',
    };

    try {
        const result = await fcm.sendAlert(device.token, alert);
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake test sent',
                color: 0x2ECC71,
                description: `FCM accepted the message.\n\`${result.name || 'sent'}\``
            })]
        });
    }
    catch (e) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake test failed',
                color: 0xC0392B,
                description: truncate(`\`${e.message}\``)
            })]
        });
    }
}

async function statusHandler(client, interaction) {
    const device = RustWakeStore.getDevice(interaction.guildId, interaction.user.id);
    const fcm = getFcmClient();
    await interaction.editReply({
        embeds: [DiscordEmbeds.getEmbed({
            title: 'Rust Wake status',
            color: Config.rustWake.enabled && fcm.isConfigured() && device ? 0x2ECC71 : 0xF1C40F,
            description: [
                `Enabled: **${Config.rustWake.enabled ? 'yes' : 'no'}**`,
                `FCM service account: **${fcm.isConfigured() ? 'configured' : 'missing'}**`,
                `Linked device: **${device ? escapeMarkdown(device.deviceName) : 'none'}**`,
                `Device store: \`${RustWakeStore.STORE_PATH}\``
            ].join('\n')
        })]
    });
}

async function removeHandler(client, interaction) {
    const existed = RustWakeStore.removeDevice(interaction.guildId, interaction.user.id);
    await interaction.editReply({
        embeds: [DiscordEmbeds.getEmbed({
            title: 'Rust Wake',
            color: existed ? 0x2ECC71 : 0xF1C40F,
            description: existed ? 'Your linked device was removed.' : 'No linked device was found.'
        })]
    });
}

function truncate(str, max = 3900) {
    return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

function escapeMarkdown(str) {
    return String(str).replace(/([*_`~|])/g, '\\$1');
}
