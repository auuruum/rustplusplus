import express, { Express, Request, Response, RequestHandler } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

interface WebSocketClient {
    ws: WebSocket;
    guildId: string;
    subscriptions: Set<string>;
}

class ApiServer {
    private app: Express;
    private server: any;
    private wss: WebSocketServer;
    private port: number;
    private clients: Map<WebSocket, WebSocketClient> = new Map();
    private updateIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(port: number = 8074) {
        this.app = express();
        this.port = port;
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });
        
        this.setupMiddlewares();
        this.setupRoutes();
        this.setupWebSocket();
    }

    private setupMiddlewares(): void {
        // Enable CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            next();
        });
        
        // Parse JSON bodies
        this.app.use(express.json());
    }

    private setupWebSocket(): void {
        this.wss.on('connection', (ws: WebSocket, req) => {
            console.log('New WebSocket connection established');

            const clientInfo: WebSocketClient = {
                ws,
                guildId: '',
                subscriptions: new Set()
            };
            this.clients.set(ws, clientInfo);

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleWebSocketMessage(ws, message);
                } catch (error) {
                    console.error('Invalid WebSocket message:', error);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Invalid message format' 
                    }));
                }
            });

            ws.on('close', () => {
                console.log('WebSocket connection closed');
                this.clients.delete(ws);
                this.cleanupClientSubscriptions();
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.clients.delete(ws);
                this.cleanupClientSubscriptions();
            });

            // Send initial connection confirmation
            ws.send(JSON.stringify({
                type: 'connected',
                message: 'WebSocket connection established',
                availableSubscriptions: [
                    'time', 'pop', 'events', 'switches', 'alarms', 'switchgroups', 'server'
                ]
            }));
        });
    }

    private handleWebSocketMessage(ws: WebSocket, message: any): void {
        const client = this.clients.get(ws);
        if (!client) return;

        switch (message.type) {
            case 'subscribe':
                if (message.guildId && message.endpoints) {
                    client.guildId = message.guildId;
                    
                    // Add new subscriptions
                    message.endpoints.forEach((endpoint: string) => {
                        client.subscriptions.add(endpoint);
                    });

                    // Start sending updates for this guild
                    this.startUpdatesForGuild(message.guildId);

                    ws.send(JSON.stringify({
                        type: 'subscription_confirmed',
                        guildId: message.guildId,
                        endpoints: Array.from(client.subscriptions)
                    }));
                }
                break;

            case 'unsubscribe':
                if (message.endpoints) {
                    message.endpoints.forEach((endpoint: string) => {
                        client.subscriptions.delete(endpoint);
                    });

                    ws.send(JSON.stringify({
                        type: 'unsubscription_confirmed',
                        endpoints: message.endpoints
                    }));
                }
                break;

            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;

            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Unknown message type'
                }));
        }
    }

    private startUpdatesForGuild(guildId: string): void {
        // Don't create duplicate intervals
        if (this.updateIntervals.has(guildId)) {
            return;
        }

        // Send updates every 500 ms
        const interval = setInterval(() => {
            this.sendUpdatesToGuildClients(guildId);
        }, 500);

        this.updateIntervals.set(guildId, interval);
    }

    private async sendUpdatesToGuildClients(guildId: string): Promise<void> {
        const guildClients = Array.from(this.clients.values()).filter(
            client => client.guildId === guildId && client.ws.readyState === WebSocket.OPEN
        );

        if (guildClients.length === 0) {
            // No active clients for this guild, clean up
            const interval = this.updateIntervals.get(guildId);
            if (interval) {
                clearInterval(interval);
                this.updateIntervals.delete(guildId);
            }
            return;
        }

        // Collect unique subscriptions for this guild
        const uniqueSubscriptions = new Set<string>();
        guildClients.forEach(client => {
            client.subscriptions.forEach(sub => uniqueSubscriptions.add(sub));
        });

        // Fetch data for each subscription
        const updates: any = {};

        for (const subscription of uniqueSubscriptions) {
            try {
                let data;
                switch (subscription) {
                    case 'time':
                        data = await this.getTimeData(guildId);
                        break;
                    case 'pop':
                        data = await this.getPopData(guildId);
                        break;
                    case 'events':
                        data = await this.getEventsData(guildId);
                        break;
                    case 'switches':
                        data = await this.getSwitchesData(guildId);
                        break;
                    case 'alarms':
                        data = await this.getAlarmsData(guildId);
                        break;
                    case 'switchgroups':
                        data = await this.getSwitchGroupsData(guildId);
                        break;
                    case 'server':
                        data = await this.getServerData(guildId);
                        break;
                }
                if (data) {
                    updates[subscription] = data;
                }
            } catch (error) {
                console.error(`Error fetching ${subscription} data for guild ${guildId}:`, error);
            }
        }

        // Send updates to clients
        const message = JSON.stringify({
            type: 'update',
            guildId,
            timestamp: new Date().toISOString(),
            data: updates
        });

        guildClients.forEach(client => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(message);
            }
        });
    }

    private cleanupClientSubscriptions(): void {
        // Clean up intervals that no longer have active clients
        for (const [guildId, interval] of this.updateIntervals.entries()) {
            const hasActiveClients = Array.from(this.clients.values()).some(
                client => client.guildId === guildId && client.ws.readyState === WebSocket.OPEN
            );
            
            if (!hasActiveClients) {
                clearInterval(interval);
                this.updateIntervals.delete(guildId);
            }
        }
    }

    // Data fetching methods for WebSocket updates
    private async getTimeData(guildId: string): Promise<any> {
        try {
            const client = require('../../index').client;
            const rustplus = client?.rustplusInstances?.[guildId];
            
            if (!rustplus || !rustplus.time) {
                return null;
            }

            const time = rustplus.time;
            const formatTime = (decimalTime: number): string => {
                const hours = Math.floor(decimalTime);
                const minutes = Math.floor((decimalTime - hours) * 60);
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            };

            return {
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
        } catch (error) {
            return null;
        }
    }

    private async getPopData(guildId: string): Promise<any> {
        try {
            const client = require('../../index').client;
            const rustplus = client?.rustplusInstances?.[guildId];
            
            if (!rustplus || !rustplus.info) {
                return null;
            }

            return {
                currentPlayers: rustplus.info.players || 0,
                maxPlayers: rustplus.info.maxPlayers || 0,
                queuedPlayers: rustplus.info.queuedPlayers || 0
            };
        } catch (error) {
            return null;
        }
    }

    private async getEventsData(guildId: string): Promise<any> {
        try {
            const client = require('../../index').client;
            const rustplus = client?.rustplusInstances?.[guildId];
            
            if (!rustplus) {
                return null;
            }

            const events = [];

            if (rustplus.bradleyAPC) {
                events.push('Bradley APC active');
            }

            if (rustplus.cargoShip) {
                const status = rustplus.cargoShip.isEgressing ? 'leaving the island' : 'on the island';
                events.push(`Cargo Ship ${status}`);
            }

            if (rustplus.patrol_helicopter) {
                events.push('Patrol Helicopter active');
            }

            if (rustplus.smallOilRig?.hasLockedCrate) {
                events.push('Small Oil Rig has locked crate');
            }

            if (rustplus.largeOilRig?.hasLockedCrate) {
                events.push('Large Oil Rig has locked crate');
            }

            if (rustplus.ch47) {
                events.push('CH47 active');
            }

            return {
                events: events,
                message: events.length > 0 ? 
                    `Current events:\n${events.join('\n')}` : 
                    'No registered events at this time.'
            };
        } catch (error) {
            return null;
        }
    }

    private async getSwitchesData(guildId: string): Promise<any> {
        try {
            const client = require('../../index').client;
            const rustplus = client?.rustplusInstances?.[guildId];
            let switches = {};
            
            if (!rustplus) {
                return null;
            }

            if (rustplus.connected && rustplus.switches) {
                switches = rustplus.switches;
            } else {
                try {
                    const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const instanceData = JSON.parse(fileContent);
                    
                    const activeServer = instanceData.activeServer;
                    if (activeServer && instanceData.serverList?.[activeServer]?.switches) {
                        switches = instanceData.serverList[activeServer].switches;
                    }
                } catch (fileError) {
                    return null;
                }
            }

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
            
            return {
                total: formattedSwitches.length,
                connected: rustplus.connected || false,
                switches: formattedSwitches
            };
        } catch (error) {
            return null;
        }
    }

    private async getAlarmsData(guildId: string): Promise<any> {
        try {
            const client = require('../../index').client;
            const rustplus = client?.rustplusInstances?.[guildId];
            let alarms: any = {};

            if (!rustplus) {
                return null;
            }

            if (rustplus.connected && rustplus.alarms) {
                alarms = rustplus.alarms;
            } else {
                try {
                    const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const instanceData = JSON.parse(fileContent);

                    const activeServer = instanceData.activeServer;
                    if (activeServer && instanceData.serverList?.[activeServer]?.alarms) {
                        alarms = instanceData.serverList[activeServer].alarms;
                    }
                } catch (fileError) {
                    return null;
                }
            }

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

            return {
                total: formattedAlarms.length,
                connected: rustplus.connected || false,
                alarms: formattedAlarms
            };
        } catch (error) {
            return null;
        }
    }

    private async getSwitchGroupsData(guildId: string): Promise<any> {
        try {
            const client = require('../../index').client;
            const rustplus = client?.rustplusInstances?.[guildId];
            let switchGroups: any = {};

            if (!rustplus) {
                return null;
            }

            if (rustplus.connected && rustplus.switchGroups) {
                switchGroups = rustplus.switchGroups;
            } else {
                try {
                    const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const instanceData = JSON.parse(fileContent);

                    const activeServer = instanceData.activeServer;
                    if (activeServer && instanceData.serverList?.[activeServer]?.switchGroups) {
                        switchGroups = instanceData.serverList[activeServer].switchGroups;
                    }
                } catch (fileError) {
                    return null;
                }
            }

            const formattedSwitchGroups = Object.entries(switchGroups).map(([id, groupData]: [string, any]) => ({
                id,
                name: groupData.name,
                command: groupData.command,
                switches: groupData.switches || [],
                image: groupData.image,
                messageId: groupData.messageId
            }));

            return {
                total: formattedSwitchGroups.length,
                connected: rustplus.connected || false,
                switchGroups: formattedSwitchGroups
            };
        } catch (error) {
            return null;
        }
    }

    private async getServerData(guildId: string): Promise<any> {
        try {
            const filePath = path.join(process.cwd(), 'instances', `${guildId}.json`);
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const instanceData = JSON.parse(fileContent);
            
            const activeServer = instanceData.activeServer;
            if (!activeServer || !instanceData.serverList || !instanceData.serverList[activeServer]) {
                return null;
            }
            
            const serverData = { ...instanceData.serverList[activeServer] };
            delete serverData.timeTillDay;
            delete serverData.timeTillNight;
            
            return {
                activeServer,
                server: serverData
            };
        } catch (error) {
            return null;
        }
    }

    private setupRoutes(): void {
        // Health check endpoint
        this.app.get('/health', (req: Request, res: Response) => {
            res.json({ 
                status: 'ok',
                websocket: 'enabled',
                clients: this.clients.size,
                activeGuilds: this.updateIntervals.size
            });
        });

        // Get time info by guild ID
        this.app.get('/:guildId/time', (async (req: Request, res: Response) => {
            try {
                const { guildId } = req.params;
                
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                
                if (!rustplus) {
                    return res.status(404).json({
                        error: 'rustplusplus instance not found for this guild'
                    });
                }

                if (!rustplus.time) {
                    return res.status(503).json({
                        error: 'Time data not yet available',
                        details: 'The server connection is established but time data has not been received yet'
                    });
                }

                const timeData = await this.getTimeData(guildId);
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
                
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                
                if (!rustplus) {
                    return res.status(404).json({
                        error: 'rustplusplus instance not found for this guild'
                    });
                }

                if (!rustplus.info) {
                    return res.status(503).json({
                        error: 'Server info not yet available',
                        details: 'The server connection is established but server info has not been received yet'
                    });
                }

                const popData = await this.getPopData(guildId);
                return res.json(popData);
            } catch (error) {
                console.error('Error in population endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get current events by guild ID
        this.app.get('/:guildId/events', (async (req: Request, res: Response) => {
            try {
                const { guildId } = req.params;
                
                const client = require('../../index').client;
                const rustplus = client?.rustplusInstances?.[guildId];
                
                if (!rustplus) {
                    return res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                }

                const eventsData = await this.getEventsData(guildId);
                return res.json(eventsData);
            } catch (error) {
                console.error('Error in events endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get switches info by guild ID
        this.app.get('/:guildId/switches', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;
                const switchesData = await this.getSwitchesData(guildId);
                
                if (!switchesData) {
                    res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                    return;
                }

                res.json(switchesData);
            } catch (error) {
                console.error('Error in switches endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Get alarms info by guild ID
        this.app.get('/:guildId/alarms', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;
                const alarmsData = await this.getAlarmsData(guildId);

                if (!alarmsData) {
                    res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                    return;
                }

                res.json(alarmsData);
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
                const serverData = await this.getServerData(guildId);
                
                if (!serverData) {
                    return res.status(404).json({ error: 'Guild not found or no active server' });
                }
                
                res.json(serverData);
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

                // Immediately send WebSocket update to all connected clients for this guild
                this.sendImmediateUpdate(guildId, 'switches');

                res.json({
                    switchId,
                    newActiveState
                });
            } catch (error) {
                console.error('Error toggling switch:', error);
                res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
            }
        }) as RequestHandler);

        // Get switch groups info by guild ID
        this.app.get('/:guildId/switchgroups', (async (req: Request, res: Response): Promise<void> => {
            try {
                const { guildId } = req.params;
                const switchGroupsData = await this.getSwitchGroupsData(guildId);

                if (!switchGroupsData) {
                    res.status(404).json({
                        error: 'RustPlus instance not found for this guild'
                    });
                    return;
                }

                res.json(switchGroupsData);
            } catch (error) {
                console.error('Error in switch groups endpoint:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        }) as RequestHandler);

        // Turn switch group ON by group ID
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

                const smartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');
                await smartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, guildId, serverId, groupId, true);

                // Send immediate WebSocket updates
                this.sendImmediateUpdate(guildId, 'switches');
                this.sendImmediateUpdate(guildId, 'switchgroups');

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

                const smartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');
                await smartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, guildId, serverId, groupId, false);

                // Send immediate WebSocket updates
                this.sendImmediateUpdate(guildId, 'switches');
                this.sendImmediateUpdate(guildId, 'switchgroups');

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
    }

    // Send immediate update to clients when something changes
    private async sendImmediateUpdate(guildId: string, endpoint: string): Promise<void> {
        const guildClients = Array.from(this.clients.values()).filter(
            client => client.guildId === guildId && 
                     client.subscriptions.has(endpoint) && 
                     client.ws.readyState === WebSocket.OPEN
        );

        if (guildClients.length === 0) {
            return;
        }

        try {
            let data;
            switch (endpoint) {
                case 'time':
                    data = await this.getTimeData(guildId);
                    break;
                case 'pop':
                    data = await this.getPopData(guildId);
                    break;
                case 'events':
                    data = await this.getEventsData(guildId);
                    break;
                case 'switches':
                    data = await this.getSwitchesData(guildId);
                    break;
                case 'alarms':
                    data = await this.getAlarmsData(guildId);
                    break;
                case 'switchgroups':
                    data = await this.getSwitchGroupsData(guildId);
                    break;
                case 'server':
                    data = await this.getServerData(guildId);
                    break;
            }

            if (data) {
                const message = JSON.stringify({
                    type: 'immediate_update',
                    guildId,
                    endpoint,
                    timestamp: new Date().toISOString(),
                    data: { [endpoint]: data }
                });

                guildClients.forEach(client => {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(message);
                    }
                });
            }
        } catch (error) {
            console.error(`Error sending immediate update for ${endpoint}:`, error);
        }
    }

    public start(): void {
        this.server.listen(this.port, () => {
            console.log(`API server with WebSocket support listening on port ${this.port}`);
            console.log(`WebSocket endpoint: ws://localhost:${this.port}`);
            console.log(`HTTP API endpoint: http://localhost:${this.port}`);
        });
    }

    public stop(): void {
        // Clean up intervals
        this.updateIntervals.forEach(interval => clearInterval(interval));
        this.updateIntervals.clear();

        // Close all WebSocket connections
        this.wss.clients.forEach(ws => {
            ws.close(1000, 'Server shutting down');
        });

        // Close the server
        this.server.close(() => {
            console.log('API server stopped');
        });
    }
}

export default ApiServer;