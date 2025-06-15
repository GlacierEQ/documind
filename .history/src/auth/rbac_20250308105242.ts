/**
 * Role-Based Access Control (RBAC) Module
 * Enterprise-grade permission management system
 */

import { getConnection } from '../database/connection';
import { logger } from '../utils/logger';

// Standard roles
export enum Role {
  ADMIN = 'admin',
  USER = 'user',
  MANAGER = 'manager',
  AUDITOR = 'auditor',
  GUEST = 'guest',
  API = 'api'
}

// Permission types - what actions can be performed
export enum PermissionType {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  SHARE = 'share',
  EXPORT = 'export',
  IMPORT = 'import',
  MANAGE_USERS = 'manage_users',
  MANAGE_SETTINGS = 'manage_settings',
  AUDIT = 'audit',
  AI_FEATURES = 'ai_features',
  API_ACCESS = 'api_access'
}

// Resource types - what objects permissions apply to
export enum ResourceType {
  DOCUMENT = 'document',
  FOLDER = 'folder',
  USER = 'user',
  SYSTEM = 'system',
  SETTINGS = 'settings',
  ANALYTICS = 'analytics',
  API = 'api'
}

/**
 * Check if user has permission to perform action on resource
 */
export async function hasPermission(
  userId: number,
  permissionType: PermissionType,
  resourceType: ResourceType,
  resourceId?: number
): Promise<boolean> {
  try {
    const db = getConnection();
    
    // Get user roles
    const userRoles = await db.query(
      `SELECT role FROM user_roles WHERE user_id = ?`,
      [userId]
    );
    
    if (!userRoles || userRoles.length === 0) {
      return false;
    }
    
    const roles = userRoles.map(ur => ur.role);
    
    // Special case: Admin has all permissions
    if (roles.includes(Role.ADMIN)) {
      return true;
    }
    
    // Check role permissions in the database
    const permQuery = `
      SELECT COUNT(*) as has_perm
      FROM role_permissions
      WHERE role IN (${roles.map(() => '?').join(',')})
      AND permission = ?
      AND resource_type = ?
    `;
    
    const params = [...roles, permissionType, resourceType];
    const result = await db.query(permQuery, params);
    
    if (result && result[0] && result[0].has_perm > 0) {
      // If this is a specific resource (not system-wide), check resource permissions
      if (resourceId) {
        return await checkResourcePermission(
          userId,
          permissionType,
          resourceType,
          resourceId
        );
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error('Error checking permissions:', error);
    return false;
  }
}

/**
 * Check permissions for a specific resource
 */
async function checkResourcePermission(
  userId: number,
  permissionType: PermissionType,
  resourceType: ResourceType,
  resourceId: number
): Promise<boolean> {
  try {
    const db = getConnection();
    
    switch (resourceType) {
      case ResourceType.DOCUMENT:
        // Check if user owns the document or has permission through sharing
        const docQuery = `
          SELECT COUNT(*) as has_access
          FROM documents d
          LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.shared_with = ?
          WHERE d.id = ? AND (
            d.uploaded_by = ? 
            OR ds.shared_with IS NOT NULL
            ${permissionType === PermissionType.READ ? "" : "AND ds.permission = 'edit'"}
          )
        `;
        const docResult = await db.query(docQuery, [userId, resourceId, userId]);
        return docResult && docResult[0] && docResult[0].has_access > 0;
        
      case ResourceType.FOLDER:
        // Check if user owns the folder or has been given access
        const folderQuery = `
          SELECT COUNT(*) as has_access
          FROM folders f
          LEFT JOIN folder_shares fs ON f.id = fs.folder_id AND fs.shared_with = ?
          WHERE f.id = ? AND (
            f.created_by = ? 
            OR fs.shared_with IS NOT NULL
            ${permissionType === PermissionType.READ ? "" : "AND fs.permission = 'edit'"}
          )
        `;
        const folderResult = await db.query(folderQuery, [userId, resourceId, userId]);
        return folderResult && folderResult[0] && folderResult[0].has_access > 0;
        
      case ResourceType.USER:
        // Users can only manage themselves unless they're admins or managers
        const userRoles = await db.query(
          `SELECT role FROM user_roles WHERE user_id = ?`,
          [userId]
        );
        
        const roles = userRoles.map(ur => ur.role);
        
        // Admins and managers can manage other users
        if (roles.includes(Role.ADMIN) || roles.includes(Role.MANAGER)) {
          return true;
        }
        
        // Users can only manage themselves
        return userId === resourceId;
        
      default:
        return false;
    }
  } catch (error) {
    logger.error(`Error checking resource permission (${resourceType}:${resourceId}):`, error);
    return false;
  }
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(userId: number): Promise<{
  roles: string[];
  permissions: { type: string; resources: string[] }[];
}> {
  try {
    const db = getConnection();
    
    // Get user roles
    const userRoles = await db.query(
      `SELECT role FROM user_roles WHERE user_id = ?`,
      [userId]
    );
    
    const roles = userRoles.map(ur => ur.role);
    
    // Get role permissions
    const permQuery = `
      SELECT DISTINCT permission, resource_type
      FROM role_permissions
      WHERE role IN (${roles.map(() => '?').join(',')})
    `;
    
    const permissions = await db.query(permQuery, [...roles]);
    
    // Transform permissions into grouped format
    const groupedPerms = permissions.reduce((acc, p) => {
      const existing = acc.find(item => item.type === p.permission);
      if (existing) {
        existing.resources.push(p.resource_type);
      } else {
        acc.push({
          type: p.permission,
          resources: [p.resource_type]
        });
      }
      return acc;
    }, []);
    
    return {
      roles,
      permissions: groupedPerms
    };
  } catch (error) {
    logger.error('Error retrieving user permissions:', error);
    return { roles: [], permissions: [] };
  }
}

/**
 * Express middleware to check for specific permission
 */
export function requirePermission(
  permissionType: PermissionType, 
  resourceType: ResourceType,
  getResourceId?: (req: any) => number | undefined
) {
  return async (req, res, next) => {
    try {
      const userId = (req.user as any)?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      // Get resource ID if provided
      const resourceId = getResourceId ? getResourceId(req) : undefined;
      
      const hasAccess = await hasPermission(
        userId,
        permissionType,
        resourceType,
        resourceId
      );
      
      if (hasAccess) {
        return next();
      } else {
        return res.status(403).json({ 
          error: 'Permission denied',
          requiredPermission: {
            action: permissionType,
            resource: resourceType,
            resourceId
          }
        });
      }
    } catch (error) {
      logger.error('Error in permission middleware:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * Create default roles and permissions
 * This should be run during system initialization
 */
export async function initializeRoles(): Promise<void> {
  try {
    const db = getConnection();
    
    // Define default roles and their permissions
    const roleDefinitions = [
      {
        role: Role.ADMIN,
        permissions: [
          // Admins have all permissions on all resources
          ...Object.values(PermissionType).map(perm => ({
            permission: perm,
            resourceTypes: Object.values(ResourceType)
          }))
        ]
      },
      {
        role: Role.MANAGER,
        permissions: [
          { permission: PermissionType.CREATE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.READ, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER, ResourceType.ANALYTICS] },
          { permission: PermissionType.UPDATE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.DELETE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.SHARE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.EXPORT, resourceTypes: [ResourceType.DOCUMENT, ResourceType.ANALYTICS] },
          { permission: PermissionType.IMPORT, resourceTypes: [ResourceType.DOCUMENT] },
          { permission: PermissionType.MANAGE_USERS, resourceTypes: [ResourceType.USER] },
          { permission: PermissionType.AI_FEATURES, resourceTypes: [ResourceType.DOCUMENT] },
        ]
      },
      {
        role: Role.USER,
        permissions: [
          { permission: PermissionType.CREATE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.READ, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.UPDATE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.DELETE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.SHARE, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.EXPORT, resourceTypes: [ResourceType.DOCUMENT] },
          { permission: PermissionType.IMPORT, resourceTypes: [ResourceType.DOCUMENT] },
          { permission: PermissionType.AI_FEATURES, resourceTypes: [ResourceType.DOCUMENT] },
        ]
      },
      {
        role: Role.AUDITOR,
        permissions: [
          { permission: PermissionType.READ, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER, ResourceType.ANALYTICS] },
          { permission: PermissionType.AUDIT, resourceTypes: [ResourceType.DOCUMENT, ResourceType.SYSTEM, ResourceType.USER] },
          { permission: PermissionType.EXPORT, resourceTypes: [ResourceType.DOCUMENT, ResourceType.ANALYTICS] },
        ]
      },
      {
        role: Role.GUEST,
        permissions: [
          { permission: PermissionType.READ, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
        ]
      },
      {
        role: Role.API,
        permissions: [
          { permission: PermissionType.API_ACCESS, resourceTypes: [ResourceType.API] },
          { permission: PermissionType.READ, resourceTypes: [ResourceType.DOCUMENT, ResourceType.FOLDER] },
          { permission: PermissionType.CREATE, resourceTypes: [ResourceType.DOCUMENT] },
        ]
      }
    ];
    
    // Insert roles and permissions
    for (const roleDef of roleDefinitions) {
      // Insert or update role
      await db.query(
        'INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)',
        [roleDef.role, `Default ${roleDef.role} role`]
      );
      
      // Insert permissions for this role
      for (const perm of roleDef.permissions) {
        for (const resourceType of perm.resourceTypes) {
          await db.query(
            `INSERT OR IGNORE INTO role_permissions
             (role, permission, resource_type)
             VALUES (?, ?, ?)`,
            [roleDef.role, perm.permission, resourceType]
          );
        }
      }
    }
    
    logger.info('Default roles and permissions initialized successfully');
  } catch (error) {
    logger.error('Error initializing default roles and permissions:', error);
  }
}
