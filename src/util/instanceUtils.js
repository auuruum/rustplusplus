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

const Fs = require('fs');
const Path = require('path');

const Client = require('../../index.ts');

module.exports = {
    getSmartDevice: function (guildId, entityId) {
        /* Temporary function till discord modals gets more functional */
        const instance = Client.client.getInstance(guildId);

        for (const serverId in instance.serverList) {
            for (const switchId in instance.serverList[serverId].switches) {
                if (entityId === switchId) return { type: 'switch', serverId: serverId }
            }
            for (const alarmId in instance.serverList[serverId].alarms) {
                if (entityId === alarmId) return { type: 'alarm', serverId: serverId }
            }
            for (const storageMonitorId in instance.serverList[serverId].storageMonitors) {
                if (entityId === storageMonitorId) return { type: 'storageMonitor', serverId: serverId }
            }
        }
        return null;
    },

    readInstanceFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        return JSON.parse(Fs.readFileSync(path, 'utf8'));
    },

    writeInstanceFile: function (guildId, instance) {
        const path = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        Fs.writeFileSync(path, JSON.stringify(instance, null, 2));
    },

    readCredentialsFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        // Ensure the credentials directory exists
        const dir = Path.dirname(path);
        if (!Fs.existsSync(dir)) {
            try { Fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* Ignore */ }
        }
        // If the credentials file doesn't exist, create a default and return it
        if (!Fs.existsSync(path)) {
            const defaultCredentials = { hoster: null };
            try { Fs.writeFileSync(path, JSON.stringify(defaultCredentials, null, 2)); } catch (e) { /* Ignore */ }
            return defaultCredentials;
        }
        // Read and parse credentials file safely
        try {
            return JSON.parse(Fs.readFileSync(path, 'utf8'));
        } catch (e) {
            // If parsing fails for any reason, fall back to a safe default
            return { hoster: null };
        }
    },

    writeCredentialsFile: function (guildId, credentials) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        Fs.writeFileSync(path, JSON.stringify(credentials, null, 2));
    },

    deleteInstanceFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        if (Fs.existsSync(path)) {
            try { Fs.unlinkSync(path); } catch (e) { /* Ignore */ }
        }
    },

    deleteCredentialsFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        if (Fs.existsSync(path)) {
            try { Fs.unlinkSync(path); } catch (e) { /* Ignore */ }
        }
    },
}
