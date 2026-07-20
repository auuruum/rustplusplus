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

const TimeLib = require('../util/timer.js');
const TimeProfiles = require('../util/timeProfiles.js');

class Time {
    constructor(time, rustplus, client, observedAtMs = Date.now()) {
        this._dayLengthMinutes = time.dayLengthMinutes;
        this._timeScale = time.timeScale;
        this._sunrise = time.sunrise;
        this._sunset = time.sunset;
        this._time = time.time;

        this._rustplus = rustplus;
        this._client = client;

        this._startTime = time.time;
        this._timeTillDay = new Object();
        this._timeTillNight = new Object();
        this._timeTillActive = false;
        this._timeProfileMode = TimeProfiles.MODES.AUTO;
        this._estimatedProfileActive = false;
        this._estimateValidation = {
            observedAtMs: observedAtMs,
            remainingSeconds: null,
            isDay: null,
            elapsedSeconds: 0,
            estimatedDecreaseSeconds: 0
        };

        this.loadTimeTillConfig();
        this.initializeEstimatedProfile(time, observedAtMs);
    }

    /* Getters and Setters */
    get dayLengthMinutes() { return this._dayLengthMinutes; }
    set dayLengthMinutes(dayLengthMinutes) { this._dayLengthMinutes = dayLengthMinutes; }
    get timeScale() { return this._timeScale; }
    set timeScale(timeScale) { this._timeScale = timeScale; }
    get sunrise() { return this._sunrise; }
    set sunrise(sunrise) { this._sunrise = sunrise; }
    get sunset() { return this._sunset; }
    set sunset(sunset) { this._sunset = sunset; }
    get time() { return this._time; }
    set time(time) { this._time = time; }
    get rustplus() { return this._rustplus; }
    set rustplus(rustplus) { this._rustplus = rustplus; }
    get client() { return this._client; }
    set client(client) { this._client = client; }
    get startTime() { return this._startTime; }
    set startTime(startTime) { this._startTime = startTime; }
    get timeTillDay() { return this._timeTillDay; }
    set timeTillDay(timeTillDay) { this._timeTillDay = timeTillDay; }
    get timeTillNight() { return this._timeTillNight; }
    set timeTillNight(timeTillNight) { this._timeTillNight = timeTillNight; }
    get timeTillActive() { return this._timeTillActive; }
    set timeTillActive(timeTillActive) { this._timeTillActive = timeTillActive; }
    get timeProfileMode() { return this._timeProfileMode; }
    set timeProfileMode(mode) { this._timeProfileMode = TimeProfiles.normalizeMode(mode); }
    get estimatedProfileActive() { return this._estimatedProfileActive; }
    set estimatedProfileActive(active) { this._estimatedProfileActive = active; }
    get timeProfileStatus() {
        if (this.timeTillActive) return 'learned';
        if (this.estimatedProfileActive) return this.timeProfileMode;
        return 'learning';
    }

    /* Change checkers */
    isDayLengthMinutesChanged(time) { return ((this.dayLengthMinutes) !== (time.dayLengthMinutes)); }
    isTimeScaleChanged(time) { return ((this.timeScale) !== (time.timeScale)); }
    isSunriseChanged(time) { return ((this.sunrise) !== (time.sunrise)); }
    isSunsetChanged(time) { return ((this.sunset) !== (time.sunset)); }
    isTimeChanged(time) { return ((this.time) !== (time.time)); }

    /* Other checkers */
    isDay() { return ((this.time >= this.sunrise) && (this.time < this.sunset)); }
    isNight() { return !this.isDay(); }
    isTurnedDay(time) { return (this.isNight() && time.time >= time.sunrise && time.time < time.sunset); }
    isTurnedNight(time) { return (this.isDay() && !(time.time >= time.sunrise && time.time < time.sunset)); }

    loadTimeTillConfig() {
        let instance = this.client.getInstance(this.rustplus.guildId);
        const server = instance.serverList[this.rustplus.serverId];

        this.timeProfileMode = server.timeProfile;

        if (server.timeTillDay !== null) {
            this.timeTillDay = server.timeTillDay;
        }
        if (server.timeTillNight !== null) {
            this.timeTillNight = server.timeTillNight;
        }

        this.timeTillActive =
            Object.keys(this.timeTillDay).length !== 0 &&
            Object.keys(this.timeTillNight).length !== 0;
    }

