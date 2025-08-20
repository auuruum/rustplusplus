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

module.exports = {
    name: 'guildDelete',
    async execute(client, guild) {
        try {
            // Log removal
            client.log(client.intlGet(null, 'infoCap'), `Bot removed from guild ${guild.id}`);
        } catch (_) { /* ignore */ }

        // Cancel any pending activation timeout if stored
        try {
            if (!client.guildActivationTimeouts) client.guildActivationTimeouts = {};
            if (client.guildActivationTimeouts[guild.id]) {
                clearTimeout(client.guildActivationTimeouts[guild.id]);
                delete client.guildActivationTimeouts[guild.id];
            }
        } catch (_) { /* ignore */ }

        // Clean up local files and memory for this guild
        try {
            const InstanceUtils = require('../util/instanceUtils');
            try { InstanceUtils.deleteInstanceFile(guild.id); } catch (_) {}
            try { InstanceUtils.deleteCredentialsFile(guild.id); } catch (_) {}
        } catch (_) { /* ignore */ }

        try {
            // Reset rustplus state and clear references
            if (typeof client.resetRustplusVariables === 'function') {
                client.resetRustplusVariables(guild.id);
            }
            if (client.rustplusInstances && client.rustplusInstances[guild.id]) {
                try { client.rustplusInstances[guild.id].disconnect && client.rustplusInstances[guild.id].disconnect(); } catch (_) {}
                delete client.rustplusInstances[guild.id];
            }
            if (client.activeRustplusInstances) delete client.activeRustplusInstances[guild.id];
            if (client.rustplusReconnecting) delete client.rustplusReconnecting[guild.id];
            if (client.rustplusMaps) delete client.rustplusMaps[guild.id];
        } catch (_) { /* ignore */ }

        try {
            // Remove FCM listeners
            if (client.fcmListeners) delete client.fcmListeners[guild.id];
            if (client.fcmListenersLite) delete client.fcmListenersLite[guild.id];
        } catch (_) { /* ignore */ }

        try {
            // Remove intl cache for guild
            if (client.guildIntl && client.guildIntl[guild.id]) delete client.guildIntl[guild.id];
        } catch (_) { /* ignore */ }
    },
};