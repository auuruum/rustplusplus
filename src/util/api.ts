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
            console.log(`API server running on http://localhost:${this.port}`);
        });
    }
}

export default ApiServer;
