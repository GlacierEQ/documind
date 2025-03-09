/**
 * OpenAPI Specification Generator
 * Dynamically generates OpenAPI documentation for the Documind API
 */

import { version } from '../../../package.json';

/**
 * Generate OpenAPI specification
 */
export function generateSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Documind API',
      description: 'API for the Documind document management and legal research platform',
      version: version,
      contact: {
        name: 'Documind Support',
        url: 'https://documind.io/support',
        email: 'support@documind.io'
      },
      license: {
        name: 'Proprietary',
        url: 'https://documind.io/license'
      }
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Current API version'
      }
    ],
    tags: [
      {
        name: 'documents',
        description: 'Document management operations'
      },
      {
        name: 'folders',
        description: 'Folder management operations'
      },
      {
        name: 'search',
        description: 'Search operations'
      },
      {
        name: 'users',
        description: 'User management'
      },
      {
        name: 'legal',
        description: 'Legal research operations'
      },
      {
        name: 'ai',
        description: 'AI-powered operations'
      },
      {
        name: 'system',
        description: 'System operations'
      }
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health Check',
          description: 'Check the health status of the API',
          tags: ['system'],
          responses: {
            '200': {
              description: 'API is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: {
                        type: 'string',
                        example: 'healthy'
                      },
                      timestamp: {
                        type: 'string',
                        format: 'date-time'
                      },
                      version: {
                        type: 'string'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/documents': {
        get: {
          summary: 'List Documents',
          description: 'Get a paginated list of documents the user has access to',
          tags: ['documents'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
              description: 'Maximum number of documents to return'
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
              description: 'Number of documents to skip'
            },
            {
              name: 'folder',
              in: 'query',
              schema: { type: 'integer' },
              description: 'Filter by folder ID'
            },
            {
              name: 'search',
              in: 'query',
              schema: { type: 'string' },
              description: 'Search query'
            },
            {
              name: 'type',
              in: 'query',
              schema: { type: 'string' },
              description: 'Filter by document type'
            },
            {
              name: 'sortBy',
              in: 'query',
              schema: { 
                type: 'string', 
                enum: ['name', 'uploaded_at', 'size'], 
                default: 'uploaded_at' 
              },
              description: 'Field to sort by'
            },
            {
              name: 'sortDir',
              in: 'query',
              schema: { 
                type: 'string', 
                enum: ['asc', 'desc'], 
                default: 'desc' 
              },
              description: 'Sort direction'
            }
          ],
          security: [
            { bearerAuth: [] },
            { apiKeyAuth: [] }
          ],
          responses: {
            '200': {
              description: 'List of documents',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          $ref: '#/components/schemas/Document'
                        }
                      },
                      pagination: {
                        $ref: '#/components/schemas/Pagination'
                      }
                    }
                  }
                }
              }
            },
            '401': {
              $ref: '#/components/responses/Unauthorized'
            },
            '500': {
              $ref: '#/components/responses/ServerError'
            }
          }
        },
        post: {
          summary: 'Upload Document',
          description: 'Upload a new document',
          tags: ['documents'],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                      description: 'The document file to upload'
                    },
                    name: {
                      type: 'string',
                      description: 'Document name (optional, defaults to filename)'
                    },
                    folderId: {
                      type: 'integer',
                      description: 'Folder ID to place the document in'
                    },
                    metadata: {
                      type: 'string',
                      format: 'json',
                      description: 'JSON string of metadata to attach to the document'
                    }
                  }
                }
              }
            }
          },
          security: [
            { bearerAuth: [] },
            { apiKeyAuth: [] }
          ],
          responses: {
            '201': {
              description: 'Document uploaded successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        $ref: '#/components/schemas/Document'
                      }
                    }
                  }
                }
              }
            },
            '400': {
              $ref: '#/components/responses/BadRequest'
            },
            '401': {
              $ref: '#/components/responses/Unauthorized'
            },
            '413': {
              description: 'Payload too large - file exceeds size limits'
            },
            '500': {
              $ref: '#/components/responses/ServerError'
            }
          }
        }
      },
      '/documents/{id}': {
        get: {
          summary: 'Get Document',
          description: 'Get details for a specific document',
          tags: ['documents'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Document ID'
            }
          ],
          security: [
            { bearerAuth: [] },
            { apiKeyAuth: [] }
          ],
          responses: {
            '200': {
              description: 'Document details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        $ref: '#/components/schemas/Document'
                      }
                    }
                  }
                }
              }
            },
            '401': {
              $ref: '#/components/responses/Unauthorized'
            },
            '404': {
              $ref: '#/components/responses/NotFound'
            },
            '500': {
              $ref: '#/components/responses/ServerError'
            }
          }
        },
        delete: {
          summary: 'Delete Document',
          description: 'Delete a specific document',
          tags: ['documents'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
              description: 'Document ID'
            }
          ],
          security: [
            { bearerAuth: [] },
            { apiKeyAuth: [] }
          ],
          responses: {
            '200': {
              description: 'Document deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                        example: true
                      },
                      message: {
                        type: 'string',
                        example: 'Document deleted successfully'
                      }
                    }
                  }
                }
              }
            },
            '401': {
              $ref: '#/components/responses/Unauthorized'
            },
            '403': {
              $ref: '#/components/responses/Forbidden'
            },
            '404': {
              $ref: '#/components/responses/NotFound'
            },
            '500': {
              $ref: '#/components/responses/ServerError'
            }
          }
        }
      },
      // Define remaining endpoints...
    },
    components: {
      schemas: {
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Document ID'
            },
            name: {
              type: 'string',
              description: 'Document name'
            },
            mimeType: {
              type: 'string',
              description: 'MIME type'
            },
            size: {
              type: 'integer',
              description: 'Size in bytes'
            },
            uploadedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Upload timestamp'
            },
            uploadedBy: {
              type: 'integer',
              description: 'User ID of uploader'
            },
            folderId: {
              type: 'integer',
              description: 'Parent folder ID',
              nullable: true
            },
            metadata: {
              type: 'object',
              description: 'Document metadata',
              additionalProperties: true
            },
            path: {
              type: 'string',
              description: 'Path to document'
            }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            total: {
              type: 'integer',
              description: 'Total number of items available'
            },
            limit: {
              type: 'integer',
              description: 'Number of items per page'
            },
            offset: {
              type: 'integer',
              description: 'Current offset'
            },
            hasMore: {
              type: 'boolean',
              description: 'Whether there are more items available'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string'
                },
                message: {
                  type: 'string'
                },
                details: {
                  type: 'string'
                }
              }
            }
          }
        }
      },
      responses: {
        BadRequest: {
          description: 'Bad request - invalid input',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Invalid request parameters'
                }
              }
            }
          }
        },
        Unauthorized: {
          description: 'Unauthorized - authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: {
                  code: 'UNAUTHORIZED',
                  message: 'Authentication required'
                }
              }
            }
          }
        },
        Forbidden: {
          description: 'Forbidden - insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: {
                  code: 'FORBIDDEN',
                  message: 'Insufficient permissions to access this resource'
                }
              }
            }
          }
        },
        NotFound: {
          description: 'Not found - resource does not exist',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: {
                  code: 'NOT_FOUND',
                  message: 'Requested resource not found'
                }
              }
            }
          }
        },
        ServerError: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: {
                  code: 'SERVER_ERROR',
                  message: 'Internal server error occurred'
                }
              }
            }
          }
        }
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Authorization header using the Bearer scheme'
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-KEY',
          description: 'API key authentication'
        }
      }
    }
  };
}
