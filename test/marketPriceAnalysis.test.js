const Test = require('node:test');
const Assert = require('node:assert/strict');

const { analyzeMarketPrice, normalizeSearchName, summarizeOrders } =
    require('../src/util/marketPriceAnalysis.js');

function createClient() {
    const items = { '1': 'Basic', '2': 'Sulfur', '3': 'Wood', '4': 'Basic Blueprint Fragment' };
    return {
        items: {
            getClosestItemIdByName(name) {
                const normalized = String(name).toLowerCase();
                const entry = Object.entries(items).find(([, value]) =>
                    value.toLowerCase() === normalized);
                return entry ? entry[0] : null;
            },
            getName(id) { return items[String(id)]; }
        }
    };
}

Test('normalizes blueprint suffix for convenient command input', () => {
    Assert.equal(normalizeSearchName('  basic blueprint '), 'basic');
    Assert.equal(normalizeSearchName('basic bp'), 'basic');
});

Test('summarizes matching item/currency blueprint orders and ignores unavailable orders', () => {
    const result = analyzeMarketPrice({
        client: createClient(),
        itemName: 'Basic Blueprint',
        currencyName: 'Sulfur',
        itemBlueprint: false,
        vendingMachines: [
            { sellOrders: [
                { itemId: 1, currencyId: 2, itemIsBlueprint: true, currencyIsBlueprint: false, costPerItem: 100, amountInStock: 1 },
                { itemId: 1, currencyId: 2, itemIsBlueprint: true, currencyIsBlueprint: false, costPerItem: 200, amountInStock: 4 },
                { itemId: 1, currencyId: 2, itemIsBlueprint: true, currencyIsBlueprint: false, costPerItem: 999, amountInStock: 0 },
                { itemId: 1, currencyId: 3, itemIsBlueprint: true, currencyIsBlueprint: false, costPerItem: 5, amountInStock: 1 }
            ] }
        ]
    });

    Assert.equal(result.itemBlueprint, true);
    Assert.deepEqual(
        { count: result.summary.count, average: result.summary.average, low: result.summary.low, high: result.summary.high },
        { count: 2, average: 150, low: 100, high: 200 }
    );
});

Test('treats item as the product being sold and currency as the payment item', () => {
    const result = analyzeMarketPrice({
        client: createClient(),
        itemName: 'Basic Blueprint Fragment',
        currencyName: 'Sulfur',
        vendingMachines: [
            { sellOrders: [
                { itemId: 4, currencyId: 2, itemIsBlueprint: false, currencyIsBlueprint: false, costPerItem: 75, amountInStock: 1 },
                { itemId: 2, currencyId: 4, itemIsBlueprint: false, currencyIsBlueprint: false, costPerItem: 900, amountInStock: 1 }
            ] }
        ]
    });

    Assert.equal(result.item.name, 'Basic Blueprint Fragment');
    Assert.equal(result.currency.name, 'Sulfur');
    Assert.equal(result.summary.count, 1);
    Assert.equal(result.summary.average, 75);
});

Test('returns no summary when there are no live matching listings', () => {
    Assert.equal(summarizeOrders([]), null);
});
