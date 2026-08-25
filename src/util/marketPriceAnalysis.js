/*
    Analyse live Rust+ vending-machine orders for a single item/currency pair.
*/

function hasBlueprintSuffix(name) {
    return /\s+(?:blueprint|bp)$/i.test(String(name ?? '').trim());
}

function normalizeSearchName(name) {
    return String(name ?? '')
        .trim()
        .replace(/\s+(?:blueprint|bp)$/i, '')
        .trim();
}

function resolveItem(client, name) {
    const rawName = String(name ?? '').trim();
    const normalizedName = normalizeSearchName(rawName);
    if (!normalizedName) return null;

    /* Prefer the literal item name, then accept the convenient "... blueprint" form. */
    const candidates = rawName === normalizedName ? [normalizedName] : [rawName, normalizedName];
    let id = null;
    let matchedName = normalizedName;
    for (const candidate of candidates) {
        id = client.items.getClosestItemIdByName(candidate);
        if (id !== null && id !== undefined) {
            matchedName = candidate;
            break;
        }
    }
    if (id === null || id === undefined) return null;

    return {
        id: Number(id),
        name: client.items.getName(id),
        input: matchedName
    };
}

function collectMatchingOrders(vendingMachines, filter) {
    const matches = [];
    for (const vendingMachine of vendingMachines ?? []) {
        for (const order of vendingMachine.sellOrders ?? []) {
            if (!Number.isFinite(Number(order.costPerItem)) || Number(order.costPerItem) < 0) continue;
            if (Number(order.amountInStock) <= 0) continue;
            if (Number(order.itemId) !== filter.itemId) continue;
            if (Boolean(order.itemIsBlueprint) !== filter.itemBlueprint) continue;
            if (filter.currencyId !== null && Number(order.currencyId) !== filter.currencyId) continue;
            if (filter.currencyId !== null && Boolean(order.currencyIsBlueprint) !== filter.currencyBlueprint) continue;

            matches.push({
                costPerItem: Number(order.costPerItem),
                quantity: Number(order.quantity) || 1,
                amountInStock: Number(order.amountInStock),
                itemId: Number(order.itemId),
                currencyId: Number(order.currencyId),
                itemIsBlueprint: Boolean(order.itemIsBlueprint),
                currencyIsBlueprint: Boolean(order.currencyIsBlueprint),
                vendingMachine
            });
        }
    }
    return matches;
}

function summarizeOrders(orders) {
    if (orders.length === 0) return null;
    const prices = orders.map(order => order.costPerItem);
    const total = prices.reduce((sum, price) => sum + price, 0);
    return {
        count: orders.length,
        average: total / prices.length,
        low: Math.min(...prices),
        high: Math.max(...prices),
        orders
    };
}

function analyzeMarketPrice({ client, vendingMachines, itemName, currencyName = null,
    itemBlueprint = false, currencyBlueprint = false }) {
    const item = resolveItem(client, itemName);
    if (!item) return { error: 'item-not-found' };

    const currency = currencyName === null ? null : resolveItem(client, currencyName);
    if (currencyName !== null && !currency) return { error: 'currency-not-found', item };

    const resolvedItemBlueprint = Boolean(itemBlueprint) || hasBlueprintSuffix(itemName);
    const resolvedCurrencyBlueprint = Boolean(currencyBlueprint) || hasBlueprintSuffix(currencyName);
    const orders = collectMatchingOrders(vendingMachines, {
        itemId: item.id,
        itemBlueprint: resolvedItemBlueprint,
        currencyId: currency ? currency.id : null,
        currencyBlueprint: resolvedCurrencyBlueprint
    });

    return {
        item,
        currency,
        itemBlueprint: resolvedItemBlueprint,
        currencyBlueprint: resolvedCurrencyBlueprint,
        summary: summarizeOrders(orders)
    };
}

module.exports = {
    normalizeSearchName,
    resolveItem,
    collectMatchingOrders,
    summarizeOrders,
    analyzeMarketPrice
};
