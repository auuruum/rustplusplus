const Test = require('node:test');
const Assert = require('node:assert/strict');

const { getMarkersOfType } = require('../src/util/mapMarkerTypes.js');

const types = {
    Player: 1,
    Explosion: 2,
    VendingMachine: 3,
    CH47: 4,
    CargoShip: 5,
    Crate: 6,
    GenericRadius: 7,
    PatrolHelicopter: 8,
    TravelingVendor: 9
};

Test('recognizes numeric, string, and sellOrders-backed vending markers', () => {
    const input = [
        { id: 1, type: 3, sellOrders: [] },
        { id: 2, type: 'VendingMachine', sellOrders: [] },
        { id: 3, type: 'Player', sellOrders: [{ itemId: 1 }] },
        { id: 4, type: 'Player' }
    ];

    Assert.deepEqual(
        getMarkersOfType(types.VendingMachine, input, types).map(marker => marker.id),
        [1, 2, 3]
    );
    Assert.deepEqual(
        getMarkersOfType(types.Player, input, types).map(marker => marker.id),
        [4]
    );
});