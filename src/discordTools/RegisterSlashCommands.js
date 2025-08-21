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

const Fs = require("fs");
const Path = require('path');
const Rest = require('@discordjs/rest');
const Types = require('discord-api-types/v9');

const Config = require('../../config');

module.exports = async (client, guild) => {
    // If guild is unavailable or the client is no longer in the guild, skip registration gracefully
    if (!guild || !client.guilds.cache.has(guild.id)) {
        client.log(client.intlGet(null, 'warningCap'), `Skip slash command registration: bot not in guild ${guild?.id || 'unknown'}`);
        return;
    }

    const commands = [];
    const commandFiles = Fs.readdirSync(Path.join(__dirname, '..', 'commands')).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(`../commands/${file}`);
        commands.push(command.getData(client, guild.id).toJSON());
    }

    const rest = new Rest.REST({ version: '9' }).setToken(Config.discord.token);

    try {
        await rest.put(Types.Routes.applicationGuildCommands(Config.discord.clientId, guild.id), { body: commands });
    }
    catch (e) {
        // Handle common cases without crashing the process
        const code = e?.code;
        if (code === 50001 /* Missing Access */ || code === 50013 /* Missing Permissions */ || code === 10004 /* Unknown Guild */) {
            client.log(client.intlGet(null, 'warningCap'), `Could not register slash commands for guild ${guild.id}: ${e.message || code}`);
            return;
        }
        client.log(
            client.intlGet(null, 'errorCap'),
            client.intlGet(null, 'couldNotRegisterSlashCommands', { guildId: guild.id }) +
            client.intlGet(null, 'makeSureApplicationsCommandsEnabled'),
            'error'
        );
        return; // Avoid process.exit for resilience
    }
    client.log(client.intlGet(null, 'infoCap'),
        client.intlGet(null, 'slashCommandsSuccessRegister', { guildId: guild.id }));
};