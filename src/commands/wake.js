const Builder = require('@discordjs/builders');

const Config = require('../../config');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const RustWakeFcmClient = require('../util/rustWakeFcmClient.js');
const RustWakeFirestore = require('../util/rustWakeFirestore.js');
const RustWakeStore = require('../util/rustWakeStore.js');

module.exports = {
    name: 'wake',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('wake')
            .setDescription('Rust Wake phone alarms')
            .addSubcommand(subcommand => subcommand
                .setName('link')
                .setDescription('Create a short link code for the Rust Wake Android app'))
            .addSubcommand(subcommand => subcommand
                .setName('check')
                .setDescription('Finish linking after entering the code in the Android app'))
            .addSubcommand(subcommand => subcommand
                .setName('token')
                .setDescription('Manual fallback: link this Discord user to an FCM token')
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
            case 'link': await linkHandler(client, interaction); break;
            case 'check': await checkHandler(client, interaction); break;
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

function getFirestore() {
    return new RustWakeFirestore(Config.rustWake.fcmServiceAccount, Config.rustWake.firestoreCollection);
}

async function linkHandler(client, interaction) {
    const firestore = getFirestore();
    if (!Config.rustWake.enabled || !firestore.isConfigured()) {
        await interaction.editReply({ embeds: [configErrorEmbed()] });
        return;
    }

    const session = RustWakeStore.createLinkCode(interaction.guildId, interaction.user.id);
    try {
        await firestore.createLinkSession(session);
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake link code',
                color: 0x2ECC71,
                description: [
                    'Open **Rust Wake** on Android and enter this code:',
                    '',
                    `# ${formatCode(session.code)}`,
                    '',
                    'Then run:',
                    '`/wake check`',
                    '',
                    'Expires in **10 minutes**.'
                ].join('\n')
            })]
        });
    }
    catch (e) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake link failed',
                color: 0xC0392B,
                description: truncate(`Could not create Firestore link session.\n\`${e.message}\``)
            })]
        });
    }
}

async function checkHandler(client, interaction) {
    const firestore = getFirestore();
    if (!Config.rustWake.enabled || !firestore.isConfigured()) {
        await interaction.editReply({ embeds: [configErrorEmbed()] });
        return;
    }

    const session = RustWakeStore.getActiveLinkCode(interaction.guildId, interaction.user.id);
    if (!session) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'No active Rust Wake link',
                color: 0xF1C40F,
                description: 'Run `/wake link`, enter the new code in the Android app, then run `/wake check`.'
            })]
        });
        return;
    }

    const code = session.code;
    try {
        const doc = await firestore.getLinkSession(code);
        if (doc.guildId !== interaction.guildId || doc.userId !== interaction.user.id) {
            throw new Error('The active link session does not belong to this Discord user. Run /wake link again.');
        }
        if (!doc.fcmToken) {
            await interaction.editReply({
                embeds: [DiscordEmbeds.getEmbed({
                    title: 'Rust Wake not linked yet',
                    color: 0xF1C40F,
                    description: 'Open the Android app, enter the code, press **Link device**, then run this command again.'
                })]
            });
            return;
        }

        const device = RustWakeStore.consumeLinkCode(code, doc.fcmToken, doc.deviceName || 'Rust Wake Android');
        if (!device) {
            await interaction.editReply({
                embeds: [DiscordEmbeds.getEmbed({
                    title: 'Rust Wake code expired',
                    color: 0xC0392B,
                    description: 'Run `/wake link` again and enter the new code in the app.'
                })]
            });
            return;
        }

        await firestore.deleteLinkSession(code).catch(() => null);
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake linked',
                color: 0x2ECC71,
                description: `Device saved: **${escapeMarkdown(device.deviceName)}**\nRun \`/wake test\` to send a test alarm.`
            })]
        });
    }
    catch (e) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'Rust Wake check failed',
                color: 0xC0392B,
                description: truncate(`\`${e.message}\``)
            })]
        });
    }
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
    if (!Config.rustWake.enabled || !fcm.isConfigured()) {
        await interaction.editReply({ embeds: [configErrorEmbed()] });
        return;
    }

    const device = RustWakeStore.getDevice(interaction.guildId, interaction.user.id);
    if (!device) {
        await interaction.editReply({
            embeds: [DiscordEmbeds.getEmbed({
                title: 'No Rust Wake device linked',
                color: 0xC0392B,
                description: 'Run `/wake link`, enter the code in Rust Wake Android, then run `/wake check`.'
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
                `Firebase service account: **${fcm.isConfigured() ? 'configured' : 'missing'}**`,
                `Firestore collection: \`${Config.rustWake.firestoreCollection}\``,
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

function configErrorEmbed() {
    return DiscordEmbeds.getEmbed({
        title: 'Rust Wake not configured',
        color: 0xC0392B,
        description: [
            'Set these in `.env`:',
            '`RPP_RUST_WAKE_ENABLED=true`',
            '`RPP_RUST_WAKE_FCM_SERVICE_ACCOUNT=/absolute/path/to/firebase-adminsdk.json`',
            '`RPP_RUST_WAKE_FIRESTORE_COLLECTION=rustWakeLinks`'
        ].join('\n')
    });
}

function formatCode(code) {
    return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function truncate(str, max = 3900) {
    return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

function escapeMarkdown(str) {
    return String(str).replace(/([*_`~|])/g, '\\$1');
}
