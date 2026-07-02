const Fs = require('fs');
const Path = require('path');

const STORE_DIR = Path.join(__dirname, '..', '..', 'rust-wake');
const STORE_PATH = Path.join(STORE_DIR, 'devices.json');

function ensureStoreDir() {
    if (!Fs.existsSync(STORE_DIR)) {
        Fs.mkdirSync(STORE_DIR, { recursive: true });
    }
}

function readStore() {
    ensureStoreDir();
    if (!Fs.existsSync(STORE_PATH)) {
        return { devices: {} };
    }

    try {
        const parsed = JSON.parse(Fs.readFileSync(STORE_PATH, 'utf8'));
        if (!parsed.devices) parsed.devices = {};
        return parsed;
    }
    catch (e) {
        return { devices: {} };
    }
}

function writeStore(store) {
    ensureStoreDir();
    Fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function saveDevice(guildId, userId, token, deviceName = 'Android device') {
    const store = readStore();
    const key = getKey(guildId, userId);
    store.devices[key] = {
        guildId,
        userId,
        token,
        deviceName,
        updatedAt: new Date().toISOString()
    };
    writeStore(store);
    return store.devices[key];
}

function getDevice(guildId, userId) {
    return readStore().devices[getKey(guildId, userId)] || null;
}

function removeDevice(guildId, userId) {
    const store = readStore();
    const key = getKey(guildId, userId);
    const existed = Boolean(store.devices[key]);
    delete store.devices[key];
    writeStore(store);
    return existed;
}

module.exports = {
    STORE_PATH,
    saveDevice,
    getDevice,
    removeDevice
};
