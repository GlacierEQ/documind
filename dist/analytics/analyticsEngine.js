"use strict";
/**
 * Enterprise Analytics Engine
 * Processes usage metrics, document trends, and user behaviors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsTimePeriod = exports.AnalyticsMetricType = void 0;
exports.getSystemAnalytics = getSystemAnalytics;
exports.getDocumentAnalytics = getDocumentAnalytics;
exports.getUserAnalytics = getUserAnalytics;
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
/**
 * Analytics metric types
 */
var AnalyticsMetricType;
(function (AnalyticsMetricType) {
    AnalyticsMetricType["DOCUMENT_COUNT"] = "document_count";
    AnalyticsMetricType["STORAGE_USAGE"] = "storage_usage";
    AnalyticsMetricType["USER_ACTIVITY"] = "user_activity";
    AnalyticsMetricType["SEARCH_VOLUME"] = "search_volume";
    AnalyticsMetricType["API_REQUESTS"] = "api_requests";
    AnalyticsMetricType["PROCESSING_TIME"] = "processing_time";
    AnalyticsMetricType["AI_USAGE"] = "ai_usage";
    AnalyticsMetricType["ERROR_RATE"] = "error_rate";
    AnalyticsMetricType["FEATURES_USAGE"] = "features_usage";
})(AnalyticsMetricType || (exports.AnalyticsMetricType = AnalyticsMetricType = {}));
/**
 * Time period for analytics
 */
var AnalyticsTimePeriod;
(function (AnalyticsTimePeriod) {
    AnalyticsTimePeriod["DAY"] = "day";
    AnalyticsTimePeriod["WEEK"] = "week";
    AnalyticsTimePeriod["MONTH"] = "month";
    AnalyticsTimePeriod["QUARTER"] = "quarter";
    AnalyticsTimePeriod["YEAR"] = "year";
    AnalyticsTimePeriod["CUSTOM"] = "custom";
})(AnalyticsTimePeriod || (exports.AnalyticsTimePeriod = AnalyticsTimePeriod = {}));
/**
 * Get system analytics overview
 */
async function getSystemAnalytics(options = {}) {
    const perfEnd = logger_1.performance.start('analytics-system-report');
    const db = (0, connection_1.getConnection)();
    try {
        // Extract date range from options
        const { startDate, endDate } = getDateRangeFromOptions(options);
        // Execute queries for different metric types in parallel
        const promises = [];
        const metricTypes = options.metricTypes || Object.values(AnalyticsMetricType);
        // Document metrics
        if (metricTypes.includes(AnalyticsMetricType.DOCUMENT_COUNT)) {
            promises.push(getDocumentMetrics(db, startDate, endDate, options));
        }
        // Storage usage metrics
        if (metricTypes.includes(AnalyticsMetricType.STORAGE_USAGE)) {
            promises.push(getStorageMetrics(db, startDate, endDate, options));
        }
        // User activity metrics
        if (metricTypes.includes(AnalyticsMetricType.USER_ACTIVITY)) {
            promises.push(getUserActivityMetrics(db, startDate, endDate, options));
        }
        // Search volume metrics
        if (metricTypes.includes(AnalyticsMetricType.SEARCH_VOLUME)) {
            promises.push(getSearchMetrics(db, startDate, endDate, options));
        }
        // API usage metrics
        if (metricTypes.includes(AnalyticsMetricType.API_REQUESTS)) {
            promises.push(getApiMetrics(db, startDate, endDate, options));
        }
        // AI usage metrics
        if (metricTypes.includes(AnalyticsMetricType.AI_USAGE)) {
            promises.push(getAiUsageMetrics(db, startDate, endDate, options));
        }
        // Wait for all metric queries to complete
        const results = await Promise.all(promises);
        // Combine results into a single report
        const report = {
            timeRange: {
                start: startDate,
                end: endDate,
                period: options.timePeriod
            },
            metrics: {}
        };
        // Add each result to the report
        results.forEach(result => {
            report.metrics = { ...report.metrics, ...result };
        });
        // If compareWithPrevious is true, add previous period comparison
        if (options.compareWithPrevious) {
            // Calculate previous period date range
            const prevPeriodLength = endDate.getTime() - startDate.getTime();
            const prevEndDate = new Date(startDate.getTime());
            const prevStartDate = new Date(prevEndDate.getTime() - prevPeriodLength);
            // Get previous period data
            const prevOptions = { ...options, startDate: prevStartDate, endDate: prevEndDate };
            const prevReport = await getSystemAnalytics(prevOptions);
            // Add comparison calculations
            report.comparison = calculateComparison(report.metrics, prevReport.metrics);
        }
        logger_1.logger.info(`Generated system analytics report in ${perfEnd()}ms`);
        return report;
    }
    catch (error) {
        logger_1.logger.error('Error generating system analytics:', error);
        throw error;
    }
}
/**
 * Get document analytics
 */
