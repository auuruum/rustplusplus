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

const Axios = require('axios');

const Constants = require('../util/constants.js');
const Utils = require('../util/utils.js');

const STEAM_COMMUNITY_REQUEST_OPTIONS = {
    headers: {
        'Accept': 'application/xml,text/xml;q=0.9,text/html;q=0.8,*/*;q=0.7',
        'User-Agent': 'RustPlusPlus/1.26.1 (+https://github.com/alexemanuelol/rustplusplus)'
    }
};

const STEAM_PROFILE_PRESENCE_CACHE = new Map();
const STEAM_PROFILE_PRESENCE_CACHE_TTL_MS = 60 * 1000;

function parseSteamProfilePresenceHtml(data) {
    if (typeof data !== 'string') return null;
    const nameMatch = data.match(/class="actual_persona_name">([\s\S]*?)<\/span>/i);
    const gameMatch = data.match(/class="profile_in_game_name">([\s\S]*?)<\/div>/i);
    const joinBlock = data.match(/class="profile_in_game_joingame">([\s\S]*?)<\/div>/i);
    const connectMatch = joinBlock && joinBlock[1].match(/steam:\/\/connect\/([a-z0-9.-]+):(\d{1,5})/i);
    const port = connectMatch ? Number(connectMatch[2]) : null;
    const connect = connectMatch && Number.isInteger(port) && port > 0 && port <= 65535 ?
        `connect ${connectMatch[1]}:${port}` : null;
    return {
        name: nameMatch ? Utils.decodeHtml(nameMatch[1].trim()) : null,
        game: gameMatch ? Utils.decodeHtml(gameMatch[1].trim()) : null,
        connect
    };
}

module.exports = {
    scrape: async function (url, options = {}) {
        try {
            return await Axios.get(url, options);
        }
        catch (e) {
            return {};
        }
    },

    scrapeSteamProfilePicture: async function (client, steamId) {
        const response = await module.exports.scrape(
            `${Constants.STEAM_PROFILES_URL}${steamId}`, STEAM_COMMUNITY_REQUEST_OPTIONS);

        if (response.status !== 200) {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfilePicture', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            return null;
        }

        let png = response.data.match(/<img src="(.*_full.jpg)(.*?(?="))/);
        if (png) {
            return png[1];
        }

        return null;
    },

    scrapeSteamProfileName: async function (client, steamId) {
        const response = await module.exports.scrape(
            `${Constants.STEAM_PROFILES_URL}${steamId}`, STEAM_COMMUNITY_REQUEST_OPTIONS);

        if (response.status !== 200) {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfileName', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            return null;
        }

        let regex = new RegExp(`class="actual_persona_name">(.+?)</span>`, 'gm');
        let data = regex.exec(response.data);
        if (data) {
            return Utils.decodeHtml(data[1]);
        }

        return null;
    },

    scrapeSteamProfilePresence: async function (client, steamId, options = {}) {
        const cacheKey = `${steamId}`;
        const now = options.now ? options.now() : Date.now();
        const cached = STEAM_PROFILE_PRESENCE_CACHE.get(cacheKey);
        if (!options.noCache && cached && cached.expiresAt > now) return cached.value;

        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`, {
            ...STEAM_COMMUNITY_REQUEST_OPTIONS,
            timeout: options.timeoutMs || 10000
        });
        let value;
        if (response.status !== 200 || typeof response.data !== 'string') {
            value = {
                available: false,
                steamId: cacheKey,
                observedAt: now,
                reason: 'Steam Community profile was unavailable.'
            };
        }
        else {
            const parsed = parseSteamProfilePresenceHtml(response.data);
            value = {
                available: parsed !== null,
                steamId: cacheKey,
                observedAt: now,
                name: parsed ? parsed.name : null,
                game: parsed ? parsed.game : null,
                connect: parsed ? parsed.connect : null,
                reason: parsed === null ? 'Steam Community profile response was invalid.' : null
            };
        }
        if (!options.noCache && value.available) {
            STEAM_PROFILE_PRESENCE_CACHE.set(cacheKey, {
                expiresAt: now + (options.cacheTtlMs || STEAM_PROFILE_PRESENCE_CACHE_TTL_MS),
                value
            });
        }
        return value;
    },

    scrapeSteamIdFromVanity: async function (client, vanity) {
        if (typeof vanity !== 'string' || vanity.trim() === '') return null;

        const url = `https://steamcommunity.com/id/${encodeURIComponent(vanity.trim())}/?xml=1`;
        const response = await module.exports.scrape(url, STEAM_COMMUNITY_REQUEST_OPTIONS);

        if (response.status !== 200 || typeof response.data !== 'string') {
            return null;
        }

        const steamId64Match = response.data.match(/<steamID64>(\d{17})<\/steamID64>/i);
        if (steamId64Match) {
            return steamId64Match[1];
        }

        const profileLinkMatch = response.data.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
        if (profileLinkMatch) {
            return profileLinkMatch[1];
        }

        return null;
    },

    parseSteamProfilePresenceHtml,
}
