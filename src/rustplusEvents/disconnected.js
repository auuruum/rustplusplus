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

const DiscordMessages = require('../discordTools/discordMessages.js');

const Config = require('../../config');

module.exports = {
    name: 'disconnected',
    async execute(rustplus, client) {
        if (!rustplus.isServerAvailable() && !rustplus.isDeleted) {
            rustplus.deleteThisRustplusInstance();
        }

        rustplus.log(client.intlGet(null, 'disconnectedCap'), client.intlGet(null, 'disconnectedFromServer'));
        rustplus.isOperational = false;

        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        if (rustplus.leaderRustPlusInstance !== null) {
            if (client.rustplusLiteReconnectTimers[guildId]) {
                clearTimeout(client.rustplusLiteReconnectTimers[guildId]);
                client.rustplusLiteReconnectTimers[guildId] = null;
            }
            rustplus.leaderRustPlusInstance.isActive = false;
            rustplus.leaderRustPlusInstance.disconnect();
            rustplus.leaderRustPlusInstance = null;
        }

        /* Stop current tasks */
        clearInterval(rustplus.pollingTaskId);
        clearInterval(rustplus.tokensReplenishTaskId);
        clearTimeout(rustplus.inGameChatTimeout);

        /* Stop camera cycling */
        const CameraHandler = require('../handlers/cameraHandler.js');
        CameraHandler.stopCycling(rustplus);

        /* Reset map markers, timers & arrays */
        if (rustplus.mapMarkers) rustplus.mapMarkers.reset();

        /* Stop all custom timers */
        for (const [id, timer] of Object.entries(rustplus.timers)) timer.timer.stop();

        if (rustplus.isDeleted) return;

        /* Was the disconnection unexpected? */
        if (client.activeRustplusInstances[guildId]) {
            if (!client.rustplusReconnecting[guildId]) {
                await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, 1);
                await DiscordMessages.sendServerMessage(guildId, serverId, 2);
            }

            client.rustplusReconnecting[guildId] = true;

            rustplus.log(client.intlGet(null, 'reconnectingCap'), client.intlGet(null, 'reconnectingToServer'));

            /* Stash per-player timer state so it can be restored after reconnect,
               preventing AFK/offline timers from resetting due to a network blip
               or daily server reboot. */
            if (rustplus.team !== null) {
                if (!client.rustplusPlayerStash) client.rustplusPlayerStash = {};
                client.rustplusPlayerStash[guildId] = {};
                for (const player of rustplus.team.players) {
                    client.rustplusPlayerStash[guildId][player.steamId] = {
                        lastMovement: player.lastMovement,
                        wentOfflineTime: player.wentOfflineTime,
                    };
                }
            }

            client.streamDeckBridge?.broadcastSnapshot(
                guildId,
                ['server', 'time', 'pop', 'switches', 'alarms', 'switchgroups', 'storagemonitors', 'trackers'],
                'immediate_update'
            );

            delete client.rustplusInstances[guildId];

            if (client.rustplusReconnectTimers[guildId]) {
                clearTimeout(client.rustplusReconnectTimers[guildId]);
                client.rustplusReconnectTimers[guildId] = null;
            }

            const attempts = client.rustplusReconnectAttempts[guildId] || 0;
            const delay = Math.min(
                Config.general.reconnectIntervalMs * Math.pow(2, attempts),
                300000 /* 5 min cap */
            );
            client.rustplusReconnectAttempts[guildId] = attempts + 1;

            rustplus.log(client.intlGet(null, 'reconnectingCap'),
                `Reconnect attempt ${attempts + 1}, waiting ${delay / 1000}s`);

            client.rustplusReconnectTimers[guildId] = setTimeout(
                client.createRustplusInstance.bind(client),
                delay,
                guildId,
                rustplus.server,
                rustplus.port,
                rustplus.playerId,
                rustplus.playerToken
            );
        }
    },
};