async function getDocumentAnalytics(documentId) {
    const perfEnd = logger_1.performance.start('analytics-document-report');
    const db = (0, connection_1.getConnection)();
    try {
        // Get basic document information
        const [document] = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
        if (!document) {
            return null;
        }
        // Get view metrics
        const viewsQuery = `
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT user_id) as unique_viewers,
        MAX(timestamp) as last_viewed
      FROM document_activity_log
      WHERE document_id = ? AND action = 'view'
    `;
        const [viewMetrics] = await db.query(viewsQuery, [documentId]);
        // Get download metrics
        const downloadsQuery = `
      SELECT COUNT(*) as total_downloads
      FROM document_activity_log
      WHERE document_id = ? AND action = 'download'
    `;
        const [downloadMetrics] = await db.query(downloadsQuery, [documentId]);
        // Get sharing metrics
        const sharingQuery = `
      SELECT COUNT(*) as share_count
      FROM document_shares
      WHERE document_id = ?
    `;
        const [sharingMetrics] = await db.query(sharingQuery, [documentId]);
        // Get comments count
        const commentsQuery = `
      SELECT COUNT(*) as comment_count
      FROM document_comments
      WHERE document_id = ?
    `;
        const [commentsMetrics] = await db.query(commentsQuery, [documentId]);
        // Get viewers list
        const viewersQuery = `
      SELECT 
        u.id, u.username, u.email,
        COUNT(dal.id) as view_count,
        MAX(dal.timestamp) as last_viewed
      FROM document_activity_log dal
      JOIN users u ON dal.user_id = u.id
      WHERE dal.document_id = ? AND dal.action = 'view'
      GROUP BY u.id
      ORDER BY view_count DESC
      LIMIT 10
    `;
        const viewers = await db.query(viewersQuery, [documentId]);
        // Compile the report
        const report = {
            documentInfo: {
                id: document.id,
                name: document.name,
                uploadedAt: document.uploaded_at,
                uploadedBy: document.uploaded_by,
                mimeType: document.mime_type,
                size: document.size
            },
            metrics: {
                views: viewMetrics.total_views || 0,
                uniqueViewers: viewMetrics.unique_viewers || 0,
                lastViewed: viewMetrics.last_viewed,
                downloads: downloadMetrics.total_downloads || 0,
                shares: sharingMetrics.share_count || 0,
                comments: commentsMetrics.comment_count || 0
            },
            viewers: viewers
        };
        logger_1.logger.info(`Generated document analytics report for document ${documentId} in ${perfEnd()}ms`);
        return report;
    }
    catch (error) {
        logger_1.logger.error(`Error generating document analytics for document ${documentId}:`, error);
        throw error;
    }
}
/**
 * Get user analytics
 */
