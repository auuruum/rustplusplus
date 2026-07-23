function normalizeBattlemetricsToken(token) {
    if (typeof token !== 'string') return '';
    return token.trim();
}

function hasBattlemetricsToken(token) {
    return normalizeBattlemetricsToken(token) !== '';
}

function buildBattlemetricsRequestConfig(token) {
    const normalizedToken = normalizeBattlemetricsToken(token);
    if (!normalizedToken) return undefined;

    return {
        headers: {
            Authorization: `Bearer ${normalizedToken}`
        }
    };
}

function getBattlemetricsRequestFailureDetails(error) {
    if (!error) return '';
    if (error.response && error.response.status) return ` status=${error.response.status}`;
    if (error.code) return ` code=${error.code}`;
    if (error.message) return ` message=${error.message}`;
    return '';
}

module.exports = {
    hasBattlemetricsToken,
    buildBattlemetricsRequestConfig,
    getBattlemetricsRequestFailureDetails
};
