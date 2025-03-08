import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Create logs directory if it doesn't exist
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
);

// Create the logger
export const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'documind' },
    transports: [
        // Console output
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        // File output - error logs
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error'
        }),
        // File output - all logs
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log')
        })
    ]
});

// Add performance logging methods
export const performance = {
    start: (label: string) => {
        const startTime = process.hrtime();
        return () => {
            const elapsed = process.hrtime(startTime);
            const elapsedMs = (elapsed[0] * 1000 + elapsed[1] / 1e6).toFixed(2);
            logger.debug(`Performance [${label}]: ${elapsedMs}ms`);
            return parseFloat(elapsedMs);
        };
    }
};