async function getUserAnalytics(userId) {
    const perfEnd = logger_1.performance.start('analytics-user-report');
    const db = (0, connection_1.getConnection)();
    try {
        // Get basic user information
        const [user] = await db.query('SELECT id, username, email, created_at, last_login FROM users WHERE id = ?', [userId]);
        if (!user) {
            return null;
        }
        // Get document metrics
        const documentQuery = `
      SELECT 
        COUNT(*) as total_documents,
        SUM(size) as total_storage,
        MAX(uploaded_at) as last_upload
      FROM documents
      WHERE uploaded_by = ?
    `;
        const [documentMetrics] = await db.query(documentQuery, [userId]);
        // Get activity metrics
        const activityQuery = `
      SELECT 
        COUNT(*) as total_actions,
        COUNT(DISTINCT document_id) as documents_accessed,
        MAX(timestamp) as last_activity
      FROM document_activity_log
      WHERE user_id = ?
    `;
        const [activityMetrics] = await db.query(activityQuery, [userId]);
        // Get search metrics
        const searchQuery = `
      SELECT 
        COUNT(*) as total_searches,
        COUNT(DISTINCT query) as unique_queries
      FROM search_history
      WHERE user_id = ?
    `;
        const [searchMetrics] = await db.query(searchQuery, [userId]);
        // Get recent activity
        const recentActivityQuery = `
      SELECT 
        action, 
        document_id,
        (SELECT name FROM documents WHERE id = document_id) as document_name,
        timestamp
      FROM document_activity_log
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `;
        const recentActivity = await db.query(recentActivityQuery, [userId]);
        // Get AI usage metrics
        const aiUsageQuery = `
      SELECT 
        COUNT(*) as total_requests,
        AVG(processing_time) as avg_processing_time
      FROM ai_processing_history
      WHERE user_id = ?
    `;
        const [aiMetrics] = await db.query(aiUsageQuery, [userId]);
        // Compile the report
        const report = {
            userInfo: {
                id: user.id,
                username: user.username,
                email: user.email,
                createdAt: user.created_at,
                lastLogin: user.last_login
            },
            metrics: {
                documents: documentMetrics.total_documents || 0,
                storageUsed: documentMetrics.total_storage || 0,
                lastUpload: documentMetrics.last_upload,
                totalActions: activityMetrics.total_actions || 0,
                documentsAccessed: activityMetrics.documents_accessed || 0,
                lastActivity: activityMetrics.last_activity,
                searches: searchMetrics.total_searches || 0,
                uniqueSearches: searchMetrics.unique_queries || 0,
                aiRequests: aiMetrics.total_requests || 0,
                avgAiProcessingTime: aiMetrics.avg_processing_time || 0
            },
            recentActivity: recentActivity
        };
        logger_1.logger.info(`Generated user analytics report for user ${userId} in ${perfEnd()}ms`);
        return report;
    }
    catch (error) {
        logger_1.logger.error(`Error generating user analytics for user ${userId}:`, error);
        throw error;
    }
}
/**
 * Calculate comparison between current and previous metrics
 */
function calculateComparison(current, previous) {
    const comparison = {};
    // Process each top-level metric category
    for (const category in current) {
        if (typeof current[category] === 'object') {
            comparison[category] = {};
            // Process each metric in the category
            for (const metric in current[category]) {
                if (typeof current[category][metric] === 'number') {
                    const currentValue = current[category][metric];
                    const previousValue = previous?.[category]?.[metric] || 0;
                    // Calculate change
                    if (previousValue === 0) {
                        comparison[category][metric] = { change: 100, trend: 'up' }; // New metric
                    }
                    else {
                        const percentChange = ((currentValue - previousValue) / previousValue) * 100;
                        comparison[category][metric] = {
                            change: parseFloat(percentChange.toFixed(2)),
                            trend: percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'stable'
                        };
                    }
                }
            }
        }
    }
    return comparison;
}
/**
 * Get date range from analytics options
 */
function getDateRangeFromOptions(options) {
    const now = new Date();
    let startDate, endDate = new Date();
    // If exact date range is provided, use it
    if (options.startDate && options.endDate) {
        return {
            startDate: new Date(options.startDate),
            endDate: new Date(options.endDate)
        };
    }
    // Otherwise calculate based on time period
    switch (options.timePeriod) {
        case AnalyticsTimePeriod.DAY:
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            break;
        case AnalyticsTimePeriod.WEEK:
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 7);
            break;
        case AnalyticsTimePeriod.MONTH:
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 1);
            break;
        case AnalyticsTimePeriod.QUARTER:
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 3);
            break;
        case AnalyticsTimePeriod.YEAR:
            startDate = new Date(now);
            startDate.setFullYear(startDate.getFullYear() - 1);
            break;
        default:
            // Default to last 30 days
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 30);
    }
    return { startDate, endDate };
}
/**
 * Get document metrics
 */
