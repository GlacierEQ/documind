import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { isAdmin } from '../auth/auth';
import { logger } from '../utils/logger';
import { loadConfig } from '../config/config';

export const settingsRouter = express.Router();

// Only admin users can access these endpoints
settingsRouter.use(isAdmin);

// Get all application settings
settingsRouter.get('/', async (req, res) => {
    try {
        // Load current configuration
        const config = loadConfig();

        // Filter out sensitive information like API keys and passwords
        const safeConfig = {
            database: {
                driver: config.database.driver,
                connectionLimit: config.database.connectionLimit
            },
            auth: {
                mode: config.auth.mode
            },
            storage: config.storage,
            server: {
                port: config.server.port,
                disableTls: config.server.disableTls,
                externalUrl: config.server.externalUrl
            },
            indexing: config.indexing,
            document: config.document,
            webdav: config.webdav ? {
                enabled: config.webdav.enabled,
                port: config.webdav.port,
                externalUrl: config.webdav.externalUrl
            } : undefined,
            editors: config.editors ? {
                enableExternalEditors: config.editors.enableExternalEditors,
                disabledEditors: config.editors.disabledEditors
            } : undefined,
            ai: {
                provider: config.ai.provider,
                model: config.ai.model,
                maxTokens: config.ai.maxTokens,
                temperature: config.ai.temperature,
                summarizationEnabled: config.ai.summarizationEnabled,
                analysisEnabled: config.ai.analysisEnabled,
                taggingEnabled: config.ai.taggingEnabled,
                cacheResults: config.ai.cacheResults,
                cacheTTL: config.ai.cacheTTL,
                enableTranslation: config.ai.enableTranslation,
                languageDetection: config.ai.languageDetection,
                voiceToText: config.ai.voiceToText,
                entityExtraction: config.ai.entityExtraction
            },
            security: config.security,
            backup: config.backup,
            scaling: config.scaling,
            rbac: config.rbac,
            webhook: {
                enabled: config.webhook.enabled,
                events: config.webhook.events
            },
            ui: config.ui,
            archiving: config.archiving
        };

        res.json(safeConfig);
    } catch (error) {
        logger.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Update application settings
settingsRouter.put('/', async (req, res) => {
    try {
        const newSettings = req.body;
        const envFilePath = path.join(process.cwd(), '.env');

        // Read current .env file
        let envContent;
        try {
            envContent = await fs.readFile(envFilePath, 'utf8');
        } catch (err) {
            logger.warn(`No .env file found at ${envFilePath}, creating new one`);
            envContent = '';
        }

        // Parse current .env file
        const currentEnv = dotenv.parse(envContent);

        // Update with new settings
        const updatedEnv = {
            ...currentEnv,
            // Only update allowed settings (not database credentials, etc.)
            DOCUMIND_PORT: newSettings.server?.port?.toString() || currentEnv.DOCUMIND_PORT,
            DOCUMIND_DISABLE_TLS: newSettings.server?.disableTls?.toString() || currentEnv.DOCUMIND_DISABLE_TLS,
            DOCUMIND_SERVER_EXTERNAL_URL: newSettings.server?.externalUrl || currentEnv.DOCUMIND_SERVER_EXTERNAL_URL,

            // Storage settings
            DOCUMIND_STORAGE_MAX_SIZE: newSettings.storage?.maxSize?.toString() || currentEnv.DOCUMIND_STORAGE_MAX_SIZE,

            // Indexing settings
            DOCUMIND_INDEXING_THREADS: newSettings.indexing?.threads?.toString() || currentEnv.DOCUMIND_INDEXING_THREADS,
            DOCUMIND_ENABLE_OCR: newSettings.indexing?.enableOcr?.toString() || currentEnv.DOCUMIND_ENABLE_OCR,
            DOCUMIND_ENABLE_NLP: newSettings.indexing?.enableNlp?.toString() || currentEnv.DOCUMIND_ENABLE_NLP,
            DOCUMIND_CACHE_SIZE: newSettings.indexing?.cacheSize?.toString() || currentEnv.DOCUMIND_CACHE_SIZE,

            // Document settings
            DOCUMIND_ALLOWED_TYPES: newSettings.document?.allowedTypes?.join(',') || currentEnv.DOCUMIND_ALLOWED_TYPES,
            DOCUMIND_MAX_FILE_SIZE: newSettings.document?.maxFileSize?.toString() || currentEnv.DOCUMIND_MAX_FILE_SIZE,

            // WebDAV settings
            DOCUMIND_WEBDAV_ENABLED: newSettings.webdav?.enabled?.toString() || currentEnv.DOCUMIND_WEBDAV_ENABLED,
            DOCUMIND_WEBDAV_PORT: newSettings.webdav?.port?.toString() || currentEnv.DOCUMIND_WEBDAV_PORT,
            DOCUMIND_WEBDAV_EXTERNAL_URL: newSettings.webdav?.externalUrl || currentEnv.DOCUMIND_WEBDAV_EXTERNAL_URL,

            // Editors settings
            DOCUMIND_ENABLE_EXTERNAL_EDITORS: newSettings.editors?.enableExternalEditors?.toString() || currentEnv.DOCUMIND_ENABLE_EXTERNAL_EDITORS,
            DOCUMIND_DISABLED_EDITORS: newSettings.editors?.disabledEditors?.join(',') || currentEnv.DOCUMIND_DISABLED_EDITORS,

            // AI settings
            DOCUMIND_AI_PROVIDER: newSettings.ai?.provider || currentEnv.DOCUMIND_AI_PROVIDER,
            DOCUMIND_AI_MODEL: newSettings.ai?.model || currentEnv.DOCUMIND_AI_MODEL,
            DOCUMIND_AI_MAX_TOKENS: newSettings.ai?.maxTokens?.toString() || currentEnv.DOCUMIND_AI_MAX_TOKENS,
            DOCUMIND_AI_TEMPERATURE: newSettings.ai?.temperature?.toString() || currentEnv.DOCUMIND_AI_TEMPERATURE,
            DOCUMIND_AI_SUMMARIZATION_ENABLED: newSettings.ai?.summarizationEnabled?.toString() || currentEnv.DOCUMIND_AI_SUMMARIZATION_ENABLED,
            DOCUMIND_AI_ANALYSIS_ENABLED: newSettings.ai?.analysisEnabled?.toString() || currentEnv.DOCUMIND_AI_ANALYSIS_ENABLED,
            DOCUMIND_AI_TAGGING_ENABLED: newSettings.ai?.taggingEnabled?.toString() || currentEnv.DOCUMIND_AI_TAGGING_ENABLED,
            DOCUMIND_AI_CACHE_RESULTS: newSettings.ai?.cacheResults?.toString() || currentEnv.DOCUMIND_AI_CACHE_RESULTS,
            DOCUMIND_AI_CACHE_TTL: newSettings.ai?.cacheTTL?.toString() || currentEnv.DOCUMIND_AI_CACHE_TTL,
            DOCUMIND_ENABLE_TRANSLATION: newSettings.ai?.enableTranslation?.toString() || currentEnv.DOCUMIND_ENABLE_TRANSLATION,
            DOCUMIND_LANGUAGE_DETECTION: newSettings.ai?.languageDetection?.toString() || currentEnv.DOCUMIND_LANGUAGE_DETECTION,
            DOCUMIND_VOICE_TO_TEXT: newSettings.ai?.voiceToText?.toString() || currentEnv.DOCUMIND_VOICE_TO_TEXT,
            DOCUMIND_ENTITY_EXTRACTION: newSettings.ai?.entityExtraction?.toString() || currentEnv.DOCUMIND_ENTITY_EXTRACTION,

            // Security settings
            DOCUMIND_FORCE_PASSWORD_COMPLEXITY: newSettings.security?.forcePasswordComplexity?.toString() || currentEnv.DOCUMIND_FORCE_PASSWORD_COMPLEXITY,
            DOCUMIND_SESSION_TIMEOUT: newSettings.security?.sessionTimeout?.toString() || currentEnv.DOCUMIND_SESSION_TIMEOUT,
            DOCUMIND_MAX_FAILED_LOGINS: newSettings.security?.maxFailedLogins?.toString() || currentEnv.DOCUMIND_MAX_FAILED_LOGINS,
            DOCUMIND_IP_WHITELIST: newSettings.security?.ipWhitelist?.join(',') || currentEnv.DOCUMIND_IP_WHITELIST,
            DOCUMIND_ENABLE_2FA: newSettings.security?.enable2FA?.toString() || currentEnv.DOCUMIND_ENABLE_2FA,

            // Backup settings
            DOCUMIND_BACKUP_ENABLED: newSettings.backup?.enabled?.toString() || currentEnv.DOCUMIND_BACKUP_ENABLED,
            DOCUMIND_BACKUP_CRON: newSettings.backup?.cronSchedule || currentEnv.DOCUMIND_BACKUP_CRON,
            DOCUMIND_BACKUP_RETENTION_DAYS: newSettings.backup?.retentionDays?.toString() || currentEnv.DOCUMIND_BACKUP_RETENTION_DAYS,
            DOCUMIND_BACKUP_LOCATION: newSettings.backup?.location || currentEnv.DOCUMIND_BACKUP_LOCATION,
            DOCUMIND_BACKUP_ENCRYPTION: newSettings.backup?.encryption?.toString() || currentEnv.DOCUMIND_BACKUP_ENCRYPTION,

            // Scaling settings
            DOCUMIND_AUTO_SCALING: newSettings.scaling?.autoScaling?.toString() || currentEnv.DOCUMIND_AUTO_SCALING,
            DOCUMIND_MAX_INDEXING_THREADS: newSettings.scaling?.maxIndexingThreads?.toString() || currentEnv.DOCUMIND_MAX_INDEXING_THREADS,
            DOCUMIND_RAM_LIMIT: newSettings.scaling?.ramLimit?.toString() || currentEnv.DOCUMIND_RAM_LIMIT,
            DOCUMIND_LAZY_LOADING: newSettings.scaling?.lazyLoading?.toString() || currentEnv.DOCUMIND_LAZY_LOADING,
            DOCUMIND_ASYNC_INDEXING: newSettings.scaling?.asyncIndexing?.toString() || currentEnv.DOCUMIND_ASYNC_INDEXING,

            // RBAC settings
            DOCUMIND_ENABLE_RBAC: newSettings.rbac?.enabled?.toString() || currentEnv.DOCUMIND_ENABLE_RBAC,
            DOCUMIND_DEFAULT_ROLE: newSettings.rbac?.defaultRole || currentEnv.DOCUMIND_DEFAULT_ROLE,
            DOCUMIND_ROLE_ADMIN: newSettings.rbac?.roleDefinitions?.admin || currentEnv.DOCUMIND_ROLE_ADMIN,
            DOCUMIND_ROLE_EDITOR: newSettings.rbac?.roleDefinitions?.editor || currentEnv.DOCUMIND_ROLE_EDITOR,
            DOCUMIND_ROLE_VIEWER: newSettings.rbac?.roleDefinitions?.viewer || currentEnv.DOCUMIND_ROLE_VIEWER,

            // Webhook settings
            DOCUMIND_WEBHOOK_ENABLED: newSettings.webhook?.enabled?.toString() || currentEnv.DOCUMIND_WEBHOOK_ENABLED,
            DOCUMIND_WEBHOOK_URL: newSettings.webhook?.url || currentEnv.DOCUMIND_WEBHOOK_URL,
            DOCUMIND_WEBHOOK_EVENTS: newSettings.webhook?.events?.join(',') || currentEnv.DOCUMIND_WEBHOOK_EVENTS,

            // UI settings
            DOCUMIND_THEME: newSettings.ui?.theme || currentEnv.DOCUMIND_THEME,
            DOCUMIND_BRAND_LOGO: newSettings.ui?.brandLogo || currentEnv.DOCUMIND_BRAND_LOGO,
            DOCUMIND_CUSTOM_CSS: newSettings.ui?.customCSS || currentEnv.DOCUMIND_CUSTOM_CSS,

            // Archiving settings
            DOCUMIND_AUTO_ARCHIVE: newSettings.archiving?.autoArchive?.toString() || currentEnv.DOCUMIND_AUTO_ARCHIVE,
            DOCUMIND_ARCHIVE_RETENTION_DAYS: newSettings.archiving?.retentionDays?.toString() || currentEnv.DOCUMIND_ARCHIVE_RETENTION_DAYS,
            DOCUMIND_ARCHIVE_PATH: newSettings.archiving?.archivePath || currentEnv.DOCUMIND_ARCHIVE_PATH,
            DOCUMIND_PURGE_OLD_DOCUMENTS: newSettings.archiving?.purgeOldDocuments?.toString() || currentEnv.DOCUMIND_PURGE_OLD_DOCUMENTS
        };

        // Convert to .env format
        const envFileContent = Object.entries(updatedEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Write back to .env file
        await fs.writeFile(envFilePath, envFileContent);

        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
        logger.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Handle AI provider settings update
settingsRouter.post('/ai', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { 
            provider, maxTokens, temperature,
            openaiApiKey, openaiModel, openaiEmbeddingModel,
            azureApiKey, azureEndpoint, azureDeploymentName,
            anthropicApiKey, anthropicModel,
            cohereApiKey, cohereModel,
            localModelPath, localModelConfig,
            // Add Granite settings
            graniteApiKey, graniteModel, graniteEmbeddingModel
        } = req.body;
        
        // Basic validation
        if (!provider) {
            return res.status(400).json({ error: 'AI provider is required' });
        }
        
        // Get current config
        const config = loadConfig();
        
        // Update AI configuration
        config.ai = {
            ...config.ai,
            provider,
            maxTokens: parseInt(maxTokens) || 2000,
            temperature: parseFloat(temperature) || 0.2,
        };
        
        // Provider-specific settings
        if (provider === 'openai' && openaiApiKey) {
            // ...existing code...
        } 
        // ...other providers...
        
        // Add Granite configuration
        else if (provider === 'granite' && graniteApiKey) {
            config.ai.granite = {
                apiKey: graniteApiKey,
                model: graniteModel || 'granite-34b-instruct',
                embeddingModel: graniteEmbeddingModel || 'granite-embedding'
            };
        }
        
        // Save updated config
        await saveConfig(config);
        
        // Return sanitized config (without API keys)
        const sanitizedConfig = { ...config };
        
        // ...existing code...
        
        // Sanitize Granite API key
        if (sanitizedConfig.ai?.granite?.apiKey) {
            sanitizedConfig.ai.granite.apiKey = '********';
        }
        
        res.json({
            success: true,
            config: sanitizedConfig.ai
        });
    } catch (error) {
        // ...existing code...
    }
});
