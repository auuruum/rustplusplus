const Test = require('node:test');
const Assert = require('node:assert/strict');

const BattlemetricsAuth = require('../src/util/battlemetricsAuth.js');

Test('detects whether an operator supplied a BattleMetrics token', () => {
    Assert.equal(BattlemetricsAuth.hasBattlemetricsToken(undefined), false);
    Assert.equal(BattlemetricsAuth.hasBattlemetricsToken(''), false);
    Assert.equal(BattlemetricsAuth.hasBattlemetricsToken('   '), false);
    Assert.equal(BattlemetricsAuth.hasBattlemetricsToken(' token-value '), true);
});

Test('does not add an authorization config without a token', () => {
    Assert.equal(BattlemetricsAuth.buildBattlemetricsRequestConfig(''), undefined);
    Assert.deepEqual(BattlemetricsAuth.buildBattlemetricsRequestConfig(' token-value '), {
        headers: { Authorization: 'Bearer token-value' }
    });
});
