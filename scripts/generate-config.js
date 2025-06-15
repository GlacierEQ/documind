#!/usr/bin/env node

/**
 * Documind Configuration Generator
 * Interactively generates configuration for advanced deployments
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Configuration templates
const templates = {
  development: {
    NODE_ENV: 'development',
    PORT: 3000,
    LOG_LEVEL: 'debug',
    SESSION_SECRET: 'dev_session_secret',
    
    // Database
    DB_TYPE: 'sqlite',
    DB_NAME: 'documind_dev.db',
    
    // Storage
    STORAGE_TYPE: 'local',
    STORAGE_PATH: './data/uploads',
    
    // Search
    SEARCH_TYPE: 'basic',
    
    // AI
    AI_PROVIDER: 'none',
    AI_MAX_TOKENS: 1000,
    
    // Features
    ENABLE_OCR: true,
    ENABLE_CLUSTERING: true,
    ENABLE_VISUALIZATIONS: true,
    ENABLE_BRIEF_ASSISTANT: false,
    ENABLE_LEGAL_INTEGRATIONS: false,
    ENABLE_TIMELINE_EXTRACTION: true
  },
  
  production: {
    NODE_ENV: 'production',
    PORT: 3000,
    LOG_LEVEL: 'info',
    SESSION_SECRET: crypto.randomBytes(64).toString('hex'),
    
    // Database
    DB_TYPE: 'postgres',
    DB_HOST: 'db',
    DB_PORT: 5432,
    DB_NAME: 'documind',
    DB_USER: 'documind',
    DB_PASSWORD: crypto.randomBytes(12).toString('base64'),
    
    // Redis
    REDIS_HOST: 'redis',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: crypto.randomBytes(12).toString('base64'),
    
    // Storage
    STORAGE_TYPE: 'local',
    STORAGE_PATH: '/app/data/uploads',
    MAX_UPLOAD_SIZE: '50MB',
    
    // Search
    SEARCH_TYPE: 'advanced',
    SEARCH_BATCH_SIZE: 500,
    
    // AI
    AI_PROVIDER: 'granite',
    GRANITE_API_KEY: 'your-granite-api-key-here',
    GRANITE_MODEL: 'granite-34b-instruct',
    GRANITE_EMBEDDING_MODEL: 'granite-embedding',
    AI_MAX_TOKENS: 4000,
    AI_TEMPERATURE: 0.2,
    
    // Features
    ENABLE_OCR: true,
    ENABLE_CLUSTERING: true,
    ENABLE_VISUALIZATIONS: true,
    ENABLE_BRIEF_ASSISTANT: true,
    ENABLE_LEGAL_INTEGRATIONS: true,
    ENABLE_TIMELINE_EXTRACTION: true,
    
    // Security
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    JWT_EXPIRY: '24h',
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_REQUIRE_COMPLEXITY: true,
    
    // Email
    SMTP_HOST: '',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: '',
    SMTP_PASS: '',
    EMAIL_FROM: 'documind@example.com'
  },
  
  minimal: {
    NODE_ENV: 'production',
    PORT: 3000,
    LOG_LEVEL: 'warn',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    
    // Database
    DB_TYPE: 'sqlite',
    DB_NAME: 'documind.db',
    
    // Storage
    STORAGE_TYPE: 'local',
    STORAGE_PATH: '/app/data/uploads',
    MAX_UPLOAD_SIZE: '20MB',
    
    // Search
    SEARCH_TYPE: 'basic',
    
    // AI
    AI_PROVIDER: 'none',
    
    // Features
    ENABLE_OCR: true,
    ENABLE_CLUSTERING: false,
    ENABLE_VISUALIZATIONS: false,
    ENABLE_BRIEF_ASSISTANT: false,
    ENABLE_LEGAL_INTEGRATIONS: false,
    ENABLE_TIMELINE_EXTRACTION: false
  }
};

// Questions for interactive configuration
const questions = [
  {
    name: 'template',
    question: 'Select a configuration template:',
    options: ['development', 'production', 'minimal'],
    default: 'production'
  },
  {
    name: 'DB_TYPE',
    question: 'Select database type:',
    options: ['sqlite', 'postgres', 'mysql'],
    default: null
  },
  {
    name: 'STORAGE_TYPE',
    question: 'Select storage type:',
    options: ['local', 's3'],
    default: null
  },
  {
    name: 'AI_PROVIDER',
    question: 'Select AI provider:',
    options: ['none', 'granite', 'openai', 'local'],
    default: null
  },
  {
    name: 'deployment',
    question: 'Select deployment method:',
    options: ['docker', 'manual'],
    default: 'docker'
  },
  {
    name: 'advanced',
    question: 'Configure advanced settings?',
    options: ['yes', 'no'],
    default: 'no'
  }
];

// Advanced questions based on previous answers
const advancedQuestions = {
  postgres: [
    { name: 'DB_HOST', question: 'Database host:', default: 'localhost' },
    { name: 'DB_PORT', question: 'Database port:', default: 5432 },
    { name: 'DB_NAME', question: 'Database name:', default: 'documind' },
    { name: 'DB_USER', question: 'Database username:', default: 'documind' },
    { name: 'DB_PASSWORD', question: 'Database password:', default: crypto.randomBytes(12).toString('base64') }
  ],
  mysql: [
    { name: 'DB_HOST', question: 'Database host:', default: 'localhost' },
    { name: 'DB_PORT', question: 'Database port:', default: 3306 },
    { name: 'DB_NAME', question: 'Database name:', default: 'documind' },
    { name: 'DB_USER', question: 'Database username:', default: 'documind' },
    { name: 'DB_PASSWORD', question: 'Database password:', default: crypto.randomBytes(12).toString('base64') }
  ],
  s3: [
    { name: 'S3_BUCKET', question: 'S3 bucket name:', default: 'documind-files' },
    { name: 'S3_REGION', question: 'S3 region:', default: 'us-east-1' },
    { name: 'S3_ACCESS_KEY', question: 'S3 access key:', default: '' },
    { name: 'S3_SECRET_KEY', question: 'S3 secret key:', default: '' }
  ],
  granite: [
    { name: 'GRANITE_API_KEY', question: 'Granite API key:', default: '' },
    { name: 'GRANITE_MODEL', question: 'Granite model:', default: 'granite-34b-instruct' }
  ],
  openai: [
    { name: 'OPENAI_API_KEY', question: 'OpenAI API key:', default: '' },
    { name: 'OPENAI_MODEL', question: 'OpenAI model:', default: 'gpt-4' }
  ],
  local: [
    { name: 'LOCAL_AI_ENDPOINT', question: 'Local AI endpoint URL:', default: 'http://localhost:8080' },
    { name: 'LOCAL_AI_MODEL', question: 'Local AI model name:', default: 'llama3' }
  ],
  security: [
    { name: 'PASSWORD_MIN_LENGTH', question: 'Minimum password length:', default: 8 },
    { name: 'PASSWORD_REQUIRE_COMPLEXITY', question: 'Require complex passwords? (true/false)', default: 'true' },
    { name: 'SESSION_TIMEOUT', question: 'Session timeout (minutes):', default: 60 }
  ]
};

// Ask a question and return the answer
function ask(question, options = null, defaultValue = null) {
  return new Promise((resolve) => {
    let prompt = question;
    
    if (options) {
      prompt += ' (' + options.join('/') + ')';
    }
    
    if (defaultValue !== null) {
      prompt += ` [${defaultValue}]`;
    }
    
    prompt += ': ';
    
    rl.question(prompt, (answer) => {
      if (!answer.trim() && defaultValue !== null) {
        resolve(defaultValue);
      } else if (options && !options.includes(answer.toLowerCase()) && answer.trim()) {
        console.log(`Invalid option. Please choose from: ${options.join(', ')}`);
        resolve(ask(question, options, defaultValue));
      } else {
        resolve(answer || '');
      }
    });
  });
}

// Main function
async function main() {
  console.log('\n=== Documind Configuration Generator ===\n');
  
  // Gather answers
  const answers = {};
  
  // Base questions
  for (const q of questions) {
    answers[q.name] = await ask(q.question, q.options, q.default);
  }
  
  // Select template as starting point
  let config = { ...templates[answers.template] };
  
  // Override with user selections for major options
  if (answers.DB_TYPE !== '') config.DB_TYPE = answers.DB_TYPE;
  if (answers.STORAGE_TYPE !== '') config.STORAGE_TYPE = answers.STORAGE_TYPE;
  if (answers.AI_PROVIDER !== '') config.AI_PROVIDER = answers.AI_PROVIDER;
  
  // Ask database-specific questions
  if (answers.advanced === 'yes') {
    console.log('\n=== Advanced Configuration ===\n');
    
    // Database questions
    if (config.DB_TYPE === 'postgres' || config.DB_TYPE === 'mysql') {
      console.log(`\n-- Database Configuration (${config.DB_TYPE}) --`);
      for (const q of advancedQuestions[config.DB_TYPE]) {
        config[q.name] = await ask(q.question, null, q.default || config[q.name]);
      }
    }
    
    // Storage questions
    if (config.STORAGE_TYPE === 's3') {
      console.log('\n-- Storage Configuration --');
      for (const q of advancedQuestions.s3) {
        config[q.name] = await ask(q.question, null, q.default || config[q.name]);
      }
    }
    
    // AI provider questions
    if (config.AI_PROVIDER !== 'none') {
      console.log(`\n-- AI Configuration (${config.AI_PROVIDER}) --`);
      for (const q of advancedQuestions[config.AI_PROVIDER]) {
        config[q.name] = await ask(q.question, null, q.default || config[q.name]);
      }
    }
    
    // Security questions
    console.log('\n-- Security Configuration --');
    for (const q of advancedQuestions.security) {
      config[q.name] = await ask(q.question, null, q.default || config[q.name]);
    }
  }
  
  // Generate files
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
  
  let filename;
  if (answers.deployment === 'docker') {
    filename = '.env.docker';
  } else {
    filename = '.env';
  }
  
  // Write configuration file
  try {
    fs.writeFileSync(path.join(process.cwd(), filename), envContent);
    console.log(`\nConfiguration written to ${filename}`);
    
    // Generate docker-compose overrides if using docker
    if (answers.deployment === 'docker' && answers.advanced === 'yes') {
      const composeOverridesContent = `
version: '3.8'

services:
  # Documind application service overrides
  app:
    environment:
      - NODE_ENV=${config.NODE_ENV}
      - LOG_LEVEL=${config.LOG_LEVEL}
${config.AI_PROVIDER !== 'none' ? `      - AI_PROVIDER=${config.AI_PROVIDER}` : ''}

  # Database overrides
  db:
    environment:
      - POSTGRES_DB=${config.DB_NAME}
      - POSTGRES_USER=${config.DB_USER}
      - POSTGRES_PASSWORD=${config.DB_PASSWORD}
${config.DB_TYPE === 'postgres' ? `    ports:
      - "127.0.0.1:${config.DB_PORT}:5432"` : ''}

  # Redis overrides
${config.REDIS_PASSWORD ? `  redis:
    command: redis-server --requirepass ${config.REDIS_PASSWORD}` : ''}
`;
      fs.writeFileSync(path.join(process.cwd(), 'docker-compose.override.yml'), composeOverridesContent);
      console.log('Docker Compose overrides written to docker-compose.override.yml');
    }
    
    console.log('\n=== Configuration Complete ===');
    if (answers.deployment === 'docker') {
      console.log('\nTo start Documind:');
      console.log('  docker-compose up -d');
    } else {
      console.log('\nTo start Documind:');
      console.log('  npm start');
    }
  } catch (error) {
    console.error('Error writing configuration file:', error);
  }
  
  rl.close();
}

main();
