#!/usr/bin/env node
/* Read-only Rust+ market diagnostic. Never prints player tokens. */
const fs = require('fs');
const path = require('path');
const RustPlus = require('@liamcottle/rustplus.js');

const args = process.argv.slice(2);
const valueOf = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const instancePath = valueOf('--instance') || process.env.RUSTPLUS_INSTANCE;
const itemQuery = valueOf('--item') || 'Basic Blueprint Fragment';
const currencyQuery = valueOf('--currency') || 'Sulfur';
const timeoutMs = Number(valueOf('--timeout') || 15000);

if (!instancePath) {
  console.error('Usage: node scripts/diagnose-market-rustplus.js --instance instances/<guild>.json [--item NAME --currency NAME]');
  process.exit(2);
}

function fail(message, details) {
  console.log(JSON.stringify({ ok: false, stage: message, ...details }, null, 2));
  process.exitCode = 1;
}

function request(rustplus, method) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timeout after ${timeoutMs}ms`)), timeoutMs);
    rustplus[method]((response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function unwrap(response) {
  return response && typeof response === 'object' && response.response &&
    typeof response.response === 'object' ? response.response : response;
}

function responseSummary(response) {
  response = unwrap(response);
  if (!response || typeof response !== 'object') return { type: typeof response, value: String(response) };
  const result = { keys: Object.keys(response) };
  if (response.error) result.error = response.error;
  if (response.info) result.info = { name: response.info.name, players: response.info.players, maxPlayers: response.info.maxPlayers };
  if (response.teamInfo) result.teamPlayers = response.teamInfo.players?.length ?? 0;
  if (response.mapMarkers) {
    const markers = response.mapMarkers.markers || [];
    result.markerTypes = markers.map(m => ({ type: m.type, id: m.id, x: m.x, y: m.y, name: m.name, keys: Object.keys(m) }));
    const vending = markers.filter(m => m.type === 3);
    result.markerCount = markers.length;
    result.vendingMachineCount = vending.length;
    result.vendingMachines = vending.map(m => ({
      id: m.id, x: m.x, y: m.y, name: m.name,
      sellOrders: (m.sellOrders || []).map(o => ({
        itemId: o.itemId, currencyId: o.currencyId,
        itemIsBlueprint: !!o.itemIsBlueprint, currencyIsBlueprint: !!o.currencyIsBlueprint,
        quantity: o.quantity, costPerItem: o.costPerItem, amountInStock: o.amountInStock
      }))
    }));
  }
  return result;
}

(async () => {
  const absolute = path.resolve(instancePath);
  const config = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const serverId = config.activeServer;
  const server = config.serverList?.[serverId];
  if (!server) return fail('config', { error: `active server not found: ${serverId}` });
  if (!server.playerToken || !server.steamId || !server.serverIp || !server.appPort) {
    return fail('config', { error: 'server must contain serverIp, appPort, steamId and playerToken', serverId });
  }

  const rustplus = new RustPlus(server.serverIp, Number(server.appPort), String(server.steamId), Number(server.playerToken));
  const events = [];
  rustplus.on('connecting', () => events.push('connecting'));
  rustplus.on('connected', () => events.push('connected'));
  rustplus.on('disconnected', () => events.push('disconnected'));
  rustplus.on('error', error => events.push(`error:${error?.message || error}`));

  try {
    rustplus.connect();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs);
      const onConnected = () => { clearTimeout(timer); rustplus.removeListener('connected', onConnected); resolve(); };
      rustplus.on('connected', onConnected);
    });
    const info = await request(rustplus, 'getInfo');
    const mapMarkers = await request(rustplus, 'getMapMarkers');
    const teamInfo = await request(rustplus, 'getTeamInfo');
    const mapMarkersPayload = unwrap(mapMarkers);
    const hasVending = (mapMarkersPayload?.mapMarkers?.markers || []).some(marker =>
      marker.type === 3 || marker.type === 'VendingMachine' || Array.isArray(marker.sellOrders) && marker.sellOrders.length > 0);
    const output = {
      ok: !mapMarkersPayload?.error && hasVending,
      serverId,
      endpoint: `${server.serverIp}:${server.appPort}`,
      events,
      itemQuery,
      currencyQuery,
      info: responseSummary(info),
      mapMarkers: responseSummary(mapMarkers),
      teamInfo: responseSummary(teamInfo),
      conclusion: mapMarkersPayload?.error
        ? `Rust+ getMapMarkers failed with ${mapMarkersPayload.error}; /market cannot inspect vending machines.`
        : (mapMarkersPayload?.mapMarkers?.markers || []).some(marker =>
            marker.type === 3 || marker.type === 'VendingMachine' || Array.isArray(marker.sellOrders) && marker.sellOrders.length > 0)
          ? `Rust+ returned vending markers; inspect vendingMachines and match item/currency IDs.`
          : 'Rust+ returned map markers but no vending-machine markers; /market has no live vending data to analyse.'
    };
    console.log(JSON.stringify(output, null, 2));
    if (mapMarkersPayload?.error || !hasVending) process.exitCode = 1;
  } catch (error) {
    fail('connection/request', { serverId, endpoint: `${server.serverIp}:${server.appPort}`, events, error: error.message });
  } finally {
    try { rustplus.disconnect(); } catch (_) {}
  }
})();
