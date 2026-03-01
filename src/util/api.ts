import express, { Express, Request, Response, RequestHandler } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';

class ApiServer {
    private app: Express;
    private port: number;

    constructor(port: number = 8074) {
        this.app = express();
        this.port = port;
        this.setupMiddlewares();
        this.setupRoutes();
    }

    private setupMiddlewares(): void {
        // Enable CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });
        
        // Parse JSON bodies
        this.app.use(express.json());
    }

    private setupRoutes(): void {
        // Health check endpoint
        this.app.get('/health', (req: Request, res: Response) => {
            res.json({ status: 'ok' });
        });

        // Get time info by guild ID
        this.app.get('/:guildId/time', (async (req: Request, res: Response) => {
            try {
                const { guildId } = req.params;
                
                // Get rustplus instance from the client exports
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                
                if (!rustplus) {
                    return res.status(404).json({
                        error: 'rustplusplus instance not found for this guild'
                    });
                }

                // Check if time is available
                if (!rustplus.time) {
                    return res.status(503).json({
                        error: 'Time data not yet available',
                        details: 'The server connection is established but time data has not been received yet'
                    });
                }

                const time = rustplus.time;

                // Helper function to format time from decimal to HH:MM
                const formatTime = (decimalTime: number): string => {
                    const hours = Math.floor(decimalTime);
                    const minutes = Math.floor((decimalTime - hours) * 60);
                    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                };

                // Safely get time data with null checks
                const timeData = {
                    currentTime: time.time || null,
                    currentTimeFormatted: time.time ? formatTime(time.time) : null,
                    isDay: typeof time.isDay === 'function' ? time.isDay() : null,
                    timeTillChange: typeof time.getTimeTillDayOrNight === 'function' ? time.getTimeTillDayOrNight() : null,
                    sunrise: time.sunrise || null,
                    sunriseFormatted: time.sunrise ? formatTime(time.sunrise) : null,
                    sunset: time.sunset || null,
                    sunsetFormatted: time.sunset ? formatTime(time.sunset) : null,
                    dayLengthMinutes: time.dayLengthMinutes || null,
                    timeScale: time.timeScale || null
                };
                
                return res.json(timeData);
            } catch (error) {
                console.error('Error in time endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get server population info by guild ID
        this.app.get('/:guildId/pop', (async (req: Request, res: Response) => {
            try {
                const { guildId } = req.params;
                
                // Get rustplus instance from the client exports
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                
                if (!rustplus) {
                    return res.status(404).json({
                        error: 'rustplusplus instance not found for this guild'
                    });
                }

                // Check if server info is available
                if (!rustplus.info) {
                    return res.status(503).json({
                        error: 'Server info not yet available',
                        details: 'The server connection is established but server info has not been received yet'
                    });
                }

                // Get population data
                const popData = {
                    currentPlayers: rustplus.info.players || 0,
                    maxPlayers: rustplus.info.maxPlayers || 0,
                    queuedPlayers: rustplus.info.queuedPlayers || 0
                };
                
                return res.json(popData);
            } catch (error) {
                console.error('Error in population endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get current events by guild ID - mirrors getUpdateEventInformationEmbed
        this.app.get('/:guildId/events', (async (req: Request, res: Response) => {
            try {
                const { guildId } = req.params;

                // Get rustplus instance from the client exports
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];

                if (!rustplus) {
                    return res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                }

                const instance = client.getInstance(guildId);
                if (!instance) {
                    return res.status(404).json({
                        error: 'Guild instance not found'
                    });
                }

                const response = {
                    title: client.intlGet(guildId, 'eventInfo'),
                    description: client.intlGet(guildId, 'inGameEventInfo'),
                    server: instance.serverList[rustplus.serverId]?.title ?? null,
                    fields: [
                        {
                            name: client.intlGet(guildId, 'cargoship'),
                            value: rustplus.getCommandCargo(true)
                        },
                        {
                            name: client.intlGet(guildId, 'patrolHelicopter'),
                            value: rustplus.getCommandHeli(true)
                        },
                        {
                            name: client.intlGet(guildId, 'smallOilRig'),
                            value: rustplus.getCommandSmall(true)
                        },
                        {
                            name: client.intlGet(guildId, 'largeOilRig'),
                            value: rustplus.getCommandLarge(true)
                        },
                        {
                            name: client.intlGet(guildId, 'chinook47'),
                            value: rustplus.getCommandChinook(true)
                        },
                        {
                            name: client.intlGet(guildId, 'travelingVendor'),
                            value: rustplus.getCommandTravelingVendor(true)
                        },
                        {
                            name: client.intlGet(guildId, 'deepSea'),
                            value: rustplus.getCommandDeepSea(true)
                        }
                    ]
                };

                return res.json(response);
            } catch (error) {
                console.error('Error in events endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);        // Get switches info by guild ID - shows connected server switches or active server switches if not connected
        this.app.get('/:guildId/switches', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;
                
                // Get rustplus instance from the client exports
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                let switches = {};
                
                if (!rustplus) {
                    res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                    return;
                }

                if (rustplus.connected && rustplus.switches) {
                    // If connected, use live switches data
                    switches = rustplus.switches;
                } else {
                    // If not connected, read from instance file
                    try {
                        const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                        const fileContent = await fs.readFile(filePath, 'utf-8');
                        const instanceData = JSON.parse(fileContent);
                        
                        // Get active server switches
                        const activeServer = instanceData.activeServer;
                        if (activeServer && instanceData.serverList?.[activeServer]?.switches) {
                            switches = instanceData.serverList[activeServer].switches;
                        }
                    } catch (fileError) {
                        console.error('Error reading instance file:', fileError);
                        res.status(500).json({ 
                            error: 'Error reading instance data',
                            details: fileError instanceof Error ? fileError.message : String(fileError)
                        });
                        return;
                    }
                }

                // Format switches data
                const formattedSwitches = Object.entries(switches).map(([id, switchData]: [string, any]) => ({
                    id,
                    name: switchData.name,
                    active: switchData.active,
                    reachable: switchData.reachable,
                    image: switchData.image,
                    location: switchData.location,
                    coordinates: {
                        x: switchData.x,
                        y: switchData.y
                    },
                    command: switchData.command,
                    autoDayNightOnOff: switchData.autoDayNightOnOff,
                    server: switchData.server,
                    proximity: switchData.proximity,
                    messageId: switchData.messageId
                }));
                
                // Return the switches info
                res.json({
                    total: formattedSwitches.length,
                    connected: rustplus.connected || false,
                    switches: formattedSwitches
                });
                
            } catch (error) {
                console.error('Error in switches endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get alarms info by guild ID - shows connected server alarms or active server alarms if not connected
        this.app.get('/:guildId/alarms', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;

                // Get rustplus instance from the client exports
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                let alarms: any = {};

                if (!rustplus) {
                    res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                    return;
                }

                if (rustplus.connected && rustplus.alarms) {
                    // If connected, use live alarms data
                    alarms = rustplus.alarms;
                } else {
                    // If not connected, read from instance file
                    try {
                        const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                        const fileContent = await fs.readFile(filePath, 'utf-8');
                        const instanceData = JSON.parse(fileContent);

                        // Get active server alarms
                        const activeServer = instanceData.activeServer;
                        if (activeServer && instanceData.serverList?.[activeServer]?.alarms) {
                            alarms = instanceData.serverList[activeServer].alarms;
                        }
                    } catch (fileError) {
                        console.error('Error reading instance file:', fileError);
                        res.status(500).json({ 
                            error: 'Error reading instance data',
                            details: fileError instanceof Error ? fileError.message : String(fileError)
                        });
                        return;
                    }
                }

                // Format alarms data
                const formattedAlarms = Object.entries(alarms).map(([id, alarmData]: [string, any]) => ({
                    id,
                    name: alarmData.name,
                    active: alarmData.active,
                    reachable: alarmData.reachable,
                    image: alarmData.image,
                    message: alarmData.message,
                    everyone: alarmData.everyone,
                    lastTrigger: alarmData.lastTrigger,
                    location: alarmData.location,
                    coordinates: {
                        x: alarmData.x,
                        y: alarmData.y
                    },
                    command: alarmData.command,
                    server: alarmData.server
                }));

                // Return the alarms info
                res.json({
                    total: formattedAlarms.length,
                    connected: rustplus.connected || false,
                    alarms: formattedAlarms
                });

            } catch (error) {
                console.error('Error in alarms endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get server info by guild ID
        this.app.get('/:guildId', (async (req: Request, res: Response) => {
            try {
                const { guildId } = req.params;
                const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                
                try {
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const instanceData = JSON.parse(fileContent);
                    
                    // Extract active server info from serverList
                    const activeServer = instanceData.activeServer;
                    if (!activeServer || !instanceData.serverList || !instanceData.serverList[activeServer]) {
                        return res.status(404).json({ 
                            error: 'Active server not found',
                            activeServer,
                            availableServers: instanceData.serverList ? Object.keys(instanceData.serverList) : []
                        });
                    }
                    
                    // Get the server data and remove time-related fields
                    const serverData = { ...instanceData.serverList[activeServer] };
                    delete serverData.timeTillDay;
                    delete serverData.timeTillNight;
                    
                    // Return the active server info
                    res.json({
                        activeServer,
                        server: serverData
                    });
                    
                } catch (error: any) {
                    if (error.code === 'ENOENT') {
                        return res.status(404).json({ error: 'Guild not found' });
                    }
                    console.error('Error reading instance file:', error);
                    res.status(500).json({ error: 'Internal server error' });
                }
            } catch (error) {
                console.error('Error processing request:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        }) as RequestHandler);

        // Toggle smart switch state by switch ID
        this.app.post('/:guildId/switches/:switchId/toggle', (async (req: Request, res: Response) => {
            try {
                const { guildId, switchId } = req.params;
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];

                if (!rustplus) {
                    return res.status(404).json({ error: 'RustPlus instance not found for this guild' });
                }

                const instance = client.getInstance(guildId);
                const serverId = rustplus.serverId;

                if (!instance.serverList.hasOwnProperty(serverId)) {
                    return res.status(404).json({ error: 'Server not found in instance' });
                }

                const switchData = instance.serverList[serverId].switches[switchId];

                if (!switchData) {
                    return res.status(404).json({ error: 'Switch not found' });
                }

                // Toggle the switch active state
                const newActiveState = !switchData.active;

                let response;
                if (newActiveState) {
                    response = await rustplus.turnSmartSwitchOnAsync(switchId);
                } else {
                    response = await rustplus.turnSmartSwitchOffAsync(switchId);
                }

                if (!(await rustplus.isResponseValid(response))) {
                    if (switchData.reachable) {
                        const DiscordMessages = require('../discordTools/discordMessages.js');
                        await DiscordMessages.sendSmartSwitchNotFoundMessage(guildId, serverId, switchId);
                    }
                    instance.serverList[serverId].switches[switchId].reachable = false;
                    client.setInstance(guildId, instance);
                    return res.status(500).json({ error: 'Failed to toggle switch' });
                }

                instance.serverList[serverId].switches[switchId].active = newActiveState;
                instance.serverList[serverId].switches[switchId].reachable = true;
                client.setInstance(guildId, instance);

                const DiscordMessages = require('../discordTools/discordMessages.js');
                await DiscordMessages.sendSmartSwitchMessage(guildId, serverId, switchId);

                res.json({
                    switchId,
                    newActiveState
                });
            } catch (error) {
                console.error('Error toggling switch:', error);
                res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
            }
        }) as RequestHandler);

        this.app.get('/:guildId/switchgroups', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;

                // Get rustplus instance from the client exports
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                let switchGroups: any = {};

                if (!rustplus) {
                    res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                    return;
                }

                if (rustplus.connected && rustplus.switchGroups) {
                    // If connected, use live switch groups data
                    switchGroups = rustplus.switchGroups;
                } else {
                    // If not connected, read from instance file
                    try {
                        const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                        const fileContent = await fs.readFile(filePath, 'utf-8');
                        const instanceData = JSON.parse(fileContent);

                        // Get active server switch groups
                        const activeServer = instanceData.activeServer;
                        if (activeServer && instanceData.serverList?.[activeServer]?.switchGroups) {
                            switchGroups = instanceData.serverList[activeServer].switchGroups;
                        }
                    } catch (fileError) {
                        console.error('Error reading instance file:', fileError);
                        res.status(500).json({ 
                            error: 'Error reading instance data',
                            details: fileError instanceof Error ? fileError.message : String(fileError)
                        });
                        return;
                    }
                }

                // Format switch groups data
                const formattedSwitchGroups = Object.entries(switchGroups).map(([id, groupData]: [string, any]) => ({
                    id,
                    name: groupData.name,
                    command: groupData.command,
                    switches: groupData.switches || [],
                    image: groupData.image,
                    messageId: groupData.messageId
                }));

                // Return the switch groups info
                res.json({
                    total: formattedSwitchGroups.length,
                    connected: rustplus.connected || false,
                    switchGroups: formattedSwitchGroups
                });

            } catch (error) {
                console.error('Error in switch groups endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        this.app.post('/:guildId/switchgroups/:groupId/on', (async (req: Request, res: Response) => {
            try {
                const { guildId, groupId } = req.params;
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];

                if (!rustplus) {
                    return res.status(404).json({ error: 'RustPlus instance not found for this guild' });
                }

                const instance = client.getInstance(guildId);
                const serverId = rustplus.serverId;

                if (!instance.serverList.hasOwnProperty(serverId)) {
                    return res.status(404).json({ error: 'Server not found in instance' });
                }

                const groupData = instance.serverList[serverId].switchGroups[groupId];

                if (!groupData) {
                    return res.status(404).json({ error: 'Switch group not found' });
                }

                // Use the existing TurnOnOffGroup function
                const smartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');
                await smartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, guildId, serverId, groupId, true);

                res.json({
                    groupId,
                    action: 'on',
                    groupName: groupData.name,
                    switchCount: groupData.switches ? groupData.switches.length : 0
                });
            } catch (error) {
                console.error('Error turning switch group on:', error);
                res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
            }
        }) as RequestHandler);

        // Turn switch group OFF by group ID
        this.app.post('/:guildId/switchgroups/:groupId/off', (async (req: Request, res: Response) => {
            try {
                const { guildId, groupId } = req.params;
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];

                if (!rustplus) {
                    return res.status(404).json({ error: 'RustPlus instance not found for this guild' });
                }

                const instance = client.getInstance(guildId);
                const serverId = rustplus.serverId;

                if (!instance.serverList.hasOwnProperty(serverId)) {
                    return res.status(404).json({ error: 'Server not found in instance' });
                }

                const groupData = instance.serverList[serverId].switchGroups[groupId];

                if (!groupData) {
                    return res.status(404).json({ error: 'Switch group not found' });
                }

                // Use the existing TurnOnOffGroup function
                const smartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');
                await smartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, guildId, serverId, groupId, false);

                res.json({
                    groupId,
                    action: 'off',
                    groupName: groupData.name,
                    switchCount: groupData.switches ? groupData.switches.length : 0
                });
            } catch (error) {
                console.error('Error turning switch group off:', error);
                res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
            }
        }) as RequestHandler);

        // Get all trackers for a guild
        this.app.get('/:guildId/trackers', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;
                const client = require('../../index').client;

                const instance = client?.getInstance(guildId);
                if (!instance) {
                    res.status(404).json({ error: 'Guild instance not found' });
                    return;
                }

                const trackers = instance.trackers ?? {};

                const result = Object.entries(trackers).map(([id, tracker]: [string, any]) => {
                    const bmInstance = client?.battlemetricsInstances?.[tracker.battlemetricsId];
                    const successful = bmInstance?.lastUpdateSuccessful ?? false;

                    const players = (tracker.players ?? []).map((player: any) => {
                        let status: string;
                        let time: string | null = null;

                        if (!bmInstance || !successful) {
                            status = 'unknown';
                        } else if (!bmInstance.players?.hasOwnProperty(player.playerId)) {
                            status = 'not_found';
                        } else if (bmInstance.players[player.playerId]['status']) {
                            status = 'online';
                            const t = bmInstance.getOnlineTime(player.playerId);
                            time = t ? t[1] : null;
                        } else {
                            status = 'offline';
                            const t = bmInstance.getOfflineTime(player.playerId);
                            time = t ? t[1] : null;
                        }

                        return {
                            name: player.name,
                            steamId: player.steamId ?? null,
                            battlemetricsId: player.playerId ?? null,
                            status,
                            time
                        };
                    });

                    return {
                        id,
                        trackerId: tracker.trackerId,
                        name: tracker.name,
                        serverId: tracker.serverId,
                        battlemetricsId: tracker.battlemetricsId,
                        title: tracker.title,
                        img: tracker.img,
                        clanTag: tracker.clanTag,
                        everyone: tracker.everyone,
                        inGame: tracker.inGame,
                        serverStatus: !bmInstance ? 'unknown' : (bmInstance.server_status ? 'online' : 'offline'),
                        streamerMode: bmInstance ? bmInstance.streamerMode : null,
                        messageId: tracker.messageId ?? null,
                        createdAt: tracker.createdAt ?? null,
                        players
                    };
                });

                res.json({
                    total: result.length,
                    trackers: result
                });
            } catch (error) {
                console.error('Error in trackers endpoint:', error);
                res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
            }
        }) as RequestHandler);

        // Get a single tracker by ID
        this.app.get('/:guildId/trackers/:trackerId', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId, trackerId } = req.params;
                const client = require('../../index').client;

                const instance = client?.getInstance(guildId);
                if (!instance) {
                    res.status(404).json({ error: 'Guild instance not found' });
                    return;
                }

                const tracker = instance.trackers?.[trackerId];
                if (!tracker) {
                    res.status(404).json({ error: 'Tracker not found' });
                    return;
                }

                const bmInstance = client?.battlemetricsInstances?.[tracker.battlemetricsId];
                const successful = bmInstance?.lastUpdateSuccessful ?? false;

                const players = (tracker.players ?? []).map((player: any) => {
                    let status: string;
                    let time: string | null = null;

                    if (!bmInstance || !successful) {
                        status = 'unknown';
                    } else if (!bmInstance.players?.hasOwnProperty(player.playerId)) {
                        status = 'not_found';
                    } else if (bmInstance.players[player.playerId]['status']) {
                        status = 'online';
                        const t = bmInstance.getOnlineTime(player.playerId);
                        time = t ? t[1] : null;
                    } else {
                        status = 'offline';
                        const t = bmInstance.getOfflineTime(player.playerId);
                        time = t ? t[1] : null;
                    }

                    return {
                        name: player.name,
                        steamId: player.steamId ?? null,
                        battlemetricsId: player.playerId ?? null,
                        status,
                        time
                    };
                });

                res.json({
                    id: trackerId,
                    trackerId: tracker.trackerId,
                    name: tracker.name,
                    serverId: tracker.serverId,
                    battlemetricsId: tracker.battlemetricsId,
                    title: tracker.title,
                    img: tracker.img,
                    clanTag: tracker.clanTag,
                    everyone: tracker.everyone,
                    inGame: tracker.inGame,
                    serverStatus: !bmInstance ? 'unknown' : (bmInstance.server_status ? 'online' : 'offline'),
                    streamerMode: bmInstance ? bmInstance.streamerMode : null,
                    messageId: tracker.messageId ?? null,
                    createdAt: tracker.createdAt ?? null,
                    players
                });
            } catch (error) {
                console.error('Error in tracker/:trackerId endpoint:', error);
                res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
            }
        }) as RequestHandler);
    }

    public start(): void {
        this.app.listen(this.port, () => {
            console.log(`API server listening on port ${this.port}`);
        });
    }
}

export default ApiServer;