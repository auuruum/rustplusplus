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
    }

    public start(): void {
        this.app.listen(this.port, () => {
            console.log(`API server listening on port ${this.port}`);
        });
    }
}

export default ApiServer;
