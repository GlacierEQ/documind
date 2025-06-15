"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.performance = exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Create logs directory if it doesn't exist
const logDir = path_1.default.join(process.cwd(), 'logs');
if (!fs_1.default.existsSync(logDir)) {
    fs_1.default.mkdirSync(logDir, { recursive: true });
}
// Define log format
const logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
}));
// Create the logger
exports.logger = winston_1.default.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'documind' },
    transports: [
        // Console output
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), logFormat)
        }),
        // File output - error logs
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, 'error.log'),
            level: 'error'
        }),
        // File output - all logs
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, 'combined.log')
        })
    ]
});
// Add performance logging methods
exports.performance = {
    start: (label) => {
        const startTime = process.hrtime();
        return () => {
            const elapsed = process.hrtime(startTime);
            const elapsedMs = (elapsed[0] * 1000 + elapsed[1] / 1e6).toFixed(2);
            exports.logger.debug(`Performance [${label}]: ${elapsedMs}ms`);
            return parseFloat(elapsedMs);
        };
    }
};
