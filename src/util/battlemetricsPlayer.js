const Axios = require('axios');

const Config = require('../../config');
const {
    buildBattlemetricsRequestConfig,
    getBattlemetricsRequestFailureDetails
} = require('./battlemetricsAuth.js');

function findSteamId(data) {
    const included = Array.isArray(data?.included) ? data.included : [];

    for (const entity of included) {
        const attributes = entity?.attributes || {};
        const type = `${attributes.type || ''}`.toLowerCase();
        const identifier = `${attributes.identifier || ''}`;

        if ((type === 'steamid' || type === 'steamid64' || type === 'steam') && /^\d{17}$/.test(identifier)) {
            return identifier;
        }
    }

    return null;
}

module.exports = {
    findSteamId,

    resolveSteamIdFromPlayerId: async function (playerId) {
        try {
            const url = `https://api.battlemetrics.com/players/${playerId}?include=identifier`;
            const response = await Axios.get(url, buildBattlemetricsRequestConfig(Config.battlemetrics.token));
            return findSteamId(response.data);
        }
        catch (e) {
            const details = getBattlemetricsRequestFailureDetails(e);
            throw new Error(`Could not resolve BattleMetrics player ${playerId} to SteamID${details}`);
        }
    }
};

if (require.main === module) {
    const assert = require('assert');

    assert.strictEqual(findSteamId({
        included: [
            { type: 'identifier', attributes: { type: 'name', identifier: 'foo' } },
            { type: 'identifier', attributes: { type: 'steamID', identifier: '76561198114074446' } }
        ]
    }), '76561198114074446');

    assert.strictEqual(findSteamId({ included: [] }), null);
}
