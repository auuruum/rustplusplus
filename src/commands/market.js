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

const Builder = require('@discordjs/builders');

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const MarketPriceAnalysis = require('../util/marketPriceAnalysis.js');

module.exports = {
    name: 'market',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('market')
            .setDescription(client.intlGet(guildId, 'commandsMarketDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('search')
                .setDescription(client.intlGet(guildId, 'commandsMarketSearchDesc'))
                .addStringOption(option => option
                    .setName('order')
                    .setDescription(client.intlGet(guildId, 'commandsMarketOrderDesc'))
                    .setRequired(true)
                    .addChoices(
                        { name: client.intlGet(guildId, 'all'), value: 'all' },
                        { name: client.intlGet(guildId, 'buy'), value: 'buy' },
                        { name: client.intlGet(guildId, 'sell'), value: 'sell' }))
                .addStringOption(option => option
                    .setName('name')
                    .setDescription(client.intlGet(guildId, 'theNameOfTheItem'))
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('id')
                    .setDescription(client.intlGet(guildId, 'theIdOfTheItem'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('subscribe')
                .setDescription(client.intlGet(guildId, 'commandsMarketSubscribeDesc'))
                .addStringOption(option => option
                    .setName('order')
                    .setDescription(client.intlGet(guildId, 'commandsMarketOrderDesc'))
                    .setRequired(true)
                    .addChoices(
                        { name: client.intlGet(guildId, 'all'), value: 'all' },
                        { name: client.intlGet(guildId, 'buy'), value: 'buy' },
                        { name: client.intlGet(guildId, 'sell'), value: 'sell' }))
                .addStringOption(option => option
                    .setName('name')
                    .setDescription(client.intlGet(guildId, 'theNameOfTheItem'))
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('id')
                    .setDescription(client.intlGet(guildId, 'theIdOfTheItem'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('unsubscribe')
                .setDescription(client.intlGet(guildId, 'commandsMarketUnsubscribeDesc'))
                .addStringOption(option => option
                    .setName('order')
                    .setDescription(client.intlGet(guildId, 'commandsMarketOrderDesc'))
                    .setRequired(true)
                    .addChoices(
                        { name: client.intlGet(guildId, 'all'), value: 'all' },
                        { name: client.intlGet(guildId, 'buy'), value: 'buy' },
                        { name: client.intlGet(guildId, 'sell'), value: 'sell' }))
                .addStringOption(option => option
                    .setName('name')
                    .setDescription(client.intlGet(guildId, 'theNameOfTheItem'))
                    .setRequired(false))
                .addStringOption(option => option
                    .setName('id')
                    .setDescription(client.intlGet(guildId, 'theIdOfTheItem'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('list')
                .setDescription(client.intlGet(guildId, 'commandsMarketListDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('shops')
                .setDescription(client.intlGet(guildId, 'commandsMarketShopsDesc'))
                .addStringOption(option => option
                    .setName('shoptype')
                    .setDescription(client.intlGet(guildId, 'commandsMarketShopsTypeDesc'))
                    .setRequired(false)
                    .addChoices(
                        { name: 'player', value: 'player' },
                        { name: 'npc', value: 'npc' },
                        { name: 'all', value: 'all' }))
                .addBooleanOption(option => option
                    .setName('outofstock')
                    .setDescription(client.intlGet(guildId, 'commandsMarketShopsOutOfStockDesc'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('price')
                .setDescription('Analyse live vending-machine prices on this server.')
                .addStringOption(option => option
                    .setName('item')
                    .setDescription('The item being sold, for example rocket or rifle body.')
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('currency')
                    .setDescription('The currency requested by the seller, for example sulfur or scrap.')
                    .setRequired(true))
                .addBooleanOption(option => option
                    .setName('item_blueprint')
                    .setDescription('Only include listings selling the item as a blueprint.')
                    .setRequired(false))
                .addBooleanOption(option => option
                    .setName('currency_blueprint')
                    .setDescription('Only include listings requesting the currency as a blueprint.')
                    .setRequired(false)));
    },

    async execute(client, interaction) {
        const instance = client.getInstance(interaction.guildId);
        const rustplus = client.rustplusInstances[interaction.guildId];

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        if (!rustplus || (rustplus && !rustplus.isOperational)) {
            const str = client.intlGet(interaction.guildId, 'notConnectedToRustServer');
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            client.log(client.intlGet(null, 'warningCap'), str);
            return;
        }

        switch (interaction.options.getSubcommand()) {
            case 'price': {
                const itemName = interaction.options.getString('item');
                const currencyName = interaction.options.getString('currency');
                const itemBlueprint = interaction.options.getBoolean('item_blueprint') ?? false;
                const currencyBlueprint = interaction.options.getBoolean('currency_blueprint') ?? false;
                const analysis = MarketPriceAnalysis.analyzeMarketPrice({
                    client,
                    vendingMachines: rustplus.mapMarkers.vendingMachines,
                    itemName,
                    currencyName,
                    itemBlueprint,
                    currencyBlueprint
                });

                if (analysis.error === 'item-not-found') {
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1,
                        `No item found for "${itemName}".`));
                    return;
                }
                if (analysis.error === 'currency-not-found') {
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1,
                        `No currency item found for "${currencyName}".`));
                    return;
                }
                if (analysis.summary === null) {
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1,
                        `No live listings found for ${analysis.item.name}${analysis.itemBlueprint ? ' (BP)' : ''} ` +
                        `priced in ${analysis.currency.name}${analysis.currencyBlueprint ? ' (BP)' : ''}.`));
                    return;
                }

                const summary = analysis.summary;
                const formatPrice = value => Number.isInteger(value) ? `${value}` : value.toFixed(2);
                const locations = new Set(summary.orders.map(order => {
                    const location = order.vendingMachine.location;
                    return location?.string ?? `${order.vendingMachine.x ?? '?'}:${order.vendingMachine.y ?? '?'}`;
                }));
                const description = [
                    `**Item:** ${analysis.item.name}${analysis.itemBlueprint ? ' (BP)' : ''}`,
                    `**Currency:** ${analysis.currency.name}${analysis.currencyBlueprint ? ' (BP)' : ''}`,
                    '',
                    `**Average:** ${formatPrice(summary.average)} ${analysis.currency.name}`,
                    `**Low:** ${formatPrice(summary.low)} ${analysis.currency.name}`,
                    `**High:** ${formatPrice(summary.high)} ${analysis.currency.name}`,
                    '',
                    `Based on ${summary.count} live listing${summary.count === 1 ? '' : 's'} ` +
                    `across ${locations.size} vending machine${locations.size === 1 ? '' : 's'}.`,
                    'Average is the market baseline; use Low to sell quickly or High to test the market.'
                ].join('\n');

                const embed = DiscordEmbeds.getEmbed({
                    color: Constants.COLOR_DEFAULT,
                    title: 'Rust market price analysis',
                    description,
                    footer: { text: `${instance.serverList[rustplus.serverId].title}` }
                });
                await client.interactionEditReply(interaction, { embeds: [embed] });
            } break;

            case 'search': {
                const searchItemName = interaction.options.getString('name');
                const searchItemId = interaction.options.getString('id');
                const orderType = interaction.options.getString('order');

                let itemId = null;
                if (searchItemName !== null) {
                    const item = client.items.getClosestItemIdByName(searchItemName)
                    if (item === null) {
                        const str = client.intlGet(interaction.guildId, 'noItemWithNameFound', {
                            name: searchItemName
                        });
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                        return;
                    }
                    else {
                        itemId = item;
                    }
                }
                else if (searchItemId !== null) {
                    if (client.items.itemExist(searchItemId)) {
                        itemId = searchItemId;
                    }
                    else {
                        const str = client.intlGet(interaction.guildId, 'noItemWithIdFound', {
                            id: searchItemId
                        });
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                        return;
                    }
                }
                else if (searchItemName === null && searchItemId === null) {
                    const str = client.intlGet(interaction.guildId, 'noNameIdGiven');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                    return;
                }
                const itemName = client.items.getName(itemId);

                let full = false;
                let foundLines = '';
                const unknownString = client.intlGet(interaction.guildId, 'unknown');
                const leftString = client.intlGet(interaction.guildId, 'remain');
                for (const vendingMachine of rustplus.mapMarkers.vendingMachines) {
                    if (full) break;
                    if (!vendingMachine.hasOwnProperty('sellOrders')) continue;

                    for (const order of vendingMachine.sellOrders) {
                        if (order.amountInStock === 0) continue;

                        const orderItemId = (Object.keys(client.items.items).includes(order.itemId.toString())) ?
                            order.itemId : null;
                        const orderQuantity = order.quantity;
                        const orderCurrencyId = (Object.keys(client.items.items)
                            .includes(order.currencyId.toString())) ? order.currencyId : null;
                        const orderCostPerItem = order.costPerItem;
                        const orderAmountInStock = order.amountInStock;
                        const orderItemIsBlueprint = order.itemIsBlueprint;
                        const orderCurrencyIsBlueprint = order.currencyIsBlueprint;

                        const orderItemName = (orderItemId !== null) ?
                            client.items.getName(orderItemId) : unknownString;
                        const orderCurrencyName = (orderCurrencyId !== null) ?
                            client.items.getName(orderCurrencyId) : unknownString;

                        const prevFoundLines = foundLines;

                        if ((orderType === 'all' &&
                            (orderItemId === parseInt(itemId) || orderCurrencyId === parseInt(itemId))) ||
                            (orderType === 'buy' && orderCurrencyId === parseInt(itemId)) ||
                            (orderType === 'sell' && orderItemId === parseInt(itemId))) {
                            if (foundLines === '') {
                                foundLines += '```diff\n';
                            }

                            foundLines += `+ [${vendingMachine.location.string}] `;
                            foundLines += `${orderQuantity}x ${orderItemName}`;
                            foundLines += `${(orderItemIsBlueprint) ? ' (BP)' : ''} for `;
                            foundLines += `${orderCostPerItem}x ${orderCurrencyName}`;
                            foundLines += `${(orderCurrencyIsBlueprint) ? ' (BP)' : ''} `;
                            foundLines += `(${orderAmountInStock} ${leftString})\n`;

                            if (foundLines.length >= 4000) {
                                foundLines = prevFoundLines;
                                foundLines += `...\n`;
                                full = true;
                                break;
                            }
                        }
                    }
                }

                if (foundLines === '') {
                    foundLines = client.intlGet(interaction.guildId, 'noItemFound');
                }
                else {
                    foundLines += '```'
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `search, ${searchItemName}, ${searchItemId}, ${orderType}`
                }));

                const embed = DiscordEmbeds.getEmbed({
                    color: Constants.COLOR_DEFAULT,
                    title: client.intlGet(interaction.guildId, 'searchResult', { name: itemName }),
                    description: foundLines,
                    footer: { text: `${instance.serverList[rustplus.serverId].title}` }
                });

                await client.interactionEditReply(interaction, { embeds: [embed] });
                rustplus.log(client.intlGet(interaction.guildId, 'infoCap'),
                    client.intlGet(interaction.guildId, 'searchResult', { name: itemName }));
            } break;

            case 'subscribe': {
                const subscribeItemName = interaction.options.getString('name');
                const subscribeItemId = interaction.options.getString('id');
                const orderType = interaction.options.getString('order');

                let itemId = null;
                if (subscribeItemName !== null) {
                    const item = client.items.getClosestItemIdByName(subscribeItemName)
                    if (item === null) {
                        const str = client.intlGet(interaction.guildId, 'noItemWithNameFound', {
                            name: subscribeItemName
                        });
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                        return;
                    }
                    else {
                        itemId = item;
                    }
                }
                else if (subscribeItemId !== null) {
                    if (client.items.itemExist(subscribeItemId)) {
                        itemId = subscribeItemId;
                    }
                    else {
                        const str = client.intlGet(interaction.guildId, 'noItemWithIdFound', {
                            id: subscribeItemId
                        });
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                        return;
                    }
                }
                else if (subscribeItemName === null && subscribeItemId === null) {
                    const str = client.intlGet(interaction.guildId, 'noNameIdGiven');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                    return;
                }
                const itemName = client.items.getName(itemId);

                if (instance.marketSubscriptionList[orderType].includes(itemId)) {
                    const str = client.intlGet(interaction.guildId, 'alreadySubscribedToItem', {
                        name: itemName
                    });
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str,
                        instance.serverList[rustplus.serverId].title));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                }
                else {
                    instance.marketSubscriptionList[orderType].push(itemId);
                    rustplus.firstPollItems[orderType].push(itemId);
                    client.setInstance(interaction.guildId, instance);

                    const str = client.intlGet(interaction.guildId, 'justSubscribedToItem', {
                        name: itemName
                    });
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str,
                        instance.serverList[rustplus.serverId].title));
                    rustplus.log(client.intlGet(interaction.guildId, 'infoCap'), str);
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `subscribe, ${subscribeItemName}, ${subscribeItemId}, ${orderType}`
                }));
            } break;

            case 'unsubscribe': {
                const subscribeItemName = interaction.options.getString('name');
                const subscribeItemId = interaction.options.getString('id');
                const orderType = interaction.options.getString('order');

                let itemId = null;
                if (subscribeItemName !== null) {
                    const item = client.items.getClosestItemIdByName(subscribeItemName)
                    if (item === null) {
                        const str = client.intlGet(interaction.guildId, 'noItemWithNameFound', {
                            name: subscribeItemName
                        });
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                        return;
                    }
                    else {
                        itemId = item;
                    }
                }
                else if (subscribeItemId !== null) {
                    if (client.items.itemExist(subscribeItemId)) {
                        itemId = subscribeItemId;
                    }
                    else {
                        const str = client.intlGet(interaction.guildId, 'noItemWithIdFound', {
                            id: subscribeItemId
                        });
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                        return;
                    }
                }
                else if (subscribeItemName === null && subscribeItemId === null) {
                    const str = client.intlGet(interaction.guildId, 'noNameIdGiven');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                    return;
                }
                const itemName = client.items.getName(itemId);

                if (instance.marketSubscriptionList[orderType].includes(itemId)) {
                    instance.marketSubscriptionList[orderType] =
                        instance.marketSubscriptionList[orderType].filter(e => e !== itemId);
                    client.setInstance(interaction.guildId, instance);

                    const str = client.intlGet(interaction.guildId, 'removedSubscribeItem', {
                        name: itemName
                    });
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str,
                        instance.serverList[rustplus.serverId].title));
                    rustplus.log(client.intlGet(interaction.guildId, 'infoCap'), str);
                }
                else {
                    const str = client.intlGet(interaction.guildId, 'notExistInSubscription', {
                        name: itemName
                    });
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str,
                        instance.serverList[rustplus.serverId].title));
                    rustplus.log(client.intlGet(interaction.guildId, 'warningCap'), str);
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `subscribe, ${subscribeItemName}, ${subscribeItemId}, ${orderType}`
                }));
            } break;

            case 'list': {
                const names = { all: '', buy: '', sell: '' };
                for (const [orderType, itemIds] of Object.entries(instance.marketSubscriptionList)) {
                    for (const itemId of itemIds) {
                        names[orderType] += `\`${client.items.getName(itemId)} (${itemId})\`\n`;
                    }
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `list`
                }));

                await client.interactionEditReply(interaction, {
                    embeds: [DiscordEmbeds.getEmbed({
                        color: Constants.COLOR_DEFAULT,
                        title: client.intlGet(interaction.guildId, 'subscriptionList'),
                        footer: { text: instance.serverList[rustplus.serverId].title },
                        fields: [
                            {
                                name: client.intlGet(interaction.guildId, 'all'),
                                value: names['all'] === '' ? '\u200B' : names['all'],
                                inline: true
                            },
                            {
                                name: client.intlGet(interaction.guildId, 'buy'),
                                value: names['buy'] === '' ? '\u200B' : names['buy'],
                                inline: true
                            },
                            {
                                name: client.intlGet(interaction.guildId, 'sell'),
                                value: names['sell'] === '' ? '\u200B' : names['sell'],
                                inline: true
                            }]
                    })],
                    ephemeral: true
                });

                rustplus.log(client.intlGet(interaction.guildId, 'infoCap'),
                    client.intlGet(interaction.guildId, 'showingSubscriptionList'));
            } break;

            case 'shops': {
                const unknownStr = client.intlGet(interaction.guildId, 'unknown');
                const leftStr = client.intlGet(interaction.guildId, 'remain');
                const showOutOfStock = interaction.options.getBoolean('outofstock') ?? false;
                const shopType = interaction.options.getString('shoptype') ?? 'player';
                const vendingMachines = rustplus.mapMarkers.vendingMachines;

                if (!vendingMachines || vendingMachines.length === 0) {
                    const str = client.intlGet(interaction.guildId, 'noItemFound');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    return;
                }

                /* Monuments that contain NPC vending machines — filter them out.
                   Uses the same radii as Map.js monumentInfo so the boundary is consistent. */
                const NPC_SHOP_TOKENS = new Set([
                    'bandit_camp',
                    'outpost',
                    'fishing_village_display_name',
                    'large_fishing_village_display_name',
                    'supermarket',
                    'gas_station',
                ]);
                const npcMonuments = (rustplus.map.monuments || [])
                    .filter(m => NPC_SHOP_TOKENS.has(m.token))
                    .map(m => {
                        const info = rustplus.map.monumentInfo[m.token];
                        const r = info ? info.radius : 0;
                        return { x: m.x, y: m.y, radiusSq: r * r };
                    });

                /* Cargo ship NPC shops — filter by proximity to active cargo ship(s) */
                const CARGO_RADIUS_SQ = 75 * 75;
                const cargoShips = rustplus.mapMarkers.cargoShips || [];

                function isNearNpcMonument(vmX, vmY) {
                    for (const m of npcMonuments) {
                        const dx = vmX - m.x;
                        const dy = vmY - m.y;
                        if (dx * dx + dy * dy <= m.radiusSq) return true;
                    }
                    for (const ship of cargoShips) {
                        const dx = vmX - ship.x;
                        const dy = vmY - ship.y;
                        if (dx * dx + dy * dy <= CARGO_RADIUS_SQ) return true;
                    }
                    return false;
                }

                /* Grid-position regex: on-map locations look like "A1", "AB12", etc. */
                const GRID_RE = /^[A-Z]+\d+$/;

                /* Group by unique name+location to deduplicate stacked machines */
                const groups = Object.create(null);
                for (const vm of vendingMachines) {
                    /* Skip VMs outside the playable map grid (e.g. Deep Sea Floating City) */
                    if (!vm.location || !GRID_RE.test(vm.location.location)) continue;
                    const isNpc = isNearNpcMonument(vm.x, vm.y);
                    if (shopType === 'player' && isNpc) continue;
                    if (shopType === 'npc' && !isNpc) continue;
                    const loc = vm.location ? vm.location.string : unknownStr;
                    const shopName = vm.name || unknownStr;
                    const key = `${shopName}|${loc}`;
                    if (!groups[key]) groups[key] = { shopName, loc, orders: [] };
                    if (vm.sellOrders) {
                        for (const order of vm.sellOrders) {
                            if (!showOutOfStock && order.amountInStock === 0) continue;
                            const sig = `${order.itemId}|${order.quantity}|${order.currencyId}|${order.costPerItem}`;
                            if (!groups[key].orders.find(o => o.sig === sig)) {
                                groups[key].orders.push({ sig, order });
                            }
                        }
                    }
                }

                /* Build per-shop blocks then paginate into ≤4000-char pages */
                const shopBlocks = [];
                for (const { shopName, loc, orders } of Object.values(groups)) {
                    if (!orders.length) continue;

                    let block = `# ${shopName} [${loc}]\n`;
                    for (const { order } of orders) {
                        const itemName = client.items.itemExist(order.itemId.toString())
                            ? client.items.getName(order.itemId) : unknownStr;
                        const currName = client.items.itemExist(order.currencyId.toString())
                            ? client.items.getName(order.currencyId) : unknownStr;
                        const bp = order.itemIsBlueprint ? ' (BP)' : '';
                        const cbp = order.currencyIsBlueprint ? ' (BP)' : '';
                        const oos = order.amountInStock === 0 ? ' [OOS]' : '';
                        block += `+ ${order.quantity}x ${itemName}${bp} — ${order.costPerItem}x ${currName}${cbp} (${order.amountInStock} ${leftStr})${oos}\n`;
                    }
                    shopBlocks.push(block);
                }

                /* Pack blocks into pages — each page is a ```diff code block ≤4000 chars */
                const FENCE = '```diff\n';
                const CLOSE = '```';
                const PAGE_LIMIT = 4000;
                const pages = [];
                let current = FENCE;
                for (const block of shopBlocks) {
                    if (current.length + block.length + CLOSE.length > PAGE_LIMIT) {
                        pages.push(current + CLOSE);
                        current = FENCE;
                    }
                    current += block;
                }
                if (current !== FENCE) pages.push(current + CLOSE);

                if (pages.length === 0) {
                    const str = client.intlGet(interaction.guildId, 'noItemFound');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    return;
                }

                const shopTitle = client.intlGet(interaction.guildId, 'commandsMarketShopsDesc');
                const footerText = instance.serverList[rustplus.serverId].title;

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `shops`
                }));

                /* First page via editReply, subsequent pages via channel follow-ups */
                await client.interactionEditReply(interaction, {
                    embeds: [DiscordEmbeds.getEmbed({
                        color: Constants.COLOR_DEFAULT,
                        title: `${shopTitle}${pages.length > 1 ? ` (1/${pages.length})` : ''}`,
                        description: pages[0],
                        footer: { text: footerText }
                    })]
                });
                for (let i = 1; i < pages.length; i++) {
                    await client.messageSend(interaction.channel, {
                        embeds: [DiscordEmbeds.getEmbed({
                            color: Constants.COLOR_DEFAULT,
                            title: `${shopTitle} (${i + 1}/${pages.length})`,
                            description: pages[i],
                            footer: { text: footerText }
                        })]
                    });
                }
                rustplus.log(client.intlGet(interaction.guildId, 'infoCap'),
                    client.intlGet(interaction.guildId, 'commandsMarketShopsDesc'));
            } break;

            default: {

            } break;
        }
    },
}