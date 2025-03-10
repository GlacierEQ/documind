"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
function loadConfig() {
    const cpuCount = os_1.default.cpus().length;
    const totalMemory = Math.floor(os_1.default.totalmem() / (1024 * 1024)); // Convert to MB
    // Default configuration with auto-optimization based on system resources
    const config = {
        database: {
            driver: process.env.DOCUMIND_DATABASE_DRIVER || 'sqlite',
            server: process.env.DOCUMIND_DATABASE_SERVER || 'localhost:3306',
            user: process.env.DOCUMIND_DATABASE_USER || 'documind',
            password: process.env.DOCUMIND_DATABASE_PASSWORD || '',
            database: process.env.DOCUMIND_DATABASE_NAME || 'documind',
            connectionLimit: Math.max(5, Math.min(20, Math.floor(cpuCount / 2)))
        },
        auth: {
            mode: process.env.DOCUMIND_AUTH_MODE || 'password'
        },
        storage: {
            path: process.env.DOCUMIND_STORAGE_PATH || path_1.default.join(process.cwd(), 'storage'),
            maxSize: parseInt(process.env.DOCUMIND_STORAGE_MAX_SIZE || '10240') // Default 10GB
        },
        server: {
            port: parseInt(process.env.DOCUMIND_PORT || '8080'),
            disableTls: process.env.DOCUMIND_DISABLE_TLS === 'true'
        },
        indexing: {
            threads: parseInt(process.env.DOCUMIND_INDEXING_THREADS || String(Math.max(1, cpuCount - 1))),
            enableOcr: process.env.DOCUMIND_ENABLE_OCR !== 'false',
            enableNlp: process.env.DOCUMIND_ENABLE_NLP !== 'false',
            cacheSize: parseInt(process.env.DOCUMIND_CACHE_SIZE || String(Math.floor(totalMemory * 0.2)))
        },
        document: {
            allowedTypes: process.env.DOCUMIND_ALLOWED_TYPES?.split(',') ||
                ['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'],
            maxFileSize: parseInt(process.env.DOCUMIND_MAX_FILE_SIZE || '100') // Default 100MB
        },
        // Add WebDAV configuration
        webdav: {
            enabled: process.env.DOCUMIND_WEBDAV_ENABLED === 'true',
            port: parseInt(process.env.DOCUMIND_WEBDAV_PORT || '1900'),
            username: process.env.DOCUMIND_WEBDAV_USERNAME,
            password: process.env.DOCUMIND_WEBDAV_PASSWORD,
            externalUrl: process.env.DOCUMIND_WEBDAV_EXTERNAL_URL
        },
        // Add editors configuration
        editors: {
            enableExternalEditors: process.env.DOCUMIND_ENABLE_EXTERNAL_EDITORS !== 'false',
            customEditors: [],
            disabledEditors: (process.env.DOCUMIND_DISABLED_EDITORS || '').split(',').filter(Boolean)
        },
        // Add AI configuration
        ai: {
            provider: process.env.DOCUMIND_AI_PROVIDER || 'none',
            apiKey: process.env.DOCUMIND_AI_API_KEY,
            model: process.env.DOCUMIND_AI_MODEL || 'gpt-3.5-turbo',
            maxTokens: parseInt(process.env.DOCUMIND_AI_MAX_TOKENS || '1024'),
            temperature: parseFloat(process.env.DOCUMIND_AI_TEMPERATURE || '0.3'),
            endpoint: process.env.DOCUMIND_AI_ENDPOINT,
            summarizationEnabled: process.env.DOCUMIND_AI_SUMMARIZATION_ENABLED !== 'false',
            analysisEnabled: process.env.DOCUMIND_AI_ANALYSIS_ENABLED !== 'false',
            taggingEnabled: process.env.DOCUMIND_AI_TAGGING_ENABLED !== 'false',
            cacheResults: process.env.DOCUMIND_AI_CACHE_RESULTS !== 'false',
            cacheTTL: parseInt(process.env.DOCUMIND_AI_CACHE_TTL || '86400'), // Default: 24 hours
            enableTranslation: process.env.DOCUMIND_ENABLE_TRANSLATION === 'true',
            languageDetection: process.env.DOCUMIND_LANGUAGE_DETECTION === 'true',
            voiceToText: process.env.DOCUMIND_VOICE_TO_TEXT === 'true',
            entityExtraction: process.env.DOCUMIND_ENTITY_EXTRACTION === 'true',
            localModelConfig: {
                modelType: process.env.DOCUMIND_AI_LOCAL_MODEL_TYPE || 'deepseek',
                modelPath: process.env.DOCUMIND_AI_LOCAL_MODEL_PATH,
                pythonPath: process.env.DOCUMIND_AI_PYTHON_PATH || 'python'
            },
            granite: {
                apiKey: process.env.DOCUMIND_GRANITE_API_KEY || '',
                endpoint: process.env.DOCUMIND_GRANITE_ENDPOINT,
                model: process.env.DOCUMIND_GRANITE_MODEL,
                temperature: parseFloat(process.env.DOCUMIND_GRANITE_TEMPERATURE || '0.3'),
                topP: parseFloat(process.env.DOCUMIND_GRANITE_TOP_P || '1.0'),
                embeddingEndpoint: process.env.DOCUMIND_GRANITE_EMBEDDING_ENDPOINT,
                embeddingModel: process.env.DOCUMIND_GRANITE_EMBEDDING_MODEL
            }
        },
        // Add security configuration
        security: {
            forcePasswordComplexity: process.env.DOCUMIND_FORCE_PASSWORD_COMPLEXITY === 'true',
            sessionTimeout: parseInt(process.env.DOCUMIND_SESSION_TIMEOUT || '3600'),
            maxFailedLogins: parseInt(process.env.DOCUMIND_MAX_FAILED_LOGINS || '5'),
            ipWhitelist: (process.env.DOCUMIND_IP_WHITELIST || '').split(',').filter(Boolean),
            enable2FA: process.env.DOCUMIND_ENABLE_2FA === 'true'
        },
        // Add backup configuration
        backup: {
            enabled: process.env.DOCUMIND_BACKUP_ENABLED === 'true',
            cronSchedule: process.env.DOCUMIND_BACKUP_CRON || '0 3 * * *',
            retentionDays: parseInt(process.env.DOCUMIND_BACKUP_RETENTION_DAYS || '30'),
            location: process.env.DOCUMIND_BACKUP_LOCATION || '/var/backups/documind',
            encryption: process.env.DOCUMIND_BACKUP_ENCRYPTION === 'true'
        },
        // Add scaling configuration
        scaling: {
            autoScaling: process.env.DOCUMIND_AUTO_SCALING === 'true',
            maxIndexingThreads: parseInt(process.env.DOCUMIND_MAX_INDEXING_THREADS || String(Math.max(1, cpuCount))),
            ramLimit: parseInt(process.env.DOCUMIND_RAM_LIMIT || '4096'),
            lazyLoading: process.env.DOCUMIND_LAZY_LOADING === 'true',
            asyncIndexing: process.env.DOCUMIND_ASYNC_INDEXING === 'true'
        },
        // Add RBAC configuration
        rbac: {
            enabled: process.env.DOCUMIND_ENABLE_RBAC === 'true',
            defaultRole: process.env.DOCUMIND_DEFAULT_ROLE || 'user',
            roleDefinitions: {
                admin: process.env.DOCUMIND_ROLE_ADMIN || 'full_access',
                editor: process.env.DOCUMIND_ROLE_EDITOR || 'edit_documents',
                viewer: process.env.DOCUMIND_ROLE_VIEWER || 'read_only'
            }
        },
        // Add webhook configuration
        webhook: {
            enabled: process.env.DOCUMIND_WEBHOOK_ENABLED === 'true',
            url: process.env.DOCUMIND_WEBHOOK_URL || '',
            events: (process.env.DOCUMIND_WEBHOOK_EVENTS || '').split(',').filter(Boolean),
            apiKey: process.env.DOCUMIND_API_KEY || ''
        },
        // Add UI configuration
        ui: {
            theme: process.env.DOCUMIND_THEME || 'light',
            brandLogo: process.env.DOCUMIND_BRAND_LOGO,
            customCSS: process.env.DOCUMIND_CUSTOM_CSS
        },
        // Add archiving configuration
        archiving: {
            autoArchive: process.env.DOCUMIND_AUTO_ARCHIVE === 'true',
            retentionDays: parseInt(process.env.DOCUMIND_ARCHIVE_RETENTION_DAYS || '365'),
            archivePath: process.env.DOCUMIND_ARCHIVE_PATH || '/var/documind/archive',
            purgeOldDocuments: process.env.DOCUMIND_PURGE_OLD_DOCUMENTS === 'true'
        }
    };
    // Add server external URL
    if (process.env.DOCUMIND_SERVER_EXTERNAL_URL) {
        config.server.externalUrl = process.env.DOCUMIND_SERVER_EXTERNAL_URL;
    }
    return config;
}
