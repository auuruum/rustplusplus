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
const PlayerActivityDB = require('../util/database.js');

module.exports = {
	name: 'whois',

	getData(client, guildId) {
		return new Builder.SlashCommandBuilder()
			.setName('whois')
			.setDescription(client.intlGet(guildId, 'commandsWhoisDesc'))
			.addSubcommand(subcommand => subcommand
				.setName('player')
				.setDescription(client.intlGet(guildId, 'commandsWhoisPlayerDesc'))
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
				.setDescription(client.intlGet(guildId, 'commandsWhoisPlayerIdDesc'))
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
				await whoisNameHandler(client, interaction, battlemetricsId);
			} break;

			case 'playerid': {
				await whoisPlayerIdHandler(client, interaction, battlemetricsId);
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

async function whoisNameHandler(client, interaction, battlemetricsId) {
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const name = interaction.options.getString('name');
	const players = bmInstance.getOnlinePlayerIdsOrderedByTime()
		.concat(bmInstance.getOfflinePlayerIdsOrderedByLeastTimeSinceOnline());

	const foundPlayers = [];
	for (const playerId of players) {
		if (bmInstance.players[playerId]['name'].toLowerCase().includes(name.toLowerCase())) {
			foundPlayers.push(playerId);
		}
	}

	if (foundPlayers.length === 0) {
		const str = client.intlGet(interaction.guildId, 'couldNotFindAnyPlayers');
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}
	else if (foundPlayers.length === 1) {
		await displayWhois(client, interaction, battlemetricsId, foundPlayers[0]);
	}
	else {
		await displayMultiplePlayerMatches(client, interaction, battlemetricsId, foundPlayers, name);
	}
}

async function whoisPlayerIdHandler(client, interaction, battlemetricsId) {
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const playerId = interaction.options.getString('playerid');

	if (!bmInstance.players.hasOwnProperty(playerId)) {
		const str = client.intlGet(interaction.guildId, 'couldNotFindPlayerId', { id: playerId });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	await displayWhois(client, interaction, battlemetricsId, playerId);
}

async function displayWhois(client, interaction, battlemetricsId, playerId) {
	const guildId = interaction.guildId;
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const rustplus = client.rustplusInstances[guildId];

	if (!rustplus) {
		const str = client.intlGet(guildId, 'notConnectedToRustServer');
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	const serverId = rustplus.serverId;
	const player = bmInstance.players[playerId];

	if (!player) {
		const str = client.intlGet(guildId, 'couldNotFindPlayer', { name: playerId });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	const currentName = player.name;
	const steamId = player.steamId || playerId;

	const nameHistory = PlayerActivityDB.getNameHistory(steamId, serverId, guildId);

	if (!nameHistory || nameHistory.length === 0) {
		const str = client.intlGet(guildId, 'noNameHistoryData', { name: currentName });
		await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
		client.log(client.intlGet(null, 'warningCap'), str);
		return;
	}

	const profileLink = `[${playerId}](${Constants.BATTLEMETRICS_PROFILE_URL}${playerId})`;
	const isOnline = player.status;
	const status = isOnline ? Constants.ONLINE_EMOJI : Constants.OFFLINE_EMOJI;

	let description = `__**${client.intlGet(guildId, 'profile')}:**__ ${profileLink}\n`;
	description += `__**${client.intlGet(guildId, 'status')}:**__ ${status}\n`;
	description += `__**${client.intlGet(guildId, 'whoisCurrentName')}:**__ ${currentName}\n`;

	const embed = DiscordEmbeds.getEmbed({
		title: client.intlGet(guildId, 'whoisTitle').replace('{name}', currentName),
		color: Constants.COLOR_DEFAULT,
		description: description,
		footer: { text: bmInstance.server_name }
	});

	let historyValue = '';
	for (const entry of nameHistory) {
		const date = new Date(entry.first_seen).toISOString().slice(0, 10);
		historyValue += `• **${entry.name}** — ${client.intlGet(guildId, 'whoisFirstSeen')}: ${date}\n`;
	}

	embed.addFields({
		name: client.intlGet(guildId, 'whoisNameHistory'),
		value: historyValue || '\u200B',
		inline: false
	});

	await client.interactionEditReply(interaction, { embeds: [embed] });
	client.log(client.intlGet(guildId, 'infoCap'),
		client.intlGet(guildId, 'displayingPlayerSearchResults'));
}

async function displayMultiplePlayerMatches(client, interaction, battlemetricsId, playerIds, search) {
	const bmInstance = client.battlemetricsInstances[battlemetricsId];
	const guildId = interaction.guildId;

	let totalCharacters = 0;
	let fieldCharacters = 0;

	let title = client.intlGet(guildId, 'playersSearch');
	title += search === null ? '' : `: ${search}`;
	const footer = { text: bmInstance.server_name };

	totalCharacters += title.length;
	totalCharacters += bmInstance.server_name.length;
	totalCharacters += client.intlGet(guildId, 'andMorePlayers', { number: 100 }).length;
	totalCharacters += `${client.intlGet(guildId, 'players')}`.length;

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
		description: client.intlGet(guildId, 'multiplePlayersFound'),
		footer: footer
	});

	if (isEmbedFull) {
		embed.setDescription(client.intlGet(guildId, 'andMorePlayers', {
			number: playerIds.length - playerCounter
		}));
	}

	let fieldCounter = 0;
	for (const field of fields) {
		embed.addFields({
			name: fieldCounter === 0 ? client.intlGet(guildId, 'players') : '\u200B',
			value: field === '' ? '\u200B' : field,
			inline: true
		});
		fieldCounter += 1;
	}

	await client.interactionEditReply(interaction, { embeds: [embed] });
	client.log(client.intlGet(guildId, 'infoCap'),
		client.intlGet(guildId, 'displayingPlayerSearchResults'));
}
