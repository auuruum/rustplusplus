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