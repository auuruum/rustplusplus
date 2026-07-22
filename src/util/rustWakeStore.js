const Crypto = require('crypto');
const Fs = require('fs');
const Path = require('path');

const STORE_DIR = Path.join(__dirname, '..', '..', 'rust-wake');
const STORE_PATH = Path.join(STORE_DIR, 'devices.json');
const LINK_CODE_TTL_MS = 10 * 60 * 1000;

function ensureStoreDir() {
    if (!Fs.existsSync(STORE_DIR)) {
        Fs.mkdirSync(STORE_DIR, { recursive: true });
    }
}

function readStore() {
    ensureStoreDir();
    if (!Fs.existsSync(STORE_PATH)) {
        return { devices: {}, linkCodes: {} };
    }

    try {
        const parsed = JSON.parse(Fs.readFileSync(STORE_PATH, 'utf8'));
        if (!parsed.devices) parsed.devices = {};
        if (!parsed.linkCodes) parsed.linkCodes = {};
        return parsed;
    }
    catch (e) {
        return { devices: {}, linkCodes: {} };
    }
}

function writeStore(store) {
    ensureStoreDir();
    Fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function pruneExpiredLinkCodes(store) {
    const now = Date.now();
    for (const [code, entry] of Object.entries(store.linkCodes || {})) {
        if (!entry.expiresAt || Date.parse(entry.expiresAt) <= now) {
            delete store.linkCodes[code];
        }
    }
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

function getDevicesByGuild(guildId) {
    const store = readStore();
    return Object.values(store.devices).filter(device => device.guildId === guildId);
}

function createLinkCode(guildId, userId) {
    const store = readStore();
    pruneExpiredLinkCodes(store);

    for (const [code, entry] of Object.entries(store.linkCodes)) {
        if (entry.guildId === guildId && entry.userId === userId) {
            delete store.linkCodes[code];
        }
    }

    let code = null;
    do {
        code = String(Crypto.randomInt(100000, 1000000));
    } while (store.linkCodes[code]);

    store.linkCodes[code] = {
        guildId,
        userId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString()
    };
    writeStore(store);
    return { code, ...store.linkCodes[code] };
}

function consumeLinkCode(code, token, deviceName = 'Android device') {
    const cleanCode = String(code || '').replace(/\D/g, '');
    const store = readStore();
    pruneExpiredLinkCodes(store);

    const entry = store.linkCodes[cleanCode];
    if (!entry) {
        writeStore(store);
        return null;
    }

    const key = getKey(entry.guildId, entry.userId);
    store.devices[key] = {
        guildId: entry.guildId,
        userId: entry.userId,
        token,
        deviceName,
        updatedAt: new Date().toISOString()
    };
    delete store.linkCodes[cleanCode];
    writeStore(store);
    return store.devices[key];
}

module.exports = {
    STORE_PATH,
    LINK_CODE_TTL_MS,
    saveDevice,
    getDevice,
    getDevicesByGuild,
    removeDevice,
    createLinkCode,
    consumeLinkCode
};