async function getDocumentMetrics(db, startDate, endDate, options) {
    // Total document count and growth
    const totalDocumentsQuery = `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN uploaded_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as new_in_period
    FROM documents
  `;
    const [totalDocs] = await db.query(totalDocumentsQuery, [startDate, endDate]);
    // Document count by type
    const docsByTypeQuery = `
    SELECT 
      mime_type,
      COUNT(*) as count
    FROM documents
    GROUP BY mime_type
    ORDER BY count DESC
  `;
    const docsByType = await db.query(docsByTypeQuery);
    // Document uploads over time
    const timeGrouping = getTimeGroupingSQL(options.groupBy || 'day');
    const uploadsOverTimeQuery = `
    SELECT 
      ${timeGrouping} as time_period,
      COUNT(*) as count
    FROM documents
    WHERE uploaded_at BETWEEN ? AND ?
    GROUP BY time_period
    ORDER BY time_period
  `;
    const uploadsOverTime = await db.query(uploadsOverTimeQuery, [startDate, endDate]);
    return {
        documents: {
            total: totalDocs.total,
            newInPeriod: totalDocs.new_in_period,
            byType: docsByType,
            uploadsOverTime: uploadsOverTime
        }
    };
}
/**
 * Get storage metrics
 */
async function getStorageMetrics(db, startDate, endDate, options) {
    // Total storage usage
    const storageQuery = `
    SELECT 
      SUM(size) as total_bytes,
      SUM(CASE WHEN uploaded_at BETWEEN ? AND ? THEN size ELSE 0 END) as new_bytes_in_period
    FROM documents
  `;
    const [storageData] = await db.query(storageQuery, [startDate, endDate]);
    // Storage by file type
    const storageByTypeQuery = `
    SELECT 
      mime_type,
      SUM(size) as bytes
    FROM documents
    GROUP BY mime_type
    ORDER BY bytes DESC
  `;
    const storageByType = await db.query(storageByTypeQuery);
    // Storage by user (top 10)
    const storageByUserQuery = `
    SELECT 
      u.id as user_id,
      u.username,
      SUM(d.size) as bytes,
      COUNT(d.id) as file_count
    FROM documents d
    JOIN users u ON d.uploaded_by = u.id
    GROUP BY u.id
    ORDER BY bytes DESC
    LIMIT 10
  `;
    const storageByUser = await db.query(storageByUserQuery);
    return {
        storage: {
            totalBytes: storageData.total_bytes || 0,
            totalMB: Math.round((storageData.total_bytes || 0) / (1024 * 1024)),
            newBytesInPeriod: storageData.new_bytes_in_period || 0,
            byType: storageByType,
            byUser: storageByUser
        }
    };
}
/**
 * Get user activity metrics
 */
