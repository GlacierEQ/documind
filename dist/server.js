"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const auth_1 = require("./auth/auth");
const router_1 = require("./api/router");
const logger_1 = require("./utils/logger");
const apryse_1 = require("./pdf/apryse");
async function startServer(config) {
    const app = (0, express_1.default)();
    // Body parser middleware
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    // Serve static files
    app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
    // Set up authentication
    (0, auth_1.setupAuth)(app);
    // API routes
    app.use('/api', router_1.apiRouter);
    // Set up PDF viewer with Apryse
    (0, apryse_1.setupApryseViewer)(app);
    // Fallback route for SPA
    app.get('*', (req, res) => {
        res.sendFile(path_1.default.join(__dirname, '../public', 'index.html'));
    });
    // Error handler
    app.use((err, req, res, next) => {
        logger_1.logger.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    });
    // Start server
    let server;
    if (!config.disableTls && config.tlsCert && config.tlsKey) {
        // HTTPS server
        const httpsOptions = {
            key: fs_1.default.readFileSync(config.tlsKey),
            cert: fs_1.default.readFileSync(config.tlsCert)
        };
        server = https_1.default.createServer(httpsOptions, app);
    }
    else {
        // HTTP server
        server = app;
    }
    return server.listen(config.port);
}
