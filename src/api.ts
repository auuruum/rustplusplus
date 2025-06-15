const express = require('express');
const fs = require('fs').promises;
const path = require('path');

class ApiServer {
    private app: any;
    private port: number;
    
    constructor(port = 8074) {
        this.port = port;
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware(): void {
        // Enable CORS for all routes
        this.app.use((req: any, res: any, next: any) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });

        // Parse JSON bodies
        this.app.use(express.json());
    }

    setupRoutes(): void {
        // Health check endpoint
        this.app.get('/health', (req: any, res: any) => {
            res.json({ status: 'ok' });
        });

        // Get server info by guild ID
        this.app.get('/:guildId', async (req: any, res: any) => {
            try {
                const guildId = req.params.guildId;
                const filePath = path.join(__dirname, '..', 'instances', `${guildId}.json`);
                
                // Read the instance file
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
                console.error('API Error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }

    start(): void {
        this.app.listen(this.port, () => {
            console.log(`API server running on http://localhost:${this.port}`);
        });
    }
}

export default ApiServer;