async function getUserActivityMetrics(db, startDate, endDate, options) {
    // User activity metrics
    const userActivityQuery = `
    SELECT 
      COUNT(DISTINCT user_id) as active_users,
      COUNT(*) as total_actions
    FROM document_activity_log
    WHERE timestamp BETWEEN ? AND ?
  `;
    const [activityData] = await db.query(userActivityQuery, [startDate, endDate]);
    // Activity breakdown by action type
    const actionBreakdownQuery = `
    SELECT 
      action,
      COUNT(*) as count
    FROM document_activity_log
    WHERE timestamp BETWEEN ? AND ?
    GROUP BY action
    ORDER BY count DESC
  `;
    const actionBreakdown = await db.query(actionBreakdownQuery, [startDate, endDate]);
    // Most active users
    const activeUsersQuery = `
    SELECT 
      u.id as user_id,
      u.username,
      COUNT(dal.id) as action_count,
      COUNT(DISTINCT dal.document_id) as documents_accessed
    FROM document_activity_log dal
    JOIN users u ON dal.user_id = u.id
    WHERE dal.timestamp BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY action_count DESC
    LIMIT 10
  `;
    const activeUsers = await db.query(activeUsersQuery, [startDate, endDate]);
    // Activity over time
    const timeGrouping = getTimeGroupingSQL(options.groupBy || 'day');
    const activityOverTimeQuery = `
    SELECT 
      ${timeGrouping} as time_period,
      COUNT(*) as count,
      COUNT(DISTINCT user_id) as unique_users
    FROM document_activity_log
    WHERE timestamp BETWEEN ? AND ?
    GROUP BY time_period
    ORDER BY time_period
  `;
    const activityOverTime = await db.query(activityOverTimeQuery, [startDate, endDate]);
    return {
        userActivity: {
            activeUsers: activityData.active_users || 0,
            totalActions: activityData.total_actions || 0,
            actionBreakdown: actionBreakdown,
            mostActiveUsers: activeUsers,
            activityOverTime: activityOverTime
        }
    };
}
/**
 * Get search metrics
 */
async function getSearchMetrics(db, startDate, endDate, options) {
    // Search metrics
    const searchQuery = `
    SELECT 
      COUNT(*) as total_searches,
      COUNT(DISTINCT query) as unique_queries,
      COUNT(DISTINCT user_id) as users_searching,
      AVG(result_count) as avg_results
    FROM search_history
    WHERE created_at BETWEEN ? AND ?
  `;
    const [searchData] = await db.query(searchQuery, [startDate, endDate]);
    // Top search queries
    const topSearchesQuery = `
    SELECT 
      query,
      COUNT(*) as count
    FROM search_history
    WHERE created_at BETWEEN ? AND ?
    GROUP BY query
    ORDER BY count DESC
    LIMIT 10
  `;
    const topSearches = await db.query(topSearchesQuery, [startDate, endDate]);
    // Zero-result searches
    const zeroResultsQuery = `
    SELECT 
      query,
      COUNT(*) as count
    FROM search_history
    WHERE created_at BETWEEN ? AND ? AND result_count = 0
    GROUP BY query
    ORDER BY count DESC
    LIMIT 10
  `;
    const zeroResults = await db.query(zeroResultsQuery, [startDate, endDate]);
    // Searches over time
    const timeGrouping = getTimeGroupingSQL(options.groupBy || 'day');
    const searchesOverTimeQuery = `
    SELECT 
      ${timeGrouping} as time_period,
      COUNT(*) as count
    FROM search_history
    WHERE created_at BETWEEN ? AND ?
    GROUP BY time_period
    ORDER BY time_period
  `;
    const searchesOverTime = await db.query(searchesOverTimeQuery, [startDate, endDate]);
    return {
        search: {
            totalSearches: searchData.total_searches || 0,
            uniqueQueries: searchData.unique_queries || 0,
            usersSearching: searchData.users_searching || 0,
            averageResults: searchData.avg_results || 0,
            topQueries: topSearches,
            zeroResultQueries: zeroResults,
            searchesOverTime: searchesOverTime
        }
    };
}
/**
 * Get API usage metrics
 */
