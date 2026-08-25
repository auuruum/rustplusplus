function getMarkersOfType(type, markers, types) {
    if (!types || !Object.values(types).includes(type)) {
        return [];
    }

    const typeNames = Object.fromEntries(Object.entries(types).map(([name, value]) => [value, name]));
    return (markers ?? []).filter(marker => {
        const isVendingMarker = Array.isArray(marker.sellOrders) && marker.sellOrders.length > 0;
        const markerMatchesType = marker.type === type || marker.type === typeNames[type];

        if (type === types.VendingMachine) {
            return markerMatchesType || isVendingMarker;
        }

        return markerMatchesType && !(type === types.Player && isVendingMarker);
    });
}

module.exports = { getMarkersOfType };