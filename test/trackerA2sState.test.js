const Test = require('node:test');
const Assert = require('node:assert/strict');

const TrackerA2sState = require('../src/util/trackerA2sState.js');

Test('first successful roster creates baseline without notifications', () => {
    const result = TrackerA2sState.evaluate({}, [{ key: '1', name: 'Alice' }], {
        available: true,
        nameCounts: { Alice: 1 }
    });

    Assert.deepEqual(result.events, []);
    Assert.equal(result.state['1'].online, true);
});

Test('emits login and logout after baseline', () => {
    const previous = { '1': { online: false, initialized: true } };
    const login = TrackerA2sState.evaluate(previous, [{ key: '1', name: 'Alice' }], {
        available: true,
        nameCounts: { Alice: 1 }
    });
    Assert.deepEqual(login.events, [{ key: '1', type: 'login', name: 'Alice' }]);

    const logout = TrackerA2sState.evaluate(login.state, [{ key: '1', name: 'Alice' }], {
        available: true,
        nameCounts: {}
    });
    Assert.deepEqual(logout.events, [{ key: '1', type: 'logout', name: 'Alice' }]);
});

Test('duplicate A2S names are ambiguous and do not change status', () => {
    const previous = { '1': { online: false, initialized: true } };
    const result = TrackerA2sState.evaluate(previous, [{ key: '1', name: 'Alice' }], {
        available: true,
        nameCounts: { Alice: 2 }
    });

    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.ambiguous, ['1']);
    Assert.equal(result.state['1'].online, false);
});

Test('unavailable roster preserves previous state', () => {
    const previous = { '1': { online: true, initialized: true } };
    const result = TrackerA2sState.evaluate(previous, [{ key: '1', name: 'Alice' }], {
        available: false,
        nameCounts: {}
    });

    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.state, previous);
});

Test('cached roster never emits live transitions', () => {
    const previous = { '1': { online: false, initialized: true } };
    const result = TrackerA2sState.evaluate(previous, [{ key: '1', name: 'Alice' }], {
        available: true,
        complete: true,
        cached: true,
        liveTransitionEligible: false,
        nameCounts: { Alice: 1 }
    });

    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.state, previous);
});

Test('incomplete roster never emits offline transitions', () => {
    const previous = { '1': { online: true, initialized: true } };
    const result = TrackerA2sState.evaluate(previous, [{ key: '1', name: 'Alice' }], {
        available: true,
        complete: false,
        nameCounts: {}
    });

    Assert.deepEqual(result.events, []);
    Assert.deepEqual(result.state, previous);
});
