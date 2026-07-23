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

const Constants = require('../util/constants.js');
const RosterProvider = require('../util/rosterProvider.js');
const TrackerA2sState = require('../util/trackerA2sState.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordTools = require('../discordTools/discordTools.js');
const PlayerActivityDB = require('../util/database.js');
const Scrape = require('../util/scrape.js');
const Utils = require('../util/utils.js');

let handlerRunning = false;

module.exports = {
    handler: async function (client, firstTime = false) {
        if (handlerRunning) return;
        handlerRunning = true;
        try {
        const searchSteamProfiles = (client.battlemetricsIntervalCounter === 0) ? true : false;
        const calledSteamProfiles = new Object();
        const rosterSnapshots = new Map();

        if (!firstTime) await client.updateBattlemetricsInstances();

        for (const guildItem of client.guilds.cache) {
            const guildId = guildItem[0];
            const instance = client.getInstance(guildId);
            const rustplus = client.rustplusInstances[guildId];

            if (!firstTime) await module.exports.handleBattlemetricsChanges(client, guildId);

            await collectRelevantRosterSnapshots(client, guildId, instance, rosterSnapshots);

            /* Update information channel battlemetrics players */
            const activeServer = instance.activeServer !== null ? instance.serverList[instance.activeServer] : null;
            const bmId = activeServer ? activeServer.battlemetricsId : null;
            let condition = instance.generalSettings.displayInformationBattlemetricsAllOnlinePlayers;
            condition &= activeServer !== null;
            condition &= rustplus && rustplus.isOperational;

            if (condition) {
                const bmInstance = client.battlemetricsInstances[bmId];
                const informationRoster = rosterSnapshots.get(rosterKey(guildId, instance.activeServer));
                if ((bmInstance && bmInstance.lastUpdateSuccessful) ||
                    (informationRoster && informationRoster.available)) {
                    await DiscordMessages.sendUpdateBattlemetricsOnlinePlayersInformationMessage(
                        rustplus, bmId, bmInstance && bmInstance.lastUpdateSuccessful ? null : informationRoster);
                }
                else if (instance.informationMessageId.battlemetricsPlayers !== null) {
                    await DiscordTools.deleteMessageById(guildId, instance.channelId.information,
                        instance.informationMessageId.battlemetricsPlayers);
                    instance.informationMessageId.battlemetricsPlayers = null;
                    client.setInstance(guildId, instance);
                }
            }
            else {
                if (instance.informationMessageId.battlemetricsPlayers !== null) {
                    await DiscordTools.deleteMessageById(guildId, instance.channelId.information,
                        instance.informationMessageId.battlemetricsPlayers);

                    instance.informationMessageId.battlemetricsPlayers = null;
                    client.setInstance(guildId, instance);
                }
            }

            for (const [trackerId, content] of Object.entries(instance.trackers)) {
                const battlemetricsId = content.battlemetricsId;
                const bmInstance = client.battlemetricsInstances[battlemetricsId];

                if (!bmInstance || !bmInstance.lastUpdateSuccessful) {
                    const roster = rosterSnapshots.get(rosterKey(guildId, content.serverId));
                    await handleFallbackTracker(client, guildId, trackerId, content, firstTime,
                        searchSteamProfiles, calledSteamProfiles, roster);
                    continue;
                }

                content.rosterSource = 'battlemetrics_api';
                content.rosterAvailable = true;
                content.rosterUpdatedAt = bmInstance.updatedAt ? Date.parse(bmInstance.updatedAt) : Date.now();
                content.rosterUnavailableReason = null;

                if (firstTime || searchSteamProfiles) {
                    for (const player of content.players) {
                        if (player.steamId === null) continue;

                        let name = null;
                        if (calledSteamProfiles.hasOwnProperty(player.steamId)) {
                            name = calledSteamProfiles[player.steamId];
                        }
                        else {
                            name = await Scrape.scrapeSteamProfileName(client, player.steamId);
                            calledSteamProfiles[player.steamId] = name;
                        }
                        if (name === null) continue;

                        name = (content.clanTag !== '' ? `${content.clanTag} ` : '') + `${name}`;

                        if (player.name !== name) {
                            await module.exports.trackerNewNameDetected(client, guildId, trackerId, battlemetricsId,
                                player.name, name);

                            const newPlayerId = Object.keys(bmInstance.players)
                                .find(e => bmInstance.players[e]['name'] === name);
                            player.playerId = newPlayerId ? newPlayerId : null;
                            player.name = name;
                        }
                    }

                    syncA2sStateFromBattlemetrics(content, bmInstance);

                    client.setInstance(guildId, instance);

                    if (firstTime) {
                        await DiscordMessages.sendTrackerMessage(guildId, trackerId);
                        continue;
                    }
                }

                const trackerPlayerIds = content.players.map(e => e.playerId);

                /* Check if Player just changed name */
                for (const player of bmInstance.nameChangedPlayers.filter(e => trackerPlayerIds.includes(e.id))) {
                    for (const playerT of content.players) {
                        if (playerT.playerId !== player.id) continue;

                        await module.exports.trackerNewNameDetected(client, guildId, trackerId, battlemetricsId,
                            player.from, player.to);
                    }
                }

                /* Check if Player just came online */
                for (const playerId of trackerPlayerIds.filter(e => bmInstance.newPlayers.includes(e))) {
                    for (const player of content.players) {
                        if (player.playerId !== playerId) continue;

                        const str = client.intlGet(guildId, 'playerJustConnectedTracker', {
                            name: player.name,
                            tracker: content.name
                        });
                        await DiscordMessages.sendActivityNotificationMessage(
                            guildId, content.serverId, Constants.COLOR_ACTIVE, str, null, content.title,
                            content.everyone);
                        if (rustplus && (rustplus.serverId === content.serverId) && content.inGame) {
                            rustplus.sendInGameMessage(str);
                        }
                    }
                }

                /* Check if Player just came online */
                for (const playerId of trackerPlayerIds.filter(e => bmInstance.loginPlayers.includes(e))) {
                    for (const player of content.players) {
                        if (player.playerId !== playerId) continue;

                        const str = client.intlGet(guildId, 'playerJustConnectedTracker', {
                            name: player.name,
                            tracker: content.name
                        });
                        await DiscordMessages.sendActivityNotificationMessage(
                            guildId, content.serverId, Constants.COLOR_ACTIVE, str, null, content.title,
                            content.everyone);
                        if (rustplus && (rustplus.serverId === content.serverId) && content.inGame) {
                            rustplus.sendInGameMessage(str);
                        }
                    }
                }

                /* Check if Player just went offline */
                for (const playerId of trackerPlayerIds.filter(e => bmInstance.logoutPlayers.includes(e))) {
                    for (const player of content.players) {
                        if (player.playerId !== playerId) continue;

                        const str = client.intlGet(guildId, 'playerJustDisconnectedTracker', {
                            name: player.name,
                            tracker: content.name
                        });

                        await DiscordMessages.sendActivityNotificationMessage(
                            guildId, content.serverId, Constants.COLOR_INACTIVE, str, null, content.title,
                            content.everyone);
                        if (rustplus && (rustplus.serverId === content.serverId) && content.inGame) {
                            rustplus.sendInGameMessage(str);
                        }
                    }
                }

                syncA2sStateFromBattlemetrics(content, bmInstance);

                client.setInstance(guildId, instance);

                await DiscordMessages.sendTrackerMessage(guildId, trackerId);
            }

            if (client.streamDeckBridge) {
                client.streamDeckBridge.broadcastSnapshot(guildId, ['trackers', 'pop']);
            }
        }

        if (client.battlemetricsIntervalCounter === 29) {
            client.battlemetricsIntervalCounter = 0;
        }
        else {
            client.battlemetricsIntervalCounter += 1;
        }
        }
        catch (error) {
            client.log(client.intlGet(null, 'errorCap'), `Roster update cycle failed: ${error.message}`, 'error');
        }
        finally {
            handlerRunning = false;
        }
    },

    handleBattlemetricsChanges: async function (client, guildId) {
        const instance = client.getInstance(guildId);
        const settings = instance.generalSettings;
        const rustplus = client.rustplusInstances[guildId];

        const activeServer = instance.activeServer;
        const server = instance.serverList[activeServer];
        const battlemetricsIdActiveServer = server ? server.battlemetricsId : null;

        const battlemetricsIds = [];
        if (battlemetricsIdActiveServer && client.battlemetricsInstances.hasOwnProperty(battlemetricsIdActiveServer) &&
            client.battlemetricsInstances[battlemetricsIdActiveServer].lastUpdateSuccessful) {
            battlemetricsIds.push(battlemetricsIdActiveServer);
        }

        for (const [trackerId, content] of Object.entries(instance.trackers)) {
            const battlemetricsId = content.battlemetricsId;
            const bmInstance = client.battlemetricsInstances[battlemetricsId];

            if (!bmInstance || (bmInstance && !bmInstance.lastUpdateSuccessful)) continue;
            if (battlemetricsIds.includes(battlemetricsId)) continue;

            battlemetricsIds.push(battlemetricsId);
        }

        /* Go through each battlemetrics instance and notify changes */
        for (const battlemetricsId of battlemetricsIds) {
            const bmInstance = client.battlemetricsInstances[battlemetricsId];

            /* Server name changed? */
            if (settings.battlemetricsServerNameChanges && bmInstance.serverEvaluation.hasOwnProperty('server_name')) {
                const oldName = bmInstance.serverEvaluation['server_name'].from;
                const newName = bmInstance.serverEvaluation['server_name'].to;

                const title = client.intlGet(guildId, 'battlemetricsServerNameChanged');
                const description = `__**${client.intlGet(guildId, 'old')}:**__ ${oldName}\n` +
                    `__**${client.intlGet(guildId, 'new')}:**__ ${newName}`;

                await DiscordMessages.sendBattlemetricsEventMessage(guildId, battlemetricsId, title, description);
            }

            /* Players whos name have changed */
            if (settings.battlemetricsGlobalNameChanges && bmInstance.nameChangedPlayers.length !== 0) {
                const title = client.intlGet(guildId, 'battlemetricsPlayersNameChanged');

                const oldNameFieldName = client.intlGet(guildId, 'old');
                const playerIdFieldName = client.intlGet(guildId, 'playerId');
                const newNameFieldName = client.intlGet(guildId, 'new');

                let totalCharacters = 50; /* Start of with 50 characters as a base. */

                let oldName = [''], playerId = [''], newName = [''];
                let oldNameCharacters = 0, playerIdCharacters = 0, newNameCharacters = 0;
                let fieldIndex = 0;
                let isEmbedFull = false;
                let playerCounter = 0;
                for (const player of bmInstance.nameChangedPlayers) {
                    playerCounter += 1;
                    const fieldRowMaxLength = Constants.EMBED_FIELD_MAX_WIDTH_LENGTH_3;

                    let oldN = `${player.from}`;
                    oldN = oldN.length <= fieldRowMaxLength ? oldN : oldN.substring(0, fieldRowMaxLength - 2) + '..';
                    oldN += '\n';

                    const id = `[${player.id}](${Constants.BATTLEMETRICS_PROFILE_URL + `${player.id}`})\n`;

                    let newN = `${player.to}`;
                    newN = newN.length <= fieldRowMaxLength ? newN : newN.substring(0, fieldRowMaxLength - 2) + '..';
                    newN += '\n';



                    if (totalCharacters + (oldN.length + id.length + newN.length) >=
                        Constants.EMBED_MAX_TOTAL_CHARACTERS) {
                        isEmbedFull = true;
                        break;
                    }

                    if ((oldNameCharacters + oldN.length) > Constants.EMBED_MAX_FIELD_VALUE_CHARACTERS ||
                        (playerIdCharacters + id.length) > Constants.EMBED_MAX_FIELD_VALUE_CHARACTERS ||
                        (newNameCharacters + newN.length) > Constants.EMBED_MAX_FIELD_VALUE_CHARACTERS) {
                        fieldIndex += 1;

                        oldName.push('');
                        playerId.push('');
                        newName.push('');

                        oldNameCharacters = 0;
                        playerIdCharacters = 0;
                        newNameCharacters = 0;
                    }

                    oldNameCharacters += oldN.length;
                    playerIdCharacters += id.length;
                    newNameCharacters += newN.length;

                    totalCharacters += oldN.length + id.length + newN.length;

                    oldName[fieldIndex] += oldN;
                    playerId[fieldIndex] += id;
                    newName[fieldIndex] += newN;
                }

                let description = '';
                if (isEmbedFull) {
                    description = client.intlGet(guildId, 'andMorePlayers', {
                        number: bmInstance.nameChangedPlayers.length - playerCounter
                    });
                }

                const fields = [];
                for (let i = 0; i < (fieldIndex + 1); i++) {
                    fields.push({
                        name: i === 0 ? oldNameFieldName : '\u200B',
                        value: oldName[i] !== '' ? oldName[i] : client.intlGet(guildId, 'empty'),
                        inline: true
                    });
                    fields.push({
                        name: i === 0 ? playerIdFieldName : '\u200B',
                        value: playerId[i] !== '' ? playerId[i] : client.intlGet(guildId, 'empty'),
                        inline: true
                    });
                    fields.push({
                        name: i === 0 ? newNameFieldName : '\u200B',
                        value: newName[i] !== '' ? newName[i] : client.intlGet(guildId, 'empty'),
                        inline: true
                    });
                }

                await DiscordMessages.sendBattlemetricsEventMessage(guildId, battlemetricsId, title,
                    description, fields);
            }

            /* Players that just logged in */
            if (settings.battlemetricsGlobalLogin &&
                (bmInstance.loginPlayers.length !== 0 || bmInstance.newPlayers.length !== 0)) {
                const playerIds = Array.from(new Set(bmInstance.loginPlayers.concat(bmInstance.newPlayers)));
                const title = client.intlGet(guildId, 'battlemetricsPlayersLogin');

                let totalCharacters = 50; /* Start of with 50 characters as a base. */
                let fieldCharacters = 0;

                const fields = [''];
                let fieldIndex = 0;
                let isEmbedFull = false;
                let playerCounter = 0;
                for (const playerId of playerIds) {
                    playerCounter += 1;
                    const name = bmInstance.players[playerId]['name'].replace('[', '(').replace(']', ')');
                    const playerStr = `[${name}](${Constants.BATTLEMETRICS_PROFILE_URL + `${playerId}`})\n`;

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

                let description = '';
                if (isEmbedFull) {
                    description = client.intlGet(guildId, 'andMorePlayers', {
                        number: playerIds.length - playerCounter
                    });
                }

                let fieldCounter = 0;
                const outPutFields = [];
                for (const field of fields) {
                    outPutFields.push({
                        name: '\u200B',
                        value: field === '' ? '\u200B' : field,
                        inline: true
                    });
                    fieldCounter += 1;
                }

                await DiscordMessages.sendBattlemetricsEventMessage(guildId, battlemetricsId, title,
                    description, outPutFields);
            }

            if(bmInstance.logoutPlayers.length !== 0) {
                const serverId = `${bmInstance.server_ip}-${bmInstance.server_port}`;
                for (const playerId of bmInstance.logoutPlayers) {
                    // Record logout in database for battlemetrics
                    const player = bmInstance.players[playerId];
                    if (playerId) {
                        PlayerActivityDB.recordLogout(playerId, player.name, serverId, guildId);
                    }
                }
            }

            if(bmInstance.loginPlayers.length !== 0 || bmInstance.newPlayers.length !== 0) {
                const serverId = `${bmInstance.server_ip}-${bmInstance.server_port}`;
                for (const playerId of bmInstance.loginPlayers) {
                    // Record logout in database for battlemetrics
                    const player = bmInstance.players[playerId];
                    if (playerId) {
                        PlayerActivityDB.recordLogin(playerId, player.name, serverId, guildId);
                    }
                }
                for (const playerId of bmInstance.newPlayers) {
                    // Record logout in database for battlemetrics
                    const player = bmInstance.players[playerId];
                    if (playerId) {
                        PlayerActivityDB.recordLogin(playerId, player.name, serverId, guildId);
                    }
                }
            }

            /* Players that just logged out */
            if (settings.battlemetricsGlobalLogout && bmInstance.logoutPlayers.length !== 0) {
                const title = client.intlGet(guildId, 'battlemetricsPlayersLogout');

                let totalCharacters = 50; /* Start of with 50 characters as a base. */
                let fieldCharacters = 0;

                const fields = [''];
                let fieldIndex = 0;
                let isEmbedFull = false;
                let playerCounter = 0;
                for (const playerId of bmInstance.logoutPlayers) {
                    playerCounter += 1;
                    const name = bmInstance.players[playerId]['name'].replace('[', '(').replace(']', ')');
                    const playerStr = `[${name}](${Constants.BATTLEMETRICS_PROFILE_URL + `${playerId}`})\n`;

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

                let description = '';
                if (isEmbedFull) {
                    description = client.intlGet(guildId, 'andMorePlayers', {
                        number: bmInstance.logoutPlayers.length - playerCounter
                    });
                }

                let fieldCounter = 0;
                const outPutFields = [];
                for (const field of fields) {
                    outPutFields.push({
                        name: '\u200B',
                        value: field === '' ? '\u200B' : field,
                        inline: true
                    });
                    fieldCounter += 1;
                }

                await DiscordMessages.sendBattlemetricsEventMessage(guildId, battlemetricsId, title,
                    description, outPutFields);
            }
        }
    },

    trackerNewNameDetected: async function (client, guildId, trackerId, battlemetricsId, oldName, newName) {
        const instance = client.getInstance(guildId);
        const trackerName = instance.trackers[trackerId].name;

        const title = client.intlGet(guildId, 'battlemetricsTrackerPlayerNameChanged');
        const description = `__**${client.intlGet(guildId, 'tracker')}:**__ ${trackerName}\n\n` +
            `__**${client.intlGet(guildId, 'old')}:**__ ${oldName}\n` +
            `__**${client.intlGet(guildId, 'new')}:**__ ${newName}`;

        await DiscordMessages.sendBattlemetricsEventMessage(guildId, battlemetricsId, title, description, null,
            instance.trackers[trackerId].everyone);
    },
}

function syncA2sStateFromBattlemetrics(content, bmInstance) {
    for (const player of content.players) {
        const battlemetricsPlayer = player.playerId !== null ? bmInstance.players[player.playerId] : null;
        if (!battlemetricsPlayer || typeof battlemetricsPlayer.status !== 'boolean') {
            delete player.a2sStatus;
            delete player.a2sAmbiguous;
            continue;
        }
        player.a2sStatus = battlemetricsPlayer.status ? 'online' : 'offline';
        player.a2sAmbiguous = false;
    }
}

async function handleFallbackTracker(client, guildId, trackerId, content, firstTime, searchSteamProfiles,
    calledSteamProfiles, roster) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[content.serverId];
    if (!server) return;
    if (!roster) {
        roster = {
            source: 'unavailable', available: false, complete: false,
            observedAt: Date.now(), players: [], nameCounts: {}, reason: 'No roster snapshot was collected.'
        };
    }

    if (firstTime || searchSteamProfiles) {
        for (const player of content.players) {
            if (player.steamId === null) continue;
            let name = calledSteamProfiles[player.steamId];
            if (name === undefined) {
                name = await Scrape.scrapeSteamProfileName(client, player.steamId);
                calledSteamProfiles[player.steamId] = name;
            }
            if (name === null) continue;
            name = (content.clanTag !== '' ? `${content.clanTag} ` : '') + name;
            if (player.name !== name) {
                const battlemetrics = client.battlemetricsInstances[content.battlemetricsId];
                if (battlemetrics && battlemetrics.server_ip && battlemetrics.server_port) {
                    await module.exports.trackerNewNameDetected(client, guildId, trackerId, content.battlemetricsId,
                        player.name, name);
                }
                player.name = name;
            }
        }
    }

    if (roster.available) {
        const names = roster.players.map(name => Utils.removeInvisibleCharacters(name)).filter(name => name !== '');
        roster = Object.assign({}, roster, {
            players: names,
            nameCounts: names.reduce((counts, name) => {
                counts[name] = (counts[name] || 0) + 1;
                return counts;
            }, {})
        });
    }

    content.rosterSource = roster.source || 'unavailable';
    content.rosterUpstreamSource = roster.upstreamSource || null;
    content.rosterAvailable = roster.available;
    content.rosterUpdatedAt = roster.observedAt || Date.now();
    content.rosterUnavailableReason = roster.available ? null : roster.reason;

    const tracked = content.players.map((player, index) => ({
        key: `${player.steamId || player.playerId || index}`,
        name: Utils.removeInvisibleCharacters(player.name)
    }));
    const previous = {};
    for (let i = 0; i < content.players.length; i++) {
        const player = content.players[i];
        const key = tracked[i].key;
        previous[key] = {
            initialized: player.a2sStatus === 'online' || player.a2sStatus === 'offline',
            online: player.a2sStatus === 'online'
        };
    }

    const evaluation = TrackerA2sState.evaluate(previous, tracked, roster);
    for (let i = 0; i < content.players.length; i++) {
        const state = evaluation.state[tracked[i].key];
        const ambiguous = evaluation.ambiguous.includes(tracked[i].key);
        content.players[i].a2sAmbiguous = ambiguous;
        if (!ambiguous && state && state.initialized) {
            content.players[i].a2sStatus = state.online ? 'online' : 'offline';
        }
    }

    client.setInstance(guildId, instance);

    for (const event of evaluation.events) {
        const player = content.players.find((candidate, index) =>
            `${candidate.steamId || candidate.playerId || index}` === event.key);
        if (!player) continue;
        const translation = event.type === 'login' ? 'playerJustConnectedTracker' : 'playerJustDisconnectedTracker';
        const translated = client.intlGet(guildId, translation, { name: player.name, tracker: content.name });
        const str = roster.source === 'a2s' ?
            `${translated}\nPublic A2S display-name match; Steam identity is not confirmed.` : translated;
        await DiscordMessages.sendActivityNotificationMessage(guildId, content.serverId,
            event.type === 'login' ? Constants.COLOR_ACTIVE : Constants.COLOR_INACTIVE,
            str, null, content.title, content.everyone);
        const rustplus = client.rustplusInstances[guildId];
        if (rustplus && rustplus.serverId === content.serverId && content.inGame) rustplus.sendInGameMessage(str);
    }

    await DiscordMessages.sendTrackerMessage(guildId, trackerId);
}

async function collectRelevantRosterSnapshots(client, guildId, instance, snapshots) {
    const serverIds = new Set();
    if (instance.activeServer !== null) serverIds.add(instance.activeServer);
    for (const tracker of Object.values(instance.trackers)) serverIds.add(tracker.serverId);

    const collected = await Promise.all(Array.from(serverIds).map(async serverId => {
        const server = instance.serverList[serverId];
        if (!server) return null;
        const battlemetrics = server.battlemetricsId !== null ?
            client.battlemetricsInstances[server.battlemetricsId] : null;
        const snapshot = await RosterProvider.getRosterSnapshot({
            guildId,
            serverId,
            server,
            battlemetrics,
            onStoreError: (error, operation) => client.log(
                client.intlGet(null, 'warningCap'),
                `Local roster persistence ${operation} failed: ${error.message}`,
                'warning')
        });
        return [rosterKey(guildId, serverId), snapshot];
    }));

    for (const collectedSnapshot of collected) {
        if (collectedSnapshot) snapshots.set(collectedSnapshot[0], collectedSnapshot[1]);
    }
}

function rosterKey(guildId, serverId) {
    return `${guildId}:${serverId}`;
}
