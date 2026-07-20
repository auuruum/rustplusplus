const test = require('node:test');
const assert = require('node:assert/strict');

const TimeProfiles = require('../src/util/timeProfiles.js');
const Time = require('../src/structures/Time.js');

function createContext(server = {}) {
    const storedServer = {
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

function findDayTimeForRemaining(targetSeconds) {
    let low = vanillaTime.sunrise;
    let high = vanillaTime.sunset;
    for (let i = 0; i < 60; i++) {
        const middle = (low + high) / 2;
        const remaining = TimeProfiles.getVanillaSecondsTillTransition({ ...vanillaTime, time: middle });
        if (remaining > targetSeconds) low = middle;
        else high = middle;
    }
    return (low + high) / 2;
}

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

test('starts in auto and automatically confirms vanilla after matching samples', () => {
    const context = createContext({ timeProfile: 'learn' });
    const time = new Time(vanillaTime, context.rustplus, context.client, 0);
    assert.equal(time.timeProfileStatus, 'auto');
    assert.match(time.getTimeTillDayOrNight(), /^\d/);

    const initialRemaining = TimeProfiles.getVanillaSecondsTillTransition(vanillaTime);
    for (let i = 1; i <= 3; i++) {
        time.updateTime({ ...vanillaTime, time: findDayTimeForRemaining(initialRemaining - (i * 10)) }, i * 10000);
    }

    assert.equal(time.timeProfileStatus, 'vanilla');
    assert.match(time.getTimeTillDayOrNight(), /^\d/);
});

test('starts learning immediately when the first payload is not vanilla-compatible', () => {
    const context = createContext();
    const time = new Time({ ...vanillaTime, timeScale: 2 }, context.rustplus, context.client);
    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);
});

test('saved learned tables remain exact and take priority over automatic detection', () => {
    const context = createContext({
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
    const context = createContext();
    const time = new Time({ ...vanillaTime, time: 19.9 }, context.rustplus, context.client, 0);

    time.updateTime({ ...vanillaTime, time: 7.7 }, 10000);

    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);
});

test('confirmed vanilla falls back to learning if later clock speed diverges', () => {
    const context = createContext();
    const time = new Time(vanillaTime, context.rustplus, context.client, 0);
    const initialRemaining = TimeProfiles.getVanillaSecondsTillTransition(vanillaTime);

    for (let i = 1; i <= 3; i++) {
        time.updateTime({ ...vanillaTime, time: findDayTimeForRemaining(initialRemaining - (i * 10)) }, i * 10000);
    }
    assert.equal(time.timeProfileStatus, 'vanilla');

    const confirmedTime = time.time;
    for (let i = 1; i <= 4; i++) {
        time.updateTime({ ...vanillaTime, time: confirmedTime + (i * 0.001) }, (i + 3) * 10000);
    }

    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);
});

test('auto estimate is rejected after sustained clock drift', () => {
    const context = createContext();
    const time = new Time({ ...vanillaTime, time: 20 }, context.rustplus, context.client, 0);
    assert.equal(time.timeProfileStatus, 'auto');

    time.updateTime({ ...vanillaTime, time: 20.03 }, 10000);
    time.updateTime({ ...vanillaTime, time: 20.06 }, 20000);
    time.updateTime({ ...vanillaTime, time: 20.09 }, 30000);
    time.updateTime({ ...vanillaTime, time: 20.12 }, 40000);

    assert.equal(time.timeProfileStatus, 'learning');
    assert.equal(time.getTimeTillDayOrNight(), null);
});
