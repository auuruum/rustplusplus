/*
	Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

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
const DiscordTools = require('../discordTools/discordTools.js');
const PlayerActivityDB = require('../util/database.js');

module.exports = {
	name: 'offlinepattern',

	getData(client, guildId) {
		return new Builder.SlashCommandBuilder()
			.setName('offlinepattern')
			.setDescription(client.intlGet(guildId, 'commandsOfflinePatternDesc'))
			.addSubcommand(subcommand => subcommand
				.setName('player')
				.setDescription(client.intlGet(guildId, 'commandsOfflinePatternPlayerDesc'))
				.addStringOption(option => option
					.setName('name')
					.setDescription(client.intlGet(guildId, 'theNameOfThePlayer'))
					.setRequired(true))
				.addStringOption(option => option
					.setName('battlemetricsid')
					.setDescription(client.intlGet(guildId, 'commandsPlayersBattlemetricsIdDesc'))
					.setRequired(false)))
			.addSubcommand(subcommand => subcommand
				.setName('playerid')
				.setDescription(client.intlGet(guildId, 'commandsOfflinePatternPlayerIdDesc'))
				.addStringOption(option => option
					.setName('playerid')
					.setDescription(client.intlGet(guildId, 'commandsPlayersPlayerIdPlayerIdDesc'))
					.setRequired(true))
				.addStringOption(option => option
					.setName('battlemetricsid')
					.setDescription(client.intlGet(guildId, 'commandsPlayersBattlemetricsIdDesc'))
					.setRequired(false)));
	},

	async execute(client, interaction) {
		const verifyId = Math.floor(100000 + Math.random() * 900000);
		client.logInteraction(interaction, verifyId, 'slashCommand');

		if (!await client.validatePermissions(interaction)) return;
		await interaction.deferReply({ ephemeral: true });

		let battlemetricsId = interaction.options.getString('battlemetricsid');

		if (!battlemetricsId) {
			const rustplus = client.rustplusInstances[interaction.guildId];
			if (!rustplus || (rustplus && !rustplus.isOperational)) {
				const str = client.intlGet(interaction.guildId, 'notConnectedToRustServer');
				await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
				client.log(client.intlGet(null, 'warningCap'), str);
				return;
			}

			const instance = client.getInstance(interaction.guildId);
			const server = instance.serverList[rustplus.serverId];
			if (!server || (server && !server.battlemetricsId)) {
				const str = client.intlGet(interaction.guildId, 'invalidBattlemetricsId');
				await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
				client.log(client.intlGet(null, 'warningCap'), str);
				return;
			}

			battlemetricsId = server.battlemetricsId;
		}

		const bmInstance = client.battlemetricsInstances[battlemetricsId];
		if (!bmInstance || !bmInstance.lastUpdateSuccessful) {
			const str = client.intlGet(interaction.guildId, 'battlemetricsInstanceCouldNotBeFound', {
				id: battlemetricsId
			});
			await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
			client.log(client.intlGet(null, 'warningCap'), str);
			return;
		}

		switch (interaction.options.getSubcommand()) {
			case 'player': {
				await offlinePatternNameHandler(client, interaction, battlemetricsId);
			} break;

			case 'playerid': {
				await offlinePatternPlayerIdHandler(client, interaction, battlemetricsId);
			} break;

			default: {
			} break;
		}

		client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
			id: `${verifyId}`,
			value: `${interaction.options.getSubcommand()} ` +
				`${interaction.options.getString('name')} ` +
				`${interaction.options.getString('playerid')} ` +
				`${interaction.options.getString('battlemetricsid')} `
		}));
	},
};

async function offlinePatternNameHandler(client, interaction, battlemetricsId) {
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const name = interaction.options.getString('name');
	const players = bmInstance.getOnlinePlayerIdsOrderedByTime().concat(bmInstance.getOfflinePlayerIdsOrderedByLeastTimeSinceOnline());

	let foundPlayers = [];
	for (const playerId of players) {
		if (bmInstance.players[playerId]['name'].includes(name)) foundPlayers.push(playerId);
	}

	if (foundPlayers.length === 0) {
		const str = client.intlGet(interaction.guildId, 'couldNotFindAnyPlayers');
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}
	else if (foundPlayers.length === 1) {
		await displayOfflinePattern(client, interaction, battlemetricsId, foundPlayers[0]);
	}
	else {
		await displayMultiplePlayerMatches(client, interaction, battlemetricsId, foundPlayers, name);
	}
}

async function offlinePatternPlayerIdHandler(client, interaction, battlemetricsId) {
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const playerId = interaction.options.getString('playerid');

	if (!bmInstance.players.hasOwnProperty(playerId)) {
		const str = client.intlGet(interaction.guildId, 'couldNotFindPlayerId', { id: playerId });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	await displayOfflinePattern(client, interaction, battlemetricsId, playerId);
}

async function displayOfflinePattern(client, interaction, battlemetricsId, playerId) {
	const guildId = interaction.guildId;
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const rustplus = client.rustplusInstances[guildId];
	
	if (!rustplus) {
		const str = client.intlGet(interaction.guildId, 'notConnectedToRustServer');
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}
	
	const serverId = rustplus.serverId;
	const player = bmInstance.players[playerId];
	
	if (!player) {
		const str = client.intlGet(interaction.guildId, 'couldNotFindPlayer', { name: playerId });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}
	
	const userName = player.name;
	const steamId = player.steamId || playerId;
	
	// Get the player's offline patterns from the database
	const offlinePatterns = PlayerActivityDB.analyzeOfflinePatterns(steamId, serverId, guildId);
	
	if (!offlinePatterns || offlinePatterns.length === 0) {
		const str = client.intlGet(interaction.guildId, 'noOfflinePatternData', { name: userName });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}
	
	// Get the player history
	const playerHistory = PlayerActivityDB.getPlayerHistory(steamId, serverId, guildId, 10);
	
	// Create embed to display offline patterns
	const profileLink = `[${playerId}](${Constants.BATTLEMETRICS_PROFILE_URL}${playerId})`;
	const battlemetricsLink = `[${bmInstance.id}](${Constants.BATTLEMETRICS_SERVER_URL}${bmInstance.id})`;
	const isOnline = player.status;
	const status = isOnline ? Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI;
	const onOffString = isOnline ? client.intlGet(guildId, 'onlineTime') : client.intlGet(guildId, 'offlineTime');
	const time = isOnline ? bmInstance.getOnlineTime(playerId) : bmInstance.getOfflineTime(playerId);
	
	let description = `__**${client.intlGet(guildId, 'profile')}:**__ ${profileLink}\n`;
	description += `__**Battlemetrics ID:**__ ${battlemetricsLink}\n`;
	description += `__**${client.intlGet(guildId, 'status')}:**__ ${status}\n`;
	description += `__**${onOffString}:**__ ${time !== null ? `[${time[1]}]` : ''}\n\n`;
	description += `__**${client.intlGet(guildId, 'offlinePatternAnalysis')}:**__\n`;
	
	const embed = DiscordEmbeds.getEmbed({
		title: `${client.intlGet(interaction.guildId, 'offlinePatternFor')}: ${userName}`,
		color: Constants.COLOR_DEFAULT,
		description: description,
		footer: { text: bmInstance.server_name }
	});
	
	// Add fields for each offline pattern range
	let patternFieldValue = '';
	let historyFieldValue = '';
	
	for (let i = 0; i < Math.min(offlinePatterns.length, 3); i++) {
		const pattern = offlinePatterns[i];
		const rangeStr = formatTimeRange(pattern.startHour, pattern.endHour);
		const confidencePercent = ((pattern.averageEventsPerHour / offlinePatterns[0].averageEventsPerHour) * 100).toFixed(0);
		
		patternFieldValue += `**${i+1}.** ${rangeStr}\n`;
		patternFieldValue += `   • ${client.intlGet(guildId, 'duration')}: ${pattern.duration} ${client.intlGet(guildId, 'hours')}\n`;
		patternFieldValue += `   • ${client.intlGet(guildId, 'confidence')}: ${confidencePercent}%\n\n`;
	}
	
	// Add recent activity history
	if (playerHistory && playerHistory.length > 0) {
		for (const event of playerHistory) {
			const eventType = event.event_type === 'online' ? 
				Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI;
			const date = new Date(event.timestamp);
			const formattedDate = DiscordTools.getDiscordFormattedDate(Math.floor(date.getTime() / 1000));
			
			historyFieldValue += `${eventType} ${formattedDate}\n`;
		}
	} else {
		historyFieldValue = client.intlGet(guildId, 'noActivityData');
	}
	
	const fields = [
		{
			name: client.intlGet(guildId, 'bestRaidTimes'),
			value: patternFieldValue || client.intlGet(guildId, 'notEnoughData'),
			inline: false
		},
		{
			name: client.intlGet(guildId, 'recentActivity'),
			value: historyFieldValue,
			inline: false
		}
	];
	
	embed.setFields(fields);
	
	await client.interactionEditReply(interaction, { embeds: [embed] });
	client.log(client.intlGet(interaction.guildId, 'infoCap'),
		client.intlGet(interaction.guildId, 'displayingOfflinePatterns'));
}

async function displayMultiplePlayerMatches(client, interaction, battlemetricsId, playerIds, search) {
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const guildId = interaction.guildId;

	let totalCharacters = 0;
	let fieldCharacters = 0;

	let title = client.intlGet(interaction.guildId, 'playersSearch');
	title += search === null ? '' : `: ${search}`;
	let footer = { text: bmInstance.server_name };

	totalCharacters += title.length;
	totalCharacters += bmInstance.server_name.length;
	totalCharacters += client.intlGet(interaction.guildId, 'andMorePlayers', { number: 100 }).length;
	totalCharacters += `${client.intlGet(interaction.guildId, 'players')}`.length;

	const fields = [''];
	let fieldIndex = 0;
	let isEmbedFull = false;
	let playerCounter = 0;
	
	for (const playerId of playerIds) {
		playerCounter += 1;

		const status = bmInstance.players[playerId]['status'];
		const time = status ? bmInstance.getOnlineTime(playerId)[1] : bmInstance.getOfflineTime(playerId)[1];

		let playerStr = status ? Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI;
		playerStr += ` [${time}] `;

		const nameMaxLength = Constants.EMBED_FIELD_MAX_WIDTH_LENGTH_3 - (3 + time.length);

		let name = bmInstance.players[playerId]['name'].replace('[', '(').replace(']', ')');
		name = name.length <= nameMaxLength ? name : name.substring(0, nameMaxLength - 2) + '..';

		playerStr += `[${name}](${Constants.BATTLEMETRICS_PROFILE_URL + `${playerId}`})\n`;

		if (totalCharacters + playerStr.length >= Constants.EMBED_MAX_TOTAL_CHARACTERS) {
			isEmbedFull = true;
			break;
		}

		if (fieldCharacters + playerStr.length >= Constants.EMBED_MAX_FIELD_VALUE_CHARACTERS) {
			fieldCharacters = 0;
			fieldIndex += 1;
			fields.push('');
		}

		fields[fieldIndex] += playerStr;
		totalCharacters += playerStr.length;
		fieldCharacters += playerStr.length;
	}

	const embed = DiscordEmbeds.getEmbed({
		title: title,
		color: Constants.COLOR_DEFAULT,
		description: client.intlGet(interaction.guildId, 'multiplePlayersFound'),
		footer: footer
	});

	if (isEmbedFull) {
		embed.setDescription(client.intlGet(interaction.guildId, 'andMorePlayers', {
			number: playerIds.length - playerCounter
		}));
	}

	let fieldCounter = 0;
	for (const field of fields) {
		embed.addFields({
			name: fieldCounter === 0 ? client.intlGet(interaction.guildId, 'players') : '\u200B',
			value: field === '' ? '\u200B' : field,
			inline: true
		});
		fieldCounter += 1;
	}

	await client.interactionEditReply(interaction, { embeds: [embed] });
	client.log(client.intlGet(interaction.guildId, 'infoCap'),
		client.intlGet(interaction.guildId, 'displayingPlayerSearchResults'));
}

function formatTimeRange(startHour, endHour) {
	const formatHour = (hour) => {
		return hour.toString().padStart(2, '0') + ':00';
	};
	
	if (startHour <= endHour) {
		return `${formatHour(startHour)} - ${formatHour(endHour)}`;
	} else {
		// Handle ranges that span across midnight
		return `${formatHour(startHour)} - ${formatHour(endHour)} ${Constants.MIDNIGHT_EMOJI}`;
	}
}
