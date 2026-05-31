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

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) {
            continue;
        }

        const key = match[1];
        let value = match[2].trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function getString(key, fallback) {
    return process.env[key] ?? fallback;
}

function getNumber(key, fallback) {
    const value = Number(process.env[key]);
    return Number.isFinite(value) ? value : fallback;
}

function getBoolean(key, fallback) {
    const value = process.env[key];
    if (value === undefined) {
        return fallback;
    }

    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

loadEnvFile();

module.exports = {
    general: {
        language: getString('RPP_LANGUAGE', 'en'),
        pollingIntervalMs: getNumber('RPP_POLLING_INTERVAL', 10000),
        showCallStackError: getBoolean('RPP_LOG_CALL_STACK', false),
        reconnectIntervalMs: getNumber('RPP_RECONNECT_INTERVAL', 15000),
    },
    discord: {
        username: getString('RPP_DISCORD_USERNAME', 'rustplusplus'),
        clientId: getString('RPP_DISCORD_CLIENT_ID', ''),
        token: getString('RPP_DISCORD_TOKEN', ''),
        needAdminPrivileges: getBoolean('RPP_NEED_ADMIN_PRIVILEGES', true),
    },
    battlemetrics: {
        token: getString('RPP_BATTLEMETRICS_TOKEN', ''),
    },
    streamDeck: {
        enabled: getBoolean('RPP_STREAM_DECK_ENABLED', false),
        host: getString('RPP_STREAM_DECK_HOST', 'localhost'),
        port: getNumber('RPP_STREAM_DECK_PORT', 8074),
        apiPasswords: getString('RPP_STREAM_DECK_API_PASSWORDS', ''),
    }
};
