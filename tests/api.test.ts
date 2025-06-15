import request from 'supertest';
import express from 'express';
import { apiRouter } from '../src/api/router';
import { setupAuth } from '../src/auth/auth';
import { initializeDatabase } from '../src/database/connection';
import { initializeSchema } from '../src/database/schema';
import bcrypt from 'bcrypt';

// Mock dependencies
jest.mock('../src/database/connection');
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    },
    performance: {
        start: () => jest.fn(() => 0)
    }
}));
jest.mock('../src/auth/auth', () => ({
    setupAuth: jest.fn(),
    isAuthenticated: jest.fn((req, res, next) => {
        req.user = { id: 1, username: 'admin', role: 'admin' };
        req.isAuthenticated = () => true;
        next();
    }),
    isAdmin: jest.fn((req, res, next) => {
        req.user = { id: 1, username: 'admin', role: 'admin' };
        next();
    })
}));

// Mock file storage
jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn(() => Promise.resolve([])),
        stat: jest.fn(() => Promise.resolve({ size: 1024, isDirectory: () => false })),
        writeFile: jest.fn(() => Promise.resolve()),
        unlink: jest.fn(() => Promise.resolve())
    },
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn()
}));

// Setup app for testing
let app: express.Application;
beforeAll(() => {
    // Initialize express app
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    // Mock database connection
    const mockDb = {
        query: jest.fn((sql: string, params?: any[]) => {
            // Mock responses for different queries
            if (sql.includes('COUNT(*) as count FROM documents')) {
                return Promise.resolve([{ count: 10 }]);
            } else if (sql.includes('SELECT * FROM documents')) {
                return Promise.resolve([
                    {
                        id: 1,
                        name: 'test-document.pdf',
                        description: 'Test document',
                        path: '/var/documind/storage/uploads/test.pdf',
                        size: 1024,
                        mime_type: 'application/pdf',
                        uploaded_by: 1,
                        uploaded_at: new Date(),
                        tags: '["test", "document"]'
                    }
                ]);
            } else if (sql.includes('SELECT * FROM users')) {
                return Promise.resolve([
                    {
                        id: 1,
                        username: 'admin',
                        displayName: 'Administrator',
                        email: 'admin@example.com',
                        role: 'admin'
                    }
                ]);
            } else if (sql.includes('INSERT INTO')) {
                return Promise.resolve({ lastID: 1, insertId: 1 });
            } else {
                return Promise.resolve([]);
            }
        }),
        close: jest.fn(() => Promise.resolve())
    };

    (initializeDatabase as jest.Mock).mockResolvedValue(mockDb);

    // Mock bcrypt
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));
});

describe('API Routes', () => {
    describe('Authentication Endpoints', () => {
        test('GET /auth/status returns authentication status', async () => {
            const response = await request(app).get('/api/auth/status');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('isAuthenticated');
        });
    });

    describe('Document Endpoints', () => {
        test('GET /documents returns list of documents', async () => {
            const response = await request(app).get('/api/documents');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('documents');
            expect(response.body).toHaveProperty('pagination');
        });

        test('GET /documents/:id returns a single document', async () => {
            const response = await request(app).get('/api/documents/1');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('id', 1);
            expect(response.body).toHaveProperty('name');
        });

        test('GET /documents/999 returns 404 for non-existent document', async () => {
            // Mock the query to return no results
            const mockDb = await initializeDatabase({} as any);
            (mockDb.query as jest.Mock).mockImplementationOnce(() => Promise.resolve([]));

            const response = await request(app).get('/api/documents/999');

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
        });
    });

    describe('Search Endpoints', () => {
        test('GET /search without query param returns error', async () => {
            const response = await request(app).get('/api/search');

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });

        test('GET /search with query param returns results', async () => {
            const response = await request(app).get('/api/search?q=test');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('results');
        });
    });

    describe('Admin Endpoints', () => {
        test('GET /admin/stats returns system statistics', async () => {
            const response = await request(app).get('/api/admin/stats');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('documents');
            expect(response.body).toHaveProperty('users');
        });
    });
});