async function getApiMetrics(db, startDate, endDate, options) {
    // Total API requests
    const apiUsageQuery = `
    SELECT 
      COUNT(*) as total_requests,
      COUNT(DISTINCT api_key) as unique_keys,
      AVG(response_time) as avg_response_time
    FROM api_request_log
    WHERE timestamp BETWEEN ? AND ?
  `;
    const [apiData] = await db.query(apiUsageQuery, [startDate, endDate]);
    // Requests by endpoint
    const endpointsQuery = `
    SELECT 
      endpoint,
      COUNT(*) as count,
      AVG(response_time) as avg_response_time,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
    FROM api_request_log
    WHERE timestamp BETWEEN ? AND ?
    GROUP BY endpoint
    ORDER BY count DESC
  `;
    const endpoints = await db.query(endpointsQuery, [startDate, endDate]);
    // Requests by key/app
    const keyUsageQuery = `
    SELECT 
      api_key,
      (SELECT name FROM api_keys WHERE key_value = api_request_log.api_key) as key_name,
      COUNT(*) as count
    FROM api_request_log
    WHERE timestamp BETWEEN ? AND ?
    GROUP BY api_key
    ORDER BY count DESC
    LIMIT 10
  `;
    const keyUsage = await db.query(keyUsageQuery, [startDate, endDate]);
    // API usage over time
    const timeGrouping = getTimeGroupingSQL(options.groupBy || 'day');
    const apiOverTimeQuery = `
    SELECT 
      ${timeGrouping} as time_period,
      COUNT(*) as count,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
    FROM api_request_log
    WHERE timestamp BETWEEN ? AND ?
    GROUP BY time_period
    ORDER BY time_period
  `;
    const apiOverTime = await db.query(apiOverTimeQuery, [startDate, endDate]);
    return {
        api: {
            totalRequests: apiData.total_requests || 0,
            uniqueKeys: apiData.unique_keys || 0,
            avgResponseTime: apiData.avg_response_time || 0,
            byEndpoint: endpoints,
            byKey: keyUsage,
            requestsOverTime: apiOverTime
        }
    };
}
/**
 * Get AI usage metrics
 */
async function getAiUsageMetrics(db, startDate, endDate, options) {
    // Total AI usage
    const aiUsageQuery = `
    SELECT 
      COUNT(*) as total_requests,
      AVG(processing_time) as avg_processing_time,
      SUM(token_count) as total_tokens,
      AVG(token_count) as avg_tokens_per_request
    FROM ai_processing_history
    WHERE created_at BETWEEN ? AND ?
  `;
    const [aiData] = await db.query(aiUsageQuery, [startDate, endDate]);
    // Usage by operation type
    const operationQuery = `
    SELECT 
      operation_type,
      COUNT(*) as count,
      AVG(processing_time) as avg_processing_time,
      SUM(token_count) as token_count
    FROM ai_processing_history
    WHERE created_at BETWEEN ? AND ?
    GROUP BY operation_type
    ORDER BY count DESC
  `;
    const operations = await db.query(operationQuery, [startDate, endDate]);
    // Usage by model
    const modelQuery = `
    SELECT 
      model,
      COUNT(*) as count,
      AVG(processing_time) as avg_processing_time,
      SUM(token_count) as token_count
    FROM ai_processing_history
    WHERE created_at BETWEEN ? AND ?
    GROUP BY model
    ORDER BY count DESC
  `;
    const models = await db.query(modelQuery, [startDate, endDate]);
    // AI usage over time
    const timeGrouping = getTimeGroupingSQL(options.groupBy || 'day');
    const aiOverTimeQuery = `
    SELECT 
      ${timeGrouping} as time_period,
      COUNT(*) as count,
      SUM(token_count) as token_count
    FROM ai_processing_history
    WHERE created_at BETWEEN ? AND ?
    GROUP BY time_period
    ORDER BY time_period
  `;
    const aiOverTime = await db.query(aiOverTimeQuery, [startDate, endDate]);
    return {
        aiUsage: {
            totalRequests: aiData.total_requests || 0,
            avgProcessingTime: aiData.avg_processing_time || 0,
            totalTokens: aiData.total_tokens || 0,
            avgTokensPerRequest: aiData.avg_tokens_per_request || 0,
            byOperation: operations,
            byModel: models,
            requestsOverTime: aiOverTime
        }
    };
}
/**
 * Get SQL for time grouping based on granularity
 */
function getTimeGroupingSQL(groupBy) {
    // Different databases have different date formatting functions
    // This is a simplified version for SQLite
    switch (groupBy) {
        case 'week':
            return "strftime('%Y-%W', timestamp)";
        case 'month':
            return "strftime('%Y-%m', timestamp)";
        case 'day':
        default:
            return "strftime('%Y-%m-%d', timestamp)";
    }
}
