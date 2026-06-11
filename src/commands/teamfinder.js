/*
    Copyright (C) 2026 FaiThiX

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

    https://github.com/faithix/rustplusplus

*/

const Builder = require('@discordjs/builders');
const Discord = require('discord.js');
const Jimp = require('jimp');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const Scrape = require('../util/scrape.js');
const TeamDetectorBridge = require('../util/teamDetectorBridge.js');
const TrackerInputParser = require('../util/trackerInputParser.js');

module.exports = {
    name: 'teamfinder',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('teamfinder')
            .setDescription(client.intlGet(guildId, 'commandsTeamfinderDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('discover')
                .setDescription(client.intlGet(guildId, 'commandsTeamfinderDiscoverDesc'))
                .addStringOption(option => option
                    .setName('seed')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderSeedDesc'))
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('battlemetricsid')
                    .setDescription(client.intlGet(guildId, 'commandsPlayersBattlemetricsIdDesc'))
                    .setRequired(false))
                .addBooleanOption(option => option
                    .setName('comments')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderCommentsDesc'))
                    .setRequired(false))
                .addIntegerOption(option => option
                    .setName('commentpages')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderCommentPagesDesc'))
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(5))
                .addIntegerOption(option => option
                    .setName('maxprofiles')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderMaxProfilesDesc'))
                    .setRequired(false)
                    .setMinValue(5)
                    .setMaxValue(250))
                .addIntegerOption(option => option
                    .setName('minscore')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderMinScoreDesc'))
                    .setRequired(false)
                    .setMinValue(0)
                    .setMaxValue(20))
                .addIntegerOption(option => option
                    .setName('depth')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderDepthDesc'))
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(8))
                .addNumberOption(option => option
                    .setName('delay')
                    .setDescription(client.intlGet(guildId, 'commandsTeamfinderDelayDesc'))
                    .setRequired(false)
                    .setMinValue(0)
                    .setMaxValue(10)));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'discover': await discoverHandler(client, interaction); break;
            default: break;
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${interaction.options.getSubcommand()} ` +
                `${interaction.options.getString('seed')} ` +
                `${interaction.options.getString('battlemetricsid')} `
        }));
    },
};

async function discoverHandler(client, interaction) {
    const guildId = interaction.guildId;
    const battlemetricsId = await getBattlemetricsId(client, interaction);
    if (!battlemetricsId) return;

    const seedSteamId = await resolveSeedSteamId(client, interaction);
    if (!seedSteamId) return;

    const options = {
        battlemetricsId: battlemetricsId,
        steamIds: [seedSteamId],
        comments: interaction.options.getBoolean('comments') ?? false,
        commentPages: interaction.options.getInteger('commentpages') ?? 1,
        maxProfiles: interaction.options.getInteger('maxprofiles') ?? 75,
        minScore: interaction.options.getInteger('minscore') ?? 4,
        recursiveDepth: interaction.options.getInteger('depth') ?? 5,
        requestDelay: interaction.options.getNumber('delay') ?? 0,
        includeNetwork: false
    };

    try {
        const result = await TeamDetectorBridge.runAutoDiscovery(options);
        const embed = buildResultEmbed(client, guildId, result);
        const reply = {
            embeds: [embed]
        };

        const graphImage = await buildConnectionGraphImage(result);
        if (graphImage) {
            embed.setImage('attachment://teamfinder_graph.png');
            reply.files = [new Discord.AttachmentBuilder(graphImage, { name: 'teamfinder_graph.png' })];
        }

        await client.interactionEditReply(interaction, reply);
    }
    catch (e) {
        const str = client.intlGet(guildId, 'teamfinderRunFailed', { error: e.message });
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, truncate(str, 3900)));
        client.log(client.intlGet(null, 'errorCap'), str, 'error');
    }
}

async function getBattlemetricsId(client, interaction) {
    const providedBattlemetricsId = interaction.options.getString('battlemetricsid');
    if (providedBattlemetricsId) return providedBattlemetricsId;

    const guildId = interaction.guildId;
    const rustplus = client.rustplusInstances[guildId];
    if (!rustplus || (rustplus && !rustplus.isOperational)) {
        const str = client.intlGet(guildId, 'notConnectedToRustServer');
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        client.log(client.intlGet(null, 'warningCap'), str);
        return null;
    }

    const instance = client.getInstance(guildId);
    const server = instance.serverList[rustplus.serverId];
    if (!server || (server && !server.battlemetricsId)) {
        const str = client.intlGet(guildId, 'invalidBattlemetricsId');
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        client.log(client.intlGet(null, 'warningCap'), str);
        return null;
    }

    return server.battlemetricsId;
}

async function resolveSeedSteamId(client, interaction) {
    const guildId = interaction.guildId;
    const seed = interaction.options.getString('seed');
    const parsed = TrackerInputParser.parseTrackerPlayerInput(seed);

    if (parsed.valid && parsed.type === 'steamId') return parsed.value;

    if (parsed.valid && parsed.type === 'steamVanityUrl') {
        const steamId = await Scrape.scrapeSteamIdFromVanity(client, parsed.value);
        if (steamId) return steamId;
    }

    const str = client.intlGet(guildId, 'teamfinderInvalidSeed');
    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
    client.log(client.intlGet(null, 'warningCap'), str);
    return null;
}

function buildResultEmbed(client, guildId, result) {
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const nonSeedCandidates = candidates.filter(candidate => !candidate.seed);
    const shownCandidates = (nonSeedCandidates.length > 0 ? nonSeedCandidates : candidates).slice(0, 10);
    const overflow = Math.max(0, (nonSeedCandidates.length > 0 ? nonSeedCandidates.length : candidates.length) -
        shownCandidates.length);

    let description = client.intlGet(guildId, 'teamfinderResultSummary', {
        inspected: result.inspected_profiles ? result.inspected_profiles.length : 0,
        total: candidates.length,
        server: result.server_id
    });
    if (shownCandidates.length > 0) {
        description += '\nConnection graph attached as image.';
    }

    if (shownCandidates.length === 0) {
        description += `\n\n${client.intlGet(guildId, 'teamfinderNoCandidates')}`;
    }
    else if (overflow > 0) {
        description += `\n${client.intlGet(guildId, 'andMorePlayers', { number: overflow })}`;
    }

    const embed = DiscordEmbeds.getEmbed({
        title: client.intlGet(guildId, 'teamfinderResultTitle'),
        color: Constants.COLOR_DEFAULT,
        description: truncate(description, 4096)
    });

    if (shownCandidates.length > 0) {
        embed.addFields(shownCandidates.map(candidate => buildCandidateField(candidate)));
    }

    return embed;
}

function buildCandidateField(candidate) {
    const name = escapeMarkdown(candidate.name || 'Unknown');
    const status = candidate.online ? Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI;
    const statusText = candidate.online ? 'Online now' : 'Not online now';
    const fieldName = truncate(`${status} ${name} | score ${candidate.score}`, 256);

    const steamValue = candidate.steam_id && candidate.profile_url ?
        `[${candidate.steam_id}](${candidate.profile_url})` :
        (candidate.steam_id || 'Unknown');
    const sources = formatSources(candidate.sources);
    const evidence = formatEvidence(candidate);

    return {
        name: fieldName,
        value: truncate(`Steam: ${steamValue}\nStatus: ${statusText}\nEvidence: ${evidence}\nSource: ${sources}`, 1024),
        inline: false
    };
}

function formatSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return 'none';
    return sources.map(source => {
        if (source === 'friends') return 'friend list';
        if (source === 'comments') return 'profile comments';
        return source;
    }).join(', ');
}

function formatEvidence(candidate) {
    const connectionNames = Array.isArray(candidate.connection_profile_names) ?
        candidate.connection_profile_names.slice(0, 4).map(escapeMarkdown) : [];

    if (connectionNames.length === 0) {
        if (candidate.online) return 'Name matched current BattleMetrics online list.';
        return 'Matched discovery score threshold.';
    }

    const suffix = candidate.connection_profile_names.length > connectionNames.length ?
        ` and ${candidate.connection_profile_names.length - connectionNames.length} more` : '';
    return `Friend/comment connection with ${connectionNames.join(', ')}${suffix}.`;
}

async function buildConnectionGraphImage(result) {
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const nonSeedCandidates = candidates.filter(candidate => !candidate.seed);
    const shownCandidates = (nonSeedCandidates.length > 0 ? nonSeedCandidates : candidates).slice(0, 10);
    if (shownCandidates.length === 0) return null;

    const connectionNames = [];
    for (const candidate of shownCandidates) {
        if (!Array.isArray(candidate.connection_profile_names)) continue;
        for (const name of candidate.connection_profile_names) {
            if (!connectionNames.includes(name)) connectionNames.push(name);
        }
    }
    if (connectionNames.length === 0) connectionNames.push('Seed profile');

    const width = 1100;
    const rowHeight = 88;
    const height = Math.max(520, 140 + Math.max(shownCandidates.length, connectionNames.length) * rowHeight);
    const image = await new Jimp(width, height, color('#232428'));
    const titleFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    image.print(titleFont, 42, 30, 'Team Finder Connection Map');
    image.print(font, 42, 78,
        `Server ${result.server_id} | inspected ${result.inspected_profiles ? result.inspected_profiles.length : 0} profiles`);

    drawLabel(image, font, 62, 116, 'Connected profiles');
    drawLabel(image, font, 684, 116, 'Likely teammates');

    const leftX = 54;
    const rightX = 650;
    const nodeW = 360;
    const nodeH = 58;
    const startY = 150;

    const leftPositions = {};
    connectionNames.slice(0, 10).forEach((name, index) => {
        const y = startY + index * rowHeight;
        leftPositions[name] = { x: leftX + nodeW, y: y + nodeH / 2 };
        drawNode(image, font, leftX, y, nodeW, nodeH, sanitizeImageText(name), '#2e3440', '#81a1c1');
    });

    shownCandidates.forEach((candidate, index) => {
        const y = startY + index * rowHeight;
        const title = sanitizeImageText(candidate.name || 'Unknown');
        const subtitle = `score ${candidate.score} | ${candidate.online ? 'online' : 'not online'} | ${formatSources(candidate.sources)}`;
        drawNode(image, font, rightX, y, nodeW, nodeH, title, candidate.online ? '#254733' : '#3a3030',
            candidate.online ? '#6fcf7d' : '#d08770', subtitle);

        const connections = Array.isArray(candidate.connection_profile_names) && candidate.connection_profile_names.length > 0 ?
            candidate.connection_profile_names : [connectionNames[0]];
        for (const connection of connections.slice(0, 3)) {
            const from = leftPositions[connection] || leftPositions[connectionNames[0]];
            if (!from) continue;
            drawConnection(image, from.x, from.y, rightX, y + nodeH / 2, candidate.online);
        }
    });

    return await image.getBufferAsync(Jimp.MIME_PNG);
}

function drawLabel(image, font, x, y, text) {
    image.print(font, x, y, text);
}

function drawConnection(image, x1, y1, x2, y2, online) {
    const lineColor = color(online ? '#6fcf7d' : '#6f7685');
    drawLine(image, Math.round(x1 + 8), Math.round(y1), Math.round(x2 - 8), Math.round(y2), lineColor,
        online ? 4 : 3);
}

function drawNode(image, font, x, y, width, height, title, fill, accent, subtitle = '') {
    fillRect(image, x, y, width, height, color(fill));
    fillCircle(image, x + 24, y + Math.round(height / 2), 8, color(accent));

    image.print(font, x + 44, y + 10, truncateImageText(title, 32));
    if (subtitle !== '') image.print(font, x + 44, y + 32, truncateImageText(subtitle, 45));
}

function fillRect(image, x, y, width, height, fill) {
    image.scan(x, y, width, height, function (scanX, scanY, index) {
        this.bitmap.data.writeUInt32BE(fill, index);
    });
}

function fillCircle(image, centerX, centerY, radius, fill) {
    for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
            if ((x * x) + (y * y) <= radius * radius) {
                setPixelSafe(image, centerX + x, centerY + y, fill);
            }
        }
    }
}

function drawLine(image, x1, y1, x2, y2, fill, thickness) {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let error = dx - dy;

    while (true) {
        fillCircle(image, x1, y1, Math.max(1, Math.floor(thickness / 2)), fill);
        if (x1 === x2 && y1 === y2) break;
        const error2 = 2 * error;
        if (error2 > -dy) {
            error -= dy;
            x1 += sx;
        }
        if (error2 < dx) {
            error += dx;
            y1 += sy;
        }
    }
}

function setPixelSafe(image, x, y, fill) {
    if (x < 0 || y < 0 || x >= image.bitmap.width || y >= image.bitmap.height) return;
    image.setPixelColor(fill, x, y);
}

function color(hex) {
    const value = hex.replace('#', '');
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return Jimp.rgbaToInt(red, green, blue, 255);
}

function sanitizeImageText(value) {
    return `${value}`.replace(/\s+/g, ' ').trim();
}

function truncateImageText(value, maxLength) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
}

function escapeMarkdown(value) {
    return `${value}`.replace(/([\\*_`~|[\]()])/g, '\\$1');
}

function truncate(value, maxLength) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
}
