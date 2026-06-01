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
const Fs = require('fs');
const Jimp = require('jimp');
const Path = require('path');
const RustPlusLib = require('@liamcottle/rustplus.js');

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordTools = require('../discordTools/discordTools.js');

const CAMERA_FRAME_CAPTURE_TIMEOUT_MS = 15000;
const CAMERA_CYCLING_GAP_MS = 1000;
const CAMERA_DEDUP_COOLDOWN_MS = 5 * 60 * 1000; /* 5 minutes */
const CAMERA_FRAME_SCALE = 4;

module.exports = {
    startCycling: function (rustplus, client) {
        if (rustplus.cameraCyclingActive) return;

        const instance = client.getInstance(rustplus.guildId);
        const server = instance.serverList[rustplus.serverId];
        if (!server || !server.cameras || Object.keys(server.cameras).length === 0) return;

        rustplus.cameraCyclingActive = true;
        rustplus.cameraCyclingIndex = 0;
        rustplus.cameraSeenPlayers = {};

        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'cameraCyclingStarted'));
        module.exports.cycleStep(rustplus, client);
    },

    stopCycling: function (rustplus) {
        if (!rustplus.cameraCyclingActive) return;

        if (rustplus.cameraCyclingTaskId) {
            clearTimeout(rustplus.cameraCyclingTaskId);
            rustplus.cameraCyclingTaskId = null;
        }

        if (rustplus.cameraCurrentCamera !== null) {
            rustplus.cameraCurrentCamera.unsubscribe().catch(() => { /* Ignore */ });
            rustplus.cameraCurrentCamera = null;
            rustplus.cameraCurrentSubscription = null;
        }
        else if (rustplus.cameraCurrentSubscription !== null) {
            rustplus.unsubscribeFromCameraAsync(5000).catch(() => { /* Ignore */ });
            rustplus.cameraCurrentSubscription = null;
        }
        for (const cameraClient of Object.values(rustplus.cameraClients || {})) {
            if (cameraClient && cameraClient.isSubscribed) {
                cameraClient.unsubscribe().catch(() => { /* Ignore */ });
            }
        }
        for (const credentialClient of Object.values(rustplus.cameraCredentialClients || {})) {
            if (credentialClient && credentialClient.websocket) {
                credentialClient.disconnect();
            }
        }
        rustplus.cameraClients = {};
        rustplus.cameraCredentialClients = {};

        rustplus.cameraCyclingActive = false;
        rustplus.cameraRayDataReceived = false;
    },

    cycleStep: async function (rustplus, client) {
        if (!rustplus.isOperational) {
            module.exports.stopCycling(rustplus);
            return;
        }

        const instance = client.getInstance(rustplus.guildId);
        const server = instance.serverList[rustplus.serverId];
        if (!server || !server.cameras || Object.keys(server.cameras).length === 0) {
            module.exports.stopCycling(rustplus);
            return;
        }

        const cameraSession = await module.exports.getCameraSession(rustplus, client, instance);
        if (!cameraSession) {
            if (!rustplus.cameraWaitingForPlayerInactiveLogged) {
                rustplus.cameraWaitingForPlayerInactiveLogged = true;
                rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'cameraWaitingForPlayerInactive'));
            }
            rustplus.cameraCyclingTaskId = setTimeout(
                module.exports.cycleStep, CAMERA_CYCLING_GAP_MS, rustplus, client);
            return;
        }
        rustplus.cameraWaitingForPlayerInactiveLogged = false;

        const cameraKeys = Object.keys(server.cameras);
        if (rustplus.cameraCyclingIndex >= cameraKeys.length) {
            rustplus.cameraCyclingIndex = 0;
        }

        const identifier = cameraKeys[rustplus.cameraCyclingIndex];
        const camera = server.cameras[identifier];

        /* Prune expired dedup entries */
        const now = Date.now();
        for (const key of Object.keys(rustplus.cameraSeenPlayers)) {
            if (now - rustplus.cameraSeenPlayers[key] > CAMERA_DEDUP_COOLDOWN_MS) {
                delete rustplus.cameraSeenPlayers[key];
            }
        }

        /* Subscribe to the camera */
        const cameraClientKey = `${cameraSession.steamId}:${identifier}`;
        if (!rustplus.cameraClients[cameraClientKey]) {
            rustplus.cameraClients[cameraClientKey] = cameraSession.session.getCamera(identifier);
        }
        const cameraClient = rustplus.cameraClients[cameraClientKey];
        const framePromise = module.exports.waitForCameraFrame(cameraClient, CAMERA_FRAME_CAPTURE_TIMEOUT_MS);
        const onCameraMessage = async message => {
            await module.exports.processCameraRays(rustplus, client, message);
        };
        if (cameraSession.session !== rustplus) {
            cameraSession.session.on('message', onCameraMessage);
        }

        try {
            await cameraClient.subscribe();
        }
        catch (e) {
            if (cameraSession.session !== rustplus) {
                cameraSession.session.off('message', onCameraMessage);
            }
            if (camera.reachable) {
                camera.reachable = false;
                client.setInstance(rustplus.guildId, instance);
                rustplus.log(client.intlGet(null, 'warningCap'),
                    client.intlGet(null, 'cameraUnreachableWithError', {
                        camera: identifier,
                        error: module.exports.formatError(e)
                    }));
            }

            rustplus.cameraCyclingIndex++;
            rustplus.cameraCyclingTaskId = setTimeout(
                module.exports.cycleStep, CAMERA_CYCLING_GAP_MS, rustplus, client);
            return;
        }

        camera.reachable = true;
        client.setInstance(rustplus.guildId, instance);

        rustplus.cameraCurrentSubscription = identifier;
        rustplus.cameraCurrentCamera = cameraClient;
        rustplus.cameraRayDataReceived = false;

        const frame = await framePromise;
        if (frame) {
            await module.exports.sendFrame(rustplus, client, identifier, camera, frame);
        }
        else {
            rustplus.log(client.intlGet(null, 'warningCap'),
                client.intlGet(null, 'cameraFrameTimedOut', { camera: identifier }));
        }

        /* Unsubscribe */
        await cameraClient.unsubscribe().catch(() => { /* Ignore */ });
        if (cameraSession.session !== rustplus) {
            cameraSession.session.off('message', onCameraMessage);
        }
        rustplus.cameraCurrentCamera = null;
        rustplus.cameraCurrentSubscription = null;

        /* Advance index and schedule next step */
        rustplus.cameraCyclingIndex++;
        rustplus.cameraCyclingTaskId = setTimeout(
            module.exports.cycleStep, CAMERA_CYCLING_GAP_MS, rustplus, client);
    },

    getCameraSession: async function (rustplus, client, instance) {
        const player = rustplus.team ? rustplus.team.getPlayer(rustplus.playerId) : null;
        if (!player || !player.isOnline) {
            return {
                session: rustplus,
                steamId: rustplus.playerId
            };
        }

        const liteServers = instance.serverListLite || {};
        const liteCredentials = liteServers[rustplus.serverId] || {};
        for (const [steamId, serverLite] of Object.entries(liteCredentials)) {
            if (steamId === rustplus.playerId) continue;

            const teamPlayer = rustplus.team ? rustplus.team.getPlayer(steamId) : null;
            if (teamPlayer && teamPlayer.isOnline) continue;

            const session = await module.exports.getCredentialCameraClient(rustplus, steamId, serverLite);
            if (!session) continue;

            if (rustplus.cameraCredentialSteamId !== steamId) {
                rustplus.cameraCredentialSteamId = steamId;
                rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'cameraUsingAlternateCredentials', {
                    steamId: steamId
                }));
            }

            return {
                session: session,
                steamId: steamId
            };
        }

        return null;
    },

    getCredentialCameraClient: async function (rustplus, steamId, serverLite) {
        if (rustplus.cameraCredentialClients[steamId]) {
            const client = rustplus.cameraCredentialClients[steamId];
            if (client.websocket && client.websocket.readyState === 1) return client;
            client.disconnect();
            delete rustplus.cameraCredentialClients[steamId];
        }

        const client = new RustPlusLib(
            serverLite.serverIp,
            serverLite.appPort,
            serverLite.steamId,
            serverLite.playerToken
        );

        try {
            await module.exports.connectCameraCredentialClient(client);
            await client.sendRequestAsync({ getInfo: {} }, 10000);
        }
        catch (e) {
            client.disconnect();
            return null;
        }

        rustplus.cameraCredentialClients[steamId] = client;
        return client;
    },

    connectCameraCredentialClient: function (client) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout reached while connecting camera credential'));
            }, 15000);
            const cleanup = () => {
                clearTimeout(timeoutId);
                client.off('connected', onConnected);
                client.off('error', onError);
            };
            const onConnected = () => {
                cleanup();
                resolve();
            };
            const onError = error => {
                cleanup();
                reject(error);
            };
            client.once('connected', onConnected);
            client.once('error', onError);
            client.connect();
        });
    },

    formatError: function (error) {
        if (!error) return 'unknown error';
        if (error.message) return error.message;
        try {
            return JSON.stringify(error);
        }
        catch (e) {
            return `${error}`;
        }
    },

    waitForCameraFrame: function (cameraClient, timeoutMs) {
        return new Promise(resolve => {
            const timeoutId = setTimeout(() => resolve(null), timeoutMs);
            cameraClient.once('render', frame => {
                clearTimeout(timeoutId);
                resolve(frame);
            });
        });
    },

    sendFrame: async function (rustplus, client, identifier, camera, frame) {
        const instance = client.getInstance(rustplus.guildId);
        const storedCamera = instance.serverList[rustplus.serverId]?.cameras?.[identifier];
        if (!storedCamera) return;

        storedCamera.frame = (storedCamera.frame || 0) + 1;
        client.setInstance(rustplus.guildId, instance);

        /* Save upscaled PNG to disk */
        const filePath = Path.join(__dirname, '..', '..', 'cameras',
            `${rustplus.guildId}_${identifier}.png`);
        const image = await Jimp.read(frame);
        image.resize(image.bitmap.width * CAMERA_FRAME_SCALE, image.bitmap.height * CAMERA_FRAME_SCALE,
            Jimp.RESIZE_NEAREST_NEIGHBOR);
        Fs.writeFileSync(filePath, await image.getBufferAsync(Jimp.MIME_PNG));

        /* Send/update frame in #cameras channel */
        const channelId = instance.channelId.cameras;
        const channel = DiscordTools.getTextChannelById(rustplus.guildId, channelId);
        if (!channel) {
            rustplus.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'cameraChannelNotFound'));
            return;
        }

        const content = {
            embeds: [DiscordEmbeds.getCameraFrameEmbed(rustplus.guildId, rustplus.serverId, identifier,
                storedCamera.name || camera.name, storedCamera.frame,
                rustplus.cameraVisiblePlayers[identifier] || [])],
            files: [new Discord.AttachmentBuilder(filePath, { name: `${identifier}.png` })],
        }

        if (storedCamera.messageId) {
            const existingMessage = await DiscordTools.getMessageById(
                rustplus.guildId, channelId, storedCamera.messageId);
            if (existingMessage) {
                await existingMessage.edit(content).catch(() => { /* Ignore */ });
                return;
            }
        }

        /* Previous message not found, send a new one */
        const sentMessage = await channel.send(content).catch(() => null);
        if (sentMessage) {
            storedCamera.messageId = sentMessage.id;
            client.setInstance(rustplus.guildId, instance);
        }
        else {
            rustplus.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'cameraFrameSendFailed', {
                camera: identifier
            }));
        }
    },

    processCameraRays: async function (rustplus, client, message) {
        if (!message.broadcast || !message.broadcast.cameraRays) return;
        if (!message.broadcast.cameraRays.entities) return;

        const instance = client.getInstance(rustplus.guildId);
        const serverId = rustplus.serverId;
        const server = instance.serverList[serverId];
        if (!server || !server.cameras) return;

        const identifier = rustplus.cameraCurrentSubscription;
        if (!identifier || !server.cameras[identifier]) return;

        const camera = server.cameras[identifier];
        const now = Date.now();
        const detectedPlayerNames = [];
        let unknownPlayerCount = 0;

        for (const entity of message.broadcast.cameraRays.entities) {
            if (entity.type !== 2 && entity.type !== 'Player') continue; /* Only Player entities */
            if (entity.name) {
                detectedPlayerNames.push(entity.name);
            }
            else {
                unknownPlayerCount += 1;
            }
        }

        const uniqueNamedPlayers = [...new Set(detectedPlayerNames)];
        const visiblePlayers = uniqueNamedPlayers.slice();
        if (unknownPlayerCount > 0) {
            visiblePlayers.push(client.intlGet(null, 'cameraUnknownPlayerCount', {
                count: `${unknownPlayerCount}`
            }));
        }
        rustplus.cameraVisiblePlayers[identifier] = visiblePlayers;
        if (uniqueNamedPlayers.length === 0) return;

        const lastAlert = rustplus.cameraLastPlayerAlert[identifier] || 0;
        if (now - lastAlert < CAMERA_DEDUP_COOLDOWN_MS) return;

        rustplus.cameraLastPlayerAlert[identifier] = now;
        const playerText = uniqueNamedPlayers.join(', ');

        rustplus.log(client.intlGet(null, 'infoCap'),
            client.intlGet(null, 'cameraPlayerSightedLog', {
                player: playerText,
                camera: camera.name
            }));

        await DiscordMessages.sendCameraPlayerSightingMessage(
            rustplus.guildId, serverId, identifier, camera.name, playerText);
    }
};