    initializeEstimatedProfile(time, observedAtMs = Date.now()) {
        if (this.timeTillActive || this.timeProfileMode === TimeProfiles.MODES.LEARN) return;

        this.estimatedProfileActive = this.timeProfileMode === TimeProfiles.MODES.VANILLA ||
            TimeProfiles.isVanillaCandidate(time);

        if (this.estimatedProfileActive) {
            this.resetEstimateValidation(time, observedAtMs);
        }
    }

    setTimeProfileMode(mode, observedAtMs = Date.now()) {
        this.timeProfileMode = mode;
        this.estimatedProfileActive = false;
        this.initializeEstimatedProfile(this, observedAtMs);
    }

    resetEstimateValidation(time, observedAtMs) {
        this._estimateValidation = {
            observedAtMs: observedAtMs,
            remainingSeconds: TimeProfiles.getVanillaSecondsTillTransition(time),
            isDay: time.time >= time.sunrise && time.time < time.sunset,
            elapsedSeconds: 0,
            estimatedDecreaseSeconds: 0
        };
    }

    validateEstimatedProfile(time, observedAtMs) {
        if (!this.estimatedProfileActive || this.timeProfileMode !== TimeProfiles.MODES.AUTO) return;

        const clockDistance = this.time > time.time ? (24 - this.time) + time.time : time.time - this.time;
        if (clockDistance > 1 || !TimeProfiles.isVanillaCandidate(time)) {
            this.estimatedProfileActive = false;
            return;
        }

        const previous = this._estimateValidation;
        const remainingSeconds = TimeProfiles.getVanillaSecondsTillTransition(time);
        const isDay = time.time >= time.sunrise && time.time < time.sunset;
        const elapsedSeconds = Math.max(0, (observedAtMs - previous.observedAtMs) / 1000);

        if (previous.remainingSeconds === null || previous.isDay !== isDay || elapsedSeconds <= 0) {
            this.resetEstimateValidation(time, observedAtMs);
            return;
        }

        const estimatedDecrease = previous.remainingSeconds - remainingSeconds;
        previous.observedAtMs = observedAtMs;
        previous.remainingSeconds = remainingSeconds;
        previous.isDay = isDay;

        if (estimatedDecrease < 0) {
            previous.elapsedSeconds = 0;
            previous.estimatedDecreaseSeconds = 0;
            return;
        }

        previous.elapsedSeconds += elapsedSeconds;
        previous.estimatedDecreaseSeconds += estimatedDecrease;

        if (previous.elapsedSeconds < 30) return;

        const rate = previous.estimatedDecreaseSeconds / previous.elapsedSeconds;
        if (rate < 0.70 || rate > 1.30) {
            this.estimatedProfileActive = false;
            return;
        }

        previous.elapsedSeconds = 0;
        previous.estimatedDecreaseSeconds = 0;
    }

    updateTime(time, observedAtMs = Date.now()) {
        this.validateEstimatedProfile(time, observedAtMs);
        this.dayLengthMinutes = time.dayLengthMinutes;
        this.timeScale = time.timeScale;
        this.sunrise = time.sunrise;
        this.sunset = time.sunset;
        this.time = time.time;
        this.checkForBroadcast();
    }

    checkForBroadcast() {
        if (!this.timeTillActive) {
            return null;
        }

        const timeRemainingString = this.getTimeTillDayOrNight();
        const timeRemainingSeconds = TimeLib.getSecondsFromStringTime(timeRemainingString);

        if (timeRemainingSeconds === 300) { // 5 minutes
            const locString = this.isDay() ? 'timeTillNightfall' : 'timeTillDaylight';
            const timeTilltransition = this._client.intlGet(this.guildId, locString, { time: timeRemainingString });

            this.rustplus.sendInGameMessage(`${timeTilltransition}`)
        }

    }

    getTimeTillDayOrNight(ignore = '') {
        if (!this.timeTillActive) {
            if (!this.estimatedProfileActive) return null;
            const estimatedSeconds = TimeProfiles.getVanillaSecondsTillTransition(this);
            return estimatedSeconds === null ? null : TimeLib.secondsToFullScale(estimatedSeconds, ignore);
        }

        let object = null;
        if (this.isDay()) {
            object = this.timeTillNight;
        }
        else {
            object = this.timeTillDay;
        }

        let time = this.time;
        let closest = Object.keys(object).map(Number).reduce(function (a, b) {
            return (Math.abs(b - time) < Math.abs(a - time) ? b : a);
        });

        return TimeLib.secondsToFullScale(object[closest], ignore);
    }

}

module.exports = Time;