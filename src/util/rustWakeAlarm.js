const Config = require('../../config');
const RustWakeFcmClient = require('./rustWakeFcmClient.js');
const RustWakeStore = require('./rustWakeStore.js');

const WAKE_COOLDOWN_MS = 2 * 60 * 1000;

async function triggerAlarmWake(guildId, alarm) {
    if (!Config.rustWake.enabled) return { sent: 0, skipped: 'feature-disabled' };
    if (!alarm || !alarm.wakeEnabled) return { sent: 0, skipped: 'alarm-wake-off' };

    const devices = RustWakeStore.getDevicesByGuild(guildId);
    if (devices.length === 0) return { sent: 0, skipped: 'no-linked-devices' };

    const now = Date.now();
    const lastWakeAt = alarm.lastWakeAt ? Date.parse(alarm.lastWakeAt) : 0;
    if (lastWakeAt && (now - lastWakeAt) < WAKE_COOLDOWN_MS) {
        return { sent: 0, skipped: 'cooldown', cooldownMsLeft: WAKE_COOLDOWN_MS - (now - lastWakeAt) };
    }

    const fcm = new RustWakeFcmClient(Config.rustWake.fcmServiceAccount);
    if (!fcm.isConfigured()) return { sent: 0, skipped: 'not-configured' };

    const alert = {
        title: 'RAID WAKE',
        base: alarm.name || 'Smart Alarm',
        grid: alarm.location || '?',
        server: alarm.server || 'Rust server',
        trigger: 'Smart Alarm'
    };

    let sent = 0;
    for (const device of devices) {
        try {
            await fcm.sendAlert(device.token, alert);
            sent += 1;
        }
        catch (e) {
            // ignore per-device errors so one bad token does not block the rest
        }
    }

    if (sent > 0) {
        alarm.lastWakeAt = new Date(now).toISOString();
    }

    return { sent, skipped: sent > 0 ? null : 'send-failed' };
}

module.exports = {
    WAKE_COOLDOWN_MS,
    triggerAlarmWake
};