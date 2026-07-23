const Test = require('node:test');
const Assert = require('node:assert/strict');

const Scrape = require('../src/util/scrape.js');

Test('resolves a Steam vanity URL through XML with a Steam-compatible User-Agent', async () => {
    const originalScrape = Scrape.scrape;
    let requestedUrl = null;
    let requestedOptions = null;
    Scrape.scrape = async (url, options) => {
        requestedUrl = url;
        requestedOptions = options;
        return {
            status: 200,
            data: '<?xml version="1.0"?><profile><steamID64>76561198982669820</steamID64></profile>'
        };
    };

    try {
        const steamId = await Scrape.scrapeSteamIdFromVanity({}, 'auuruum');
        Assert.equal(steamId, '76561198982669820');
        Assert.equal(requestedUrl, 'https://steamcommunity.com/id/auuruum/?xml=1');
        Assert.match(requestedOptions.headers['User-Agent'], /^RustPlusPlus\//);
        Assert.match(requestedOptions.headers.Accept, /application\/xml/);
    }
    finally {
        Scrape.scrape = originalScrape;
    }
});

Test('parses a Steam profile game and join endpoint', () => {
    const parsed = Scrape.parseSteamProfilePresenceHtml(`
        <span class="actual_persona_name">Sogeking &amp; Co</span>
        <div class="profile_in_game_name"> Rust </div>
        <div class="profile_in_game_joingame">
            <a href="steam://connect/205.178.168.211:28010"><span>Join Game</span></a>
        </div>
    `);

    Assert.deepEqual(parsed, {
        name: 'Sogeking & Co',
        game: 'Rust',
        connect: 'connect 205.178.168.211:28010'
    });
});

Test('fetches Steam profile presence without requiring a Web API key', async () => {
    const originalScrape = Scrape.scrape;
    let requestedUrl = null;
    let requestedOptions = null;
    Scrape.scrape = async (url, options) => {
        requestedUrl = url;
        requestedOptions = options;
        return {
            status: 200,
            data: '<span class="actual_persona_name">Kotix</span>' +
                '<div class="profile_in_game_name">Rust</div>' +
                '<div class="profile_in_game_joingame">' +
                '<a href="steam://connect/205.178.168.211:28010">Join Game</a></div>'
        };
    };

    try {
        const presence = await Scrape.scrapeSteamProfilePresence({}, '76561198117844313', {
            noCache: true,
            now: () => 123456789
        });
        Assert.equal(requestedUrl, 'https://steamcommunity.com/profiles/76561198117844313');
        Assert.match(requestedOptions.headers['User-Agent'], /^RustPlusPlus\//);
        Assert.equal(requestedOptions.timeout, 10000);
        Assert.deepEqual(presence, {
            available: true,
            steamId: '76561198117844313',
            observedAt: 123456789,
            name: 'Kotix',
            game: 'Rust',
            connect: 'connect 205.178.168.211:28010',
            reason: null
        });
    }
    finally {
        Scrape.scrape = originalScrape;
    }
});

Test('ignores connect links outside Steam current-game join block', () => {
    const parsed = Scrape.parseSteamProfilePresenceHtml(`
        <span class="actual_persona_name">Profile Showcase</span>
        <a href="steam://connect/203.0.113.10:28010">Custom profile content</a>
    `);

    Assert.equal(parsed.connect, null);
});