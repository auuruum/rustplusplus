const test = require('node:test');
const assert = require('node:assert/strict');

const TimeProfiles = require('../src/util/timeProfiles.js');
const Time = require('../src/structures/Time.js');

function createContext(server = {}) {
    const storedServer = {
        timeProfile: 'auto',
        timeTillDay: null,
        timeTillNight: null,
        ...server
    };
    const instance = { serverList: { server: storedServer } };
    const client = {
        getInstance: () => instance,
        setInstance: () => {},
        intlGet: (_guildId, key) => key
    };
    const rustplus = {
        guildId: 'guild',
        serverId: 'server',
        sendInGameMessage: () => {}
    };
    return { client, rustplus, storedServer };
}

const vanillaTime = {
    dayLengthMinutes: 60,
    timeScale: 1,
    sunrise: 7.6,
    sunset: 19.95,
    time: 12
};

test('normalizes supported time profile modes and defaults invalid values to auto', () => {
    assert.equal(TimeProfiles.normalizeMode('AUTO'), 'auto');
    assert.equal(TimeProfiles.normalizeMode('vanilla'), 'vanilla');
    assert.equal(TimeProfiles.normalizeMode('learn'), 'learn');
    assert.equal(TimeProfiles.normalizeMode('something-else'), 'auto');
});

test('recognizes a plausible vanilla Rust time payload', () => {
    assert.equal(TimeProfiles.isVanillaCandidate(vanillaTime), true);
    assert.equal(TimeProfiles.isVanillaCandidate({ ...vanillaTime, timeScale: 2 }), false);
    assert.equal(TimeProfiles.isVanillaCandidate({ ...vanillaTime, sunrise: 12 }), false);
});

test('vanilla estimate reaches zero at sunrise and sunset', () => {
    assert.equal(TimeProfiles.getVanillaSecondsTillTransition({ ...vanillaTime, time: vanillaTime.sunrise }), 3000);
    assert.equal(TimeProfiles.getVanillaSecondsTillTransition({ ...vanillaTime, time: vanillaTime.sunset }), 600);

    const beforeSunset = TimeProfiles.getVanillaSecondsTillTransition({
        ...vanillaTime,
        time: vanillaTime.sunset - 0.001
    });
    const beforeSunrise = TimeProfiles.getVanillaSecondsTillTransition({
        ...vanillaTime,
        time: vanillaTime.sunrise - 0.001
    });
    assert.ok(beforeSunset >= 0 && beforeSunset < 5);
    assert.ok(beforeSunrise >= 0 && beforeSunrise < 5);
});

test('auto mode provides an estimate immediately while learn mode does not', () => {
    const autoContext = createContext({ timeProfile: 'auto' });
    const autoTime = new Time(vanillaTime, autoContext.rustplus, autoContext.client);
    assert.equal(autoTime.timeProfileStatus, 'auto');
    assert.match(autoTime.getTimeTillDayOrNight(), /^\d/);

    const learnContext = createContext({ timeProfile: 'learn' });
    const learnTime = new Time(vanillaTime, learnContext.rustplus, learnContext.client);
    assert.equal(learnTime.timeProfileStatus, 'learning');
    assert.equal(learnTime.getTimeTillDayOrNight(), null);
});

test('runtime mode changes immediately update estimate availability', () => {
    const context = createContext({ timeProfile: 'auto' });
    const time = new Time(vanillaTime, context.rustplus, context.client, 0);

    time.setTimeProfileMode('learn', 1000);
    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);

    time.setTimeProfileMode('vanilla', 2000);
    assert.equal(time.timeProfileStatus, 'vanilla');
    assert.match(time.getTimeTillDayOrNight(), /^\d/);
});

test('forced vanilla mode can estimate even when auto rejects the server fingerprint', () => {
    const context = createContext({ timeProfile: 'vanilla' });
    const time = new Time({ ...vanillaTime, timeScale: 2 }, context.rustplus, context.client);
    assert.equal(TimeProfiles.isVanillaCandidate({ ...vanillaTime, timeScale: 2 }), false);
    assert.equal(time.timeProfileStatus, 'vanilla');
    assert.match(time.getTimeTillDayOrNight(), /^\d/);
});

test('saved learned tables remain exact and take priority over configured mode', () => {
    const context = createContext({
        timeProfile: 'auto',
        timeTillDay: { '2': 100 },
        timeTillNight: { '12': 200 }
    });
    const time = new Time(vanillaTime, context.rustplus, context.client);
    assert.equal(time.timeProfileStatus, 'learned');
    assert.equal(time.getTimeTillDayOrNight(), '3m 20s');
});

test('keeps the existing command wording compatible with compact profile markers', () => {
    assert.equal(TimeProfiles.markEstimatedRemaining('31m', 'auto'), '~31m');
    assert.equal(TimeProfiles.markEstimatedRemaining('31m', 'vanilla'), '~31m');
    assert.equal(TimeProfiles.markEstimatedRemaining('31m', 'learned'), '31m');
    assert.equal(TimeProfiles.getCommandStatusSuffix('auto'), ' [auto]');
    assert.equal(TimeProfiles.getCommandStatusSuffix('vanilla'), ' [vanilla]');
    assert.equal(TimeProfiles.getCommandStatusSuffix('learning'), ' [learning]');
    assert.equal(TimeProfiles.getCommandStatusSuffix('learned'), '');
});

test('auto estimate is rejected immediately when a server skips game time', () => {
    const context = createContext({ timeProfile: 'auto' });
    const time = new Time({ ...vanillaTime, time: 19.9 }, context.rustplus, context.client, 0);

    time.updateTime({ ...vanillaTime, time: 7.7 }, 10000);

    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);
});

test('auto estimate is rejected after sustained clock drift', () => {
    const context = createContext({ timeProfile: 'auto' });
    const time = new Time({ ...vanillaTime, time: 20 }, context.rustplus, context.client, 0);
    assert.equal(time.timeProfileStatus, 'auto');

    time.updateTime({ ...vanillaTime, time: 20.03 }, 10000);
    time.updateTime({ ...vanillaTime, time: 20.06 }, 20000);
    time.updateTime({ ...vanillaTime, time: 20.09 }, 30000);
    time.updateTime({ ...vanillaTime, time: 20.12 }, 40000);

    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);
});
