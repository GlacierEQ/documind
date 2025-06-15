"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAuth = setupAuth;
exports.isAuthenticated = isAuthenticated;
exports.isAdmin = isAdmin;
const passport_1 = __importDefault(require("passport"));
const passport_local_1 = require("passport-local");
const passport_oauth2_1 = require("passport-oauth2");
const passport_ldapauth_1 = require("passport-ldapauth");
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const bcrypt_1 = __importDefault(require("bcrypt"));
// Load configuration
const config_1 = require("../config/config");
const config = (0, config_1.loadConfig)();
/**
 * Setup authentication middleware
 */
function setupAuth(app) {
    logger_1.logger.info(`Setting up authentication (${config.auth.mode} mode)...`);
    // Initialize passport
    app.use(passport_1.default.initialize());
    app.use(passport_1.default.session());
    // Serialize and deserialize user
    passport_1.default.serializeUser((user, done) => {
        done(null, user.id);
    });
    passport_1.default.deserializeUser(async (id, done) => {
        try {
            const db = (0, connection_1.getConnection)();
            const users = await db.query('SELECT * FROM users WHERE id = ?', [id]);
            if (users && users.length > 0) {
                done(null, users[0]);
            }
            else {
                done(new Error('User not found'), null);
            }
        }
        catch (error) {
            done(error, null);
        }
    });
    // Setup strategies based on configuration
    switch (config.auth.mode) {
        case 'password':
            setupPasswordAuth();
            break;
        case 'oidc':
            setupOidcAuth();
            break;
        case 'ldap':
            setupLdapAuth();
            break;
    }
}
/**
 * Setup password-based authentication
 */
function setupPasswordAuth() {
    passport_1.default.use(new passport_local_1.Strategy({ usernameField: 'username', passwordField: 'password' }, async (username, password, done) => {
        try {
            const db = (0, connection_1.getConnection)();
            const users = await db.query('SELECT * FROM users WHERE username = ?', [username]);
            if (!users || users.length === 0) {
                return done(null, false, { message: 'Incorrect username.' });
            }
            const user = users[0];
            const isValid = await bcrypt_1.default.compare(password, user.password);
            if (!isValid) {
                return done(null, false, { message: 'Incorrect password.' });
            }
            return done(null, user);
        }
        catch (error) {
            return done(error);
        }
    }));
}
/**
 * Setup OIDC authentication
 */
function setupOidcAuth() {
    if (!config.auth.oidcSettings) {
        logger_1.logger.error('OIDC configuration is missing');
        return;
    }
    passport_1.default.use(new passport_oauth2_1.Strategy({
        authorizationURL: `${config.auth.oidcSettings.issuer}/auth`,
        tokenURL: `${config.auth.oidcSettings.issuer}/token`,
        clientID: config.auth.oidcSettings.clientId,
        clientSecret: config.auth.oidcSettings.clientSecret,
        callbackURL: config.auth.oidcSettings.callbackUrl,
        scope: ['openid', 'profile', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            // Use userinfo endpoint to get user information
            const userInfoResponse = await fetch(`${config.auth.oidcSettings.issuer}/userinfo`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (!userInfoResponse.ok) {
                return done(new Error('Failed to get user info'));
            }
            const userInfo = await userInfoResponse.json();
            // Find or create user in our database
            const db = (0, connection_1.getConnection)();
            const users = await db.query('SELECT * FROM users WHERE email = ?', [userInfo.email]);
            let user;
            if (users && users.length > 0) {
                user = users[0];
            }
            else {
                // Create a new user
                const result = await db.query('INSERT INTO users (username, email, displayName, role) VALUES (?, ?, ?, ?)', [userInfo.preferred_username || userInfo.email, userInfo.email, userInfo.name, 'user']);
                user = {
                    id: result.lastID || result.insertId,
                    username: userInfo.preferred_username || userInfo.email,
                    email: userInfo.email,
                    displayName: userInfo.name,
                    role: 'user'
                };
            }
            return done(null, user);
        }
        catch (error) {
            return done(error);
        }
    }));
}
/**
 * Setup LDAP authentication
 */
function setupLdapAuth() {
    if (!config.auth.ldapSettings) {
        logger_1.logger.error('LDAP configuration is missing');
        return;
    }
    passport_1.default.use(new passport_ldapauth_1.Strategy({
        server: {
            url: config.auth.ldapSettings.url,
            bindDn: config.auth.ldapSettings.bindDn,
            bindCredentials: config.auth.ldapSettings.bindCredentials,
            searchBase: config.auth.ldapSettings.searchBase,
            searchFilter: config.auth.ldapSettings.searchFilter || '(uid={{username}})'
        }
    }, async (user, done) => {
        try {
            // Map LDAP user to our user model
            const db = (0, connection_1.getConnection)();
            const users = await db.query('SELECT * FROM users WHERE username = ?', [user.uid || user.sAMAccountName]);
            let dbUser;
            if (users && users.length > 0) {
                dbUser = users[0];
            }
            else {
                // Create a new user
                const result = await db.query('INSERT INTO users (username, email, displayName, role) VALUES (?, ?, ?, ?)', [
                    user.uid || user.sAMAccountName,
                    user.mail || user.email,
                    user.displayName || user.cn,
                    'user'
                ]);
                dbUser = {
                    id: result.lastID || result.insertId,
                    username: user.uid || user.sAMAccountName,
                    email: user.mail || user.email,
                    displayName: user.displayName || user.cn,
                    role: 'user'
                };
            }
            return done(null, dbUser);
        }
        catch (error) {
            return done(error);
        }
    }));
}
/**
 * Middleware to check if user is authenticated
 */
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}
/**
 * Middleware to check if user is an admin
 */
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user && req.user.role === 'admin') {
        return next();
    }
    res.status(403).json({ error: 'Forbidden' });
}
