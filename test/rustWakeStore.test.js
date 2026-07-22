const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('fs');
const Os = require('os');
const Path = require('path');

const tempDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rust-wake-store-'));
process.env.RPP_RUST_WAKE_STORE_PATH = Path.join(tempDir, 'devices.json');
const RustWakeStore = require('../src/util/rustWakeStore.js');

Test.after(() => {
    delete process.env.RPP_RUST_WAKE_STORE_PATH;
    Fs.rmSync(tempDir, { recursive: true, force: true });
});

Test('active link code is resolved from guild and Discord user', () => {
    const created = RustWakeStore.createLinkCode('guild-a', 'user-a');

    Assert.deepEqual(RustWakeStore.getActiveLinkCode('guild-a', 'user-a'), created);
    Assert.equal(RustWakeStore.getActiveLinkCode('guild-a', 'user-b'), null);
    Assert.equal(RustWakeStore.getActiveLinkCode('guild-b', 'user-a'), null);
});

Test('creating another link code replaces the active code for that user', () => {
    const first = RustWakeStore.createLinkCode('guild-b', 'user-b');
    const second = RustWakeStore.createLinkCode('guild-b', 'user-b');

    Assert.notEqual(second.code, first.code);
    Assert.deepEqual(RustWakeStore.getActiveLinkCode('guild-b', 'user-b'), second);
    Assert.equal(RustWakeStore.consumeLinkCode(first.code, 'old-token'), null);
});

Test('expired link code is not returned as active', () => {
    const created = RustWakeStore.createLinkCode('guild-c', 'user-c');
    const persisted = JSON.parse(Fs.readFileSync(RustWakeStore.STORE_PATH, 'utf8'));
    persisted.linkCodes[created.code].expiresAt = new Date(Date.now() - 1000).toISOString();
    Fs.writeFileSync(RustWakeStore.STORE_PATH, JSON.stringify(persisted, null, 2));

    Assert.equal(RustWakeStore.getActiveLinkCode('guild-c', 'user-c'), null);
    const pruned = JSON.parse(Fs.readFileSync(RustWakeStore.STORE_PATH, 'utf8'));
    Assert.equal(pruned.linkCodes[created.code], undefined);
});
