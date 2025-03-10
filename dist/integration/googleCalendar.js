"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeGoogleCalendar = initializeGoogleCalendar;
exports.addEventToGoogleCalendar = addEventToGoogleCalendar;
exports.getUpcomingEvents = getUpcomingEvents;
exports.updateCalendarEvent = updateCalendarEvent;
exports.deleteCalendarEvent = deleteCalendarEvent;
const googleapis_1 = require("googleapis");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
let googleAuth = null;
/**
 * Initialize Google Calendar API
 */
async function initializeGoogleCalendar() {
    try {
        const config = (0, config_1.loadConfig)();
        if (!config.googleCalendar?.enabled) {
            logger_1.logger.info('Google Calendar integration is disabled');
            return false;
        }
        logger_1.logger.info('Initializing Google Calendar integration');
        // Check for credentials file
        const credentialsPath = config.googleCalendar.credentialsPath || path_1.default.join(process.cwd(), 'credentials', 'google-calendar.json');
        let credentials;
        try {
            const content = await promises_1.default.readFile(credentialsPath, 'utf8');
            credentials = JSON.parse(content);
        }
        catch (error) {
            logger_1.logger.error('Error reading Google Calendar credentials file:', error);
            return false;
        }
        // Create OAuth2 client
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        googleAuth = new googleapis_1.google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        // Check for token file
        const tokenPath = config.googleCalendar.tokenPath || path_1.default.join(process.cwd(), 'credentials', 'google-token.json');
        try {
            const token = await promises_1.default.readFile(tokenPath, 'utf8');
            googleAuth.setCredentials(JSON.parse(token));
            logger_1.logger.info('Google Calendar integration initialized successfully');
            return true;
        }
        catch (error) {
            logger_1.logger.error('Error reading Google Calendar token:', error);
            logger_1.logger.info('Please run the token generation script to authorize Google Calendar access');
            return false;
        }
    }
    catch (error) {
        logger_1.logger.error('Error initializing Google Calendar:', error);
        return false;
    }
}
/**
 * Add event to Google Calendar
 * @param title Event title
 * @param description Event description
 * @param date Event date and time
 * @param reminderDays Days before event to send reminder
 * @returns Event ID if successful, null otherwise
 */
async function addEventToGoogleCalendar(title, description, date, reminderDays = 3) {
    try {
        if (!googleAuth) {
            const initialized = await initializeGoogleCalendar();
            if (!initialized) {
                logger_1.logger.warn('Google Calendar not initialized, cannot add event');
                return null;
            }
        }
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth: googleAuth });
        const config = (0, config_1.loadConfig)();
        // Create event
        const event = {
            summary: title,
            description: description,
            start: {
                dateTime: date.toISOString(),
                timeZone: config.googleCalendar?.timeZone || 'America/New_York',
            },
            end: {
                dateTime: new Date(date.getTime() + 30 * 60000).toISOString(), // Default 30 minutes duration
                timeZone: config.googleCalendar?.timeZone || 'America/New_York',
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: reminderDays * 24 * 60 },
                    { method: 'popup', minutes: 60 }, // 1 hour before
                ],
            },
            colorId: config.googleCalendar?.defaultColorId || '1', // Default color (blue)
        };
        // Insert event
        const response = await calendar.events.insert({
            calendarId: config.googleCalendar?.calendarId || 'primary',
            requestBody: event,
        });
        logger_1.logger.info(`Event created: ${response.data.htmlLink}, ID: ${response.data.id}`);
        return response.data.id || null;
    }
    catch (error) {
        logger_1.logger.error('Error adding event to Google Calendar:', error);
        return null;
    }
}
/**
 * Get upcoming events from Google Calendar
 * @param days Number of days to look ahead
 * @returns Array of upcoming events
 */
async function getUpcomingEvents(days = 14) {
    try {
        if (!googleAuth) {
            const initialized = await initializeGoogleCalendar();
            if (!initialized) {
                logger_1.logger.warn('Google Calendar not initialized, cannot get events');
                return [];
            }
        }
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth: googleAuth });
        const config = (0, config_1.loadConfig)();
        // Calculate time range
        const now = new Date();
        const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        // Get events
        const response = await calendar.events.list({
            calendarId: config.googleCalendar?.calendarId || 'primary',
            timeMin: now.toISOString(),
            timeMax: future.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        return response.data.items || [];
    }
    catch (error) {
        logger_1.logger.error('Error getting events from Google Calendar:', error);
        return [];
    }
}
/**
 * Update Google Calendar event
 * @param eventId Event ID
 * @param updates Updates to apply
 * @returns Updated event if successful, null otherwise
 */
async function updateCalendarEvent(eventId, updates) {
    try {
        if (!googleAuth) {
            const initialized = await initializeGoogleCalendar();
            if (!initialized) {
                logger_1.logger.warn('Google Calendar not initialized, cannot update event');
                return null;
            }
        }
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth: googleAuth });
        const config = (0, config_1.loadConfig)();
        // Get current event
        const currentEvent = await calendar.events.get({
            calendarId: config.googleCalendar?.calendarId || 'primary',
            eventId: eventId,
        });
        // Merge updates with current event
        const updatedEvent = {
            ...currentEvent.data,
            ...updates,
        };
        // Update event
        const response = await calendar.events.update({
            calendarId: config.googleCalendar?.calendarId || 'primary',
            eventId: eventId,
            requestBody: updatedEvent,
        });
        logger_1.logger.info(`Event updated: ${response.data.htmlLink}`);
        return response.data;
    }
    catch (error) {
        logger_1.logger.error('Error updating Google Calendar event:', error);
        return null;
    }
}
/**
 * Delete Google Calendar event
 * @param eventId Event ID
 * @returns True if successful, false otherwise
 */
async function deleteCalendarEvent(eventId) {
    try {
        if (!googleAuth) {
            const initialized = await initializeGoogleCalendar();
            if (!initialized) {
                logger_1.logger.warn('Google Calendar not initialized, cannot delete event');
                return false;
            }
        }
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth: googleAuth });
        const config = (0, config_1.loadConfig)();
        await calendar.events.delete({
            calendarId: config.googleCalendar?.calendarId || 'primary',
            eventId: eventId,
        });
        logger_1.logger.info(`Event deleted: ${eventId}`);
        return true;
    }
    catch (error) {
        logger_1.logger.error('Error deleting Google Calendar event:', error);
        return false;
    }
}
