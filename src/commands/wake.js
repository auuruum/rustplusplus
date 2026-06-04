const Builder = require('@discordjs/builders');

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const WakeAlert = require('../util/wakeAlert.js');

module.exports = {
    name: 'wake',

    getData() {
        return new Builder.SlashCommandBuilder()
            .setName('wake')
            .setDescription('Configure CallMeBot Telegram wake calls.')
            .addSubcommand(subcommand => subcommand
                .setName('setup')
                .setDescription('Set your CallMeBot Telegram username.')
                .addStringOption(option => option
                    .setName('telegram')
                    .setDescription('Telegram username, for example @example')
                    .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('test')
                .setDescription('Send yourself a test CallMeBot Telegram message or call.')
                .addStringOption(option => option
                    .setName('mode')
                    .setDescription('Test mode')
                    .setRequired(false)
                    .addChoices(
                        { name: 'message', value: 'message' },
                        { name: 'call', value: 'call' })))
            .addSubcommand(subcommand => subcommand
                .setName('enable')
                .setDescription('Enable your wake calls.'))
            .addSubcommand(subcommand => subcommand
                .setName('disable')
                .setDescription('Disable your wake calls.'))
            .addSubcommand(subcommand => subcommand
                .setName('sleep')
                .setDescription('Arm wake calls because you are sleeping IRL.'))
            .addSubcommand(subcommand => subcommand
                .setName('awake')
                .setDescription('Disarm wake calls because you are awake IRL.'))
            .addSubcommand(subcommand => subcommand
                .setName('status')
                .setDescription('Show your wake status.'))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription('Remove your wake profile.'))
            .addSubcommand(subcommand => subcommand
                .setName('list')
                .setDescription('List wake profiles.'));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${subcommand}`
        }));

        switch (subcommand) {
            case 'setup': {
                let telegramUser = interaction.options.getString('telegram').trim();
                if (!telegramUser.startsWith('@') && !telegramUser.startsWith('+')) {
                    telegramUser = `@${telegramUser}`;
                }

                const profile = WakeAlert.setProfile(client, guildId, userId, telegramUser, true);
                client.log(client.intlGet(null, 'infoCap'),
                    `Wake profile saved for ${interaction.user.username} (${userId}): ${telegramUser}`);
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    0, `Wake profile saved: ${profile.callmebotTelegramUser}. Run /wake test to verify CallMeBot auth.`));
            } break;

            case 'test': {
                const instance = client.getInstance(guildId);
                WakeAlert.ensureInstance(instance);
                const profile = instance.wakeProfiles[userId];
                if (!profile) {
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                        1, 'No wake profile. Run /wake setup first.'));
                    return;
                }

                const mode = interaction.options.getString('mode') || 'message';
                const result = await WakeAlert.testProfile(profile, 'RAID ALERT TEST. Wake up.', mode);
                const parsed = WakeAlert.classifyResponse(result, mode);
                await client.interactionEditReply(interaction, {
                    embeds: [DiscordEmbeds.getEmbed({
                        color: parsed.ok ? 0x00ff00 : 0xff0000,
                        title: parsed.title,
                        description: parsed.description,
                        fields: [
                            { name: 'Telegram', value: `\`${profile.callmebotTelegramUser}\``, inline: true },
                            { name: 'Mode', value: `\`${mode}\``, inline: true },
                            { name: 'Status', value: `\`${parsed.status}\``, inline: true },
                            { name: 'Next step', value: parsed.hint, inline: false }
                        ]
                    })],
                    ephemeral: true
                });
            } break;

            case 'enable': {
                const profile = WakeAlert.setProfileEnabled(client, guildId, userId, true);
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    profile ? 0 : 1, profile ? 'Wake calls enabled.' : 'No wake profile. Run /wake setup first.'));
            } break;

            case 'disable': {
                const profile = WakeAlert.setProfileEnabled(client, guildId, userId, false);
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    profile ? 0 : 1, profile ? 'Wake calls disabled.' : 'No wake profile. Run /wake setup first.'));
            } break;

            case 'sleep': {
                const profile = WakeAlert.setProfileSleeping(client, guildId, userId, true);
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    profile ? 0 : 1, profile ? 'IRL sleep mode ON. Wake calls armed.' :
                        'No wake profile. Run /wake setup first.'));
            } break;

            case 'awake': {
                const profile = WakeAlert.setProfileSleeping(client, guildId, userId, false);
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    profile ? 0 : 1, profile ? 'IRL sleep mode OFF. Wake calls disarmed.' :
                        'No wake profile. Run /wake setup first.'));
            } break;

            case 'status': {
                const instance = client.getInstance(guildId);
                WakeAlert.ensureInstance(instance);
                const profile = instance.wakeProfiles[userId];
                const description = profile ?
                    `Wake calls: ${profile.enabled ? 'enabled' : 'disabled'}\n` +
                    `IRL status: ${profile.sleeping ? 'sleeping' : 'awake'}\n` +
                    `Telegram: ${profile.callmebotTelegramUser}` :
                    'No wake profile. Run /wake setup first.';
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    profile ? 0 : 1, description));
            } break;

            case 'remove': {
                WakeAlert.removeProfile(client, guildId, userId);
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(
                    0, 'Wake profile removed.'));
            } break;

            case 'list': {
                await client.interactionEditReply(interaction, {
                    embeds: [DiscordEmbeds.getEmbed({
                        color: 0x00b0f4,
                        title: 'Wake profiles',
                        description: WakeAlert.formatProfiles(client, guildId)
                    })]
                });
            } break;

            default: {
            } break;
        }
    }
};
