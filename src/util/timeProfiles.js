/*
    Copyright (C) 2026 FaiThiX

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/

const MODES = Object.freeze({
    AUTO: 'auto',
    VANILLA: 'vanilla',
    LEARN: 'learn'
});

/*
 * The Rust clock is not linear. These curves are normalized from a vanilla
 * server cycle and map game-time progress to real-time progress. The actual
 * duration still comes from AppTime.dayLengthMinutes, so 60- and 80-minute
 * vanilla cycles use the same curve without hard-coding a server address.
 */
const DAY_CURVE = Object.freeze([
    [0.000, 0.000],
    [0.042, 0.009],
    [0.132, 0.057],
    [0.209, 0.151],
    [0.287, 0.245],
    [0.367, 0.340],
    [0.448, 0.434],
    [0.530, 0.528],
    [0.610, 0.623],
    [0.690, 0.717],
    [0.771, 0.811],
    [0.847, 0.906],
    [0.884, 0.953],
    [1.000, 1.000]
]);

const NIGHT_CURVE = Object.freeze([
    [0.000, 0.000],
    [0.369, 0.357],
    [0.649, 0.589],
    [0.816, 0.696],
    [0.828, 0.714],
    [0.897, 0.821],
    [1.000, 1.000]
]);

function normalizeMode(mode) {
    const normalized = `${mode || ''}`.trim().toLowerCase();
    return Object.values(MODES).includes(normalized) ? normalized : MODES.AUTO;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasUsableTimePayload(time) {
    return Boolean(time) && ['dayLengthMinutes', 'timeScale', 'sunrise', 'sunset', 'time']
        .every(key => isFiniteNumber(time[key])) &&
        time.dayLengthMinutes > 0 &&
        time.sunrise >= 0 && time.sunrise < 24 &&
        time.sunset >= 0 && time.sunset < 24 &&
        time.sunrise < time.sunset &&
        time.time >= 0 && time.time < 24;
}

function isVanillaCandidate(time) {
    if (!hasUsableTimePayload(time)) {
        return false;
    }

    return time.dayLengthMinutes >= 45 && time.dayLengthMinutes <= 120 &&
        time.timeScale >= 0.95 && time.timeScale <= 1.05 &&
        time.sunrise >= 5 && time.sunrise <= 10 &&
        time.sunset >= 17 && time.sunset <= 22 &&
        time.sunrise < time.sunset &&
        time.time >= 0 && time.time < 24;
}

function interpolateCurve(curve, progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    for (let i = 1; i < curve.length; i += 1) {
        const [rightX, rightY] = curve[i];
        if (clamped <= rightX) {
            const [leftX, leftY] = curve[i - 1];
            const width = rightX - leftX;
            if (width === 0) return rightY;
            const localProgress = (clamped - leftX) / width;
            return leftY + (rightY - leftY) * localProgress;
        }
    }
    return 1;
}

function cyclicDistance(start, end) {
    return end >= start ? end - start : (24 - start) + end;
}

function getVanillaDurations(time) {
    const totalSeconds = Math.max(60, time.dayLengthMinutes * 60);
    /* Facepunch's default is a ten-minute night; short custom cycles scale it. */
    const nightSeconds = Math.min(10 * 60, totalSeconds / 6);
    return {
        daySeconds: totalSeconds - nightSeconds,
        nightSeconds
    };
}

function getVanillaSecondsTillTransition(time) {
    if (!hasUsableTimePayload(time)) return null;

    const { daySeconds, nightSeconds } = getVanillaDurations(time);
    const isDay = time.time >= time.sunrise && time.time < time.sunset;

    if (isDay) {
        const gameDuration = time.sunset - time.sunrise;
        const gameProgress = (time.time - time.sunrise) / gameDuration;
        const elapsedProgress = interpolateCurve(DAY_CURVE, gameProgress);
        return Math.max(0, Math.round(daySeconds * (1 - elapsedProgress)));
    }

    const gameDuration = cyclicDistance(time.sunset, time.sunrise);
    const gameProgress = cyclicDistance(time.sunset, time.time) / gameDuration;
    const elapsedProgress = interpolateCurve(NIGHT_CURVE, gameProgress);
    return Math.max(0, Math.round(nightSeconds * (1 - elapsedProgress)));
}

function markEstimatedRemaining(timeRemaining, status) {
    return status === MODES.AUTO || status === MODES.VANILLA ? `~${timeRemaining}` : timeRemaining;
}

function getCommandStatusSuffix(status) {
    if (status === MODES.AUTO || status === MODES.VANILLA || status === 'learning') {
        return ` [${status}]`;
    }
    return '';
}

module.exports = {
    MODES,
    normalizeMode,
    isVanillaCandidate,
    getVanillaDurations,
    getVanillaSecondsTillTransition,
    markEstimatedRemaining,
    getCommandStatusSuffix
};
