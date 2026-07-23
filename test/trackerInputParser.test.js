const Test = require('node:test');
const Assert = require('node:assert/strict');

const TrackerInputParser = require('../src/util/trackerInputParser.js');

const STEAM_ID = '76561198000000000';

Test('parses SteamID64 and canonical Steam profile URLs', () => {
    Assert.deepEqual(TrackerInputParser.parseTrackerPlayerInput(STEAM_ID), {
        valid: true,
        value: STEAM_ID,
        type: 'steamId',
        normalizedInput: STEAM_ID
    });

    const parsed = TrackerInputParser.parseTrackerPlayerInput(
        `https://steamcommunity.com/profiles/${STEAM_ID}/?utm_source=discord`);
    Assert.equal(parsed.valid, true);
    Assert.equal(parsed.type, 'steamId');
    Assert.equal(parsed.value, STEAM_ID);
});

Test('parses Steam vanity URLs for later SteamID64 resolution', () => {
    const parsed = TrackerInputParser.parseTrackerPlayerInput('https://steamcommunity.com/id/example-user/');
    Assert.equal(parsed.valid, true);
    Assert.equal(parsed.type, 'steamVanityUrl');
    Assert.equal(parsed.value, 'example-user');
});

Test('accepts copy-pasted Steam profile links without a scheme', () => {
    const numeric = TrackerInputParser.parseTrackerPlayerInput(`steamcommunity.com/profiles/${STEAM_ID}`);
    Assert.equal(numeric.valid, true);
    Assert.equal(numeric.type, 'steamId');
    Assert.equal(numeric.value, STEAM_ID);

    const vanity = TrackerInputParser.parseTrackerPlayerInput('www.steamcommunity.com/id/example-user');
    Assert.equal(vanity.valid, true);
    Assert.equal(vanity.type, 'steamVanityUrl');
    Assert.equal(vanity.value, 'example-user');
});

Test('accepts Discord markdown and Steam-client openurl wrappers', () => {
    const markdown = TrackerInputParser.parseTrackerPlayerInput(
        `[profile](https://steamcommunity.com/profiles/${STEAM_ID}/)`);
    Assert.equal(markdown.valid, true);
    Assert.equal(markdown.type, 'steamId');
    Assert.equal(markdown.value, STEAM_ID);

    const steamClient = TrackerInputParser.parseTrackerPlayerInput(
        'steam://openurl/https://steamcommunity.com/id/example-user/');
    Assert.equal(steamClient.valid, true);
    Assert.equal(steamClient.type, 'steamVanityUrl');
    Assert.equal(steamClient.value, 'example-user');
});

Test('does not trust lookalike Steam hosts', () => {
    const parsed = TrackerInputParser.parseTrackerPlayerInput(
        `https://steamcommunity.com.example.invalid/profiles/${STEAM_ID}`);
    Assert.equal(parsed.valid, false);
});
