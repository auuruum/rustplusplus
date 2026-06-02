/*
    Copyright (C) 2026 FaiThiX

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

const RESTRICTED_SERVER_PATTERNS = [
    {
        pattern: /rust\s*spain|rustspain/i,
        name: 'RustSpain'
    }
];

function getSearchText(serverId, server) {
    return [
        serverId,
        server.title,
        server.description,
        server.url,
        server.connect,
        server.serverIp
    ].filter(Boolean).join(' ');
}

module.exports = {
    getRestriction: function (serverId, server) {
        if (!server) return null;

        const searchText = getSearchText(serverId, server);
        return RESTRICTED_SERVER_PATTERNS.find(restriction => restriction.pattern.test(searchText)) || null;
    },

    isRestricted: function (serverId, server) {
        return module.exports.getRestriction(serverId, server) !== null;
    }
}
