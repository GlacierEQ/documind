import express from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { Strategy as LdapStrategy } from 'passport-ldapauth';
import { AuthConfig } from '../config/config';
import { getConnection } from '../database/connection';
import { logger } from '../utils/logger';
import bcrypt from 'bcrypt';

// Load configuration
import { loadConfig } from '../config/config';
const config = loadConfig();

// User model interface
export interface User {
    id: number;
    username: string;
    displayName: string;
    email: string;
    role: 'admin' | 'user';
}

/**
 * Setup authentication middleware
 */
export function setupAuth(app: express.Application): void {
    logger.info(`Setting up authentication (${config.auth.mode} mode)...`);

    // Initialize passport
    app.use(passport.initialize());
    app.use(passport.session());

    // Serialize and deserialize user
    passport.serializeUser((user: any, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id: number, done) => {
        try {
            const db = getConnection();
            const users = await db.query('SELECT * FROM users WHERE id = ?', [id]);
            if (users && users.length > 0) {
                done(null, users[0]);
            } else {
                done(new Error('User not found'), null);
            }
        } catch (error) {
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
function setupPasswordAuth(): void {
    passport.use(new LocalStrategy(
        { usernameField: 'username', passwordField: 'password' },
        async (username, password, done) => {
            try {
                const db = getConnection();
                const users = await db.query('SELECT * FROM users WHERE username = ?', [username]);

                if (!users || users.length === 0) {
                    return done(null, false, { message: 'Incorrect username.' });
                }

                const user = users[0];
                const isValid = await bcrypt.compare(password, user.password);

                if (!isValid) {
                    return done(null, false, { message: 'Incorrect password.' });
                }

                return done(null, user);
            } catch (error) {
                return done(error);
            }
        }
    ));
}

/**
 * Setup OIDC authentication
 */
function setupOidcAuth(): void {
    if (!config.auth.oidcSettings) {
        logger.error('OIDC configuration is missing');
        return;
    }

    passport.use(new OAuth2Strategy({
        authorizationURL: `${config.auth.oidcSettings.issuer}/auth`,
        tokenURL: `${config.auth.oidcSettings.issuer}/token`,
        clientID: config.auth.oidcSettings.clientId,
        clientSecret: config.auth.oidcSettings.clientSecret,
        callbackURL: config.auth.oidcSettings.callbackUrl,
        scope: ['openid', 'profile', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            // Use userinfo endpoint to get user information
            const userInfoResponse = await fetch(`${config.auth.oidcSettings!.issuer}/userinfo`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!userInfoResponse.ok) {
                return done(new Error('Failed to get user info'));
            }

            const userInfo = await userInfoResponse.json();

            // Find or create user in our database
            const db = getConnection();
            const users = await db.query(
                'SELECT * FROM users WHERE email = ?',
                [userInfo.email]
            );

            let user;
            if (users && users.length > 0) {
                user = users[0];
            } else {
                // Create a new user
                const result = await db.query(
                    'INSERT INTO users (username, email, displayName, role) VALUES (?, ?, ?, ?)',
                    [userInfo.preferred_username || userInfo.email, userInfo.email, userInfo.name, 'user']
                );

                user = {
                    id: result.lastID || result.insertId,
                    username: userInfo.preferred_username || userInfo.email,
                    email: userInfo.email,
                    displayName: userInfo.name,
                    role: 'user'
                };
            }

            return done(null, user);
        } catch (error) {
            return done(error);
        }
    }));
}

/**
 * Setup LDAP authentication
 */
function setupLdapAuth(): void {
    if (!config.auth.ldapSettings) {
        logger.error('LDAP configuration is missing');
        return;
    }

    passport.use(new LdapStrategy({
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
            const db = getConnection();
            const users = await db.query(
                'SELECT * FROM users WHERE username = ?',
                [user.uid || user.sAMAccountName]
            );

            let dbUser;
            if (users && users.length > 0) {
                dbUser = users[0];
            } else {
                // Create a new user
                const result = await db.query(
                    'INSERT INTO users (username, email, displayName, role) VALUES (?, ?, ?, ?)',
                    [
                        user.uid || user.sAMAccountName,
                        user.mail || user.email,
                        user.displayName || user.cn,
                        'user'
                    ]
                );

                dbUser = {
                    id: result.lastID || result.insertId,
                    username: user.uid || user.sAMAccountName,
                    email: user.mail || user.email,
                    displayName: user.displayName || user.cn,
                    role: 'user'
                };
            }

            return done(null, dbUser);
        } catch (error) {
            return done(error);
        }
    }));
}

/**
 * Middleware to check if user is authenticated
 */
export function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Middleware to check if user is an admin
 */
export function isAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (req.isAuthenticated() && req.user && (req.user as User).role === 'admin') {
        return next();
    }
    res.status(403).json({ error: 'Forbidden' });
}
