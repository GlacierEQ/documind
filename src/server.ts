import express from 'express';
import path from 'path';
import https from 'https';
import fs from 'fs';
import { ServerConfig } from './config/config';
import { setupAuth } from './auth/auth';
import { apiRouter } from './api/router';
import { logger } from './utils/logger';
import { setupApryseViewer } from './pdf/apryse';

export async function startServer(config: ServerConfig) {
    const app = express();

    // Body parser middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Serve static files
    app.use(express.static(path.join(__dirname, '../public')));

    // Set up authentication
    setupAuth(app);

    // API routes
    app.use('/api', apiRouter);

    // Set up PDF viewer with Apryse
    setupApryseViewer(app);

    // Fallback route for SPA
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../public', 'index.html'));
    });

    // Error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        logger.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    });

    // Start server
    let server;

    if (!config.disableTls && config.tlsCert && config.tlsKey) {
        // HTTPS server
        const httpsOptions = {
            key: fs.readFileSync(config.tlsKey),
            cert: fs.readFileSync(config.tlsCert)
        };
        server = https.createServer(httpsOptions, app);
    } else {
        // HTTP server
        server = app;
    }

    return server.listen(config.port);
}
