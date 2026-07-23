function findServerByBattlemetricsId(instance, battlemetricsId) {
    const serverList = instance && instance.serverList ? instance.serverList : {};
    const activeServerId = instance && instance.activeServer;
    if (activeServerId !== null && activeServerId !== undefined && serverList[activeServerId] &&
        `${serverList[activeServerId].battlemetricsId}` === `${battlemetricsId}`) {
        return [activeServerId, serverList[activeServerId]];
    }
    return Object.entries(serverList)
        .find(([, server]) => `${server.battlemetricsId}` === `${battlemetricsId}`) || null;
}

function resolve(instance, rustplus, providedBattlemetricsId) {
    if (providedBattlemetricsId) {
        const serverEntry = findServerByBattlemetricsId(instance, providedBattlemetricsId);
        return {
            available: true,
            battlemetricsId: `${providedBattlemetricsId}`,
            serverId: serverEntry ? serverEntry[0] : null,
            server: serverEntry ? serverEntry[1] : null
        };
    }

    if (!rustplus || rustplus.isOperational !== true) {
        return { available: false, reason: 'not_connected' };
    }

    const serverId = rustplus.serverId;
    const server = instance && instance.serverList ? instance.serverList[serverId] : null;
    if (!server) return { available: false, reason: 'server_missing' };

    const configuredBattlemetricsId = server.battlemetricsId === null || server.battlemetricsId === undefined ?
        '' : `${server.battlemetricsId}`.trim();
    return {
        available: true,
        battlemetricsId: configuredBattlemetricsId || `rustplus:${serverId}`,
        serverId,
        server
    };
}

module.exports = { findServerByBattlemetricsId, resolve };
