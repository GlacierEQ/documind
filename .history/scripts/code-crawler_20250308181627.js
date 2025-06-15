#!/usr/bin/env node
/**
 * Advanced Code Crawler for Documind
 * 
 * Recursively scans the codebase to build a dependency graph,
 * detect issues, and prepare for deployment.
 */

const fs = require('fs');
const path = require('path');
const util = require('util');
const { execSync, exec } = require('child_process');
const execAsync = util.promisify(exec);

// Configuration
const CONFIG = {
  rootDir: path.join(__dirname, '..'),
  sourceDir: path.join(__dirname, '../src'),
  testDir: path.join(__dirname, '../tests'),
  outputDir: path.join(__dirname, '../build/analysis'),
  ignorePatterns: ['node_modules', 'dist', 'build', '.git', 'coverage'],
  fileExtensions: ['.ts', '.js', '.tsx', '.jsx', '.json', '.md', '.html', '.css'],
  recursionLimit: 10,
  analysisModules: ['structure', 'complexity', 'dependencies', 'quality', 'security'],
  maxFileSizeBytes: 1024 * 1024, // 1MB
};

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  detailed: args.includes('--detailed') || args.includes('-d'),
  recursive: args.includes('--recursive') || args.includes('-r'),
  outputJson: args.includes('--json'),
  silent: args.includes('--silent'),
  debug: args.includes('--debug'),
  maxDepth: 10,
  fixes: args.includes('--fix'),
};

// For each argument with a value (--option=value format)
args.forEach(arg => {
  if (arg.startsWith('--depth=')) {
    options.maxDepth = parseInt(arg.split('=')[1], 10);
  }
  if (arg.startsWith('--output=')) {
    CONFIG.outputDir = arg.split('=')[1];
  }
});

// Ensure output directory exists
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Setup logging
const log = {
  info: (...msg) => !options.silent && console.log('\x1b[36m%s\x1b[0m', ...msg),
  success: (...msg) => !options.silent && console.log('\x1b[32m%s\x1b[0m', ...msg),
  warning: (...msg) => !options.silent && console.log('\x1b[33m%s\x1b[0m', ...msg),
  error: (...msg) => !options.silent && console.log('\x1b[31m%s\x1b[0m', ...msg),
  debug: (...msg) => options.debug && console.log('\x1b[90m%s\x1b[0m', ...msg),
};

/**
 * Analysis result container
 */
const result = {
  timestamp: new Date().toISOString(),
  summary: {
    totalFiles: 0,
    totalLines: 0,
    totalSize: 0,
    fileTypes: {},
    topComplexFiles: [],
    issues: {
      errors: 0,
      warnings: 0,
      infos: 0,
    }
  },
  modules: {},
  files: [],
};

/**
 * Check if path should be ignored
 */
function shouldIgnore(filePath) {
  const relativePath = path.relative(CONFIG.rootDir, filePath);
  return CONFIG.ignorePatterns.some(pattern => 
    relativePath.includes(pattern) || 
    relativePath.startsWith(pattern) || 
    relativePath.endsWith(pattern)
  );
}

/**
 * Check if file should be analyzed based on extension
 */
function shouldAnalyzeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONFIG.fileExtensions.includes(ext);
}

/**
 * Count lines in a file
 */
function countLines(content) {
  return content.split('\n').length;
}

/**
 * Analyze a single file
 */
async function analyzeFile(filePath) {
  try {
    log.debug(`Analyzing file: ${filePath}`);
    
    const relativePath = path.relative(CONFIG.rootDir, filePath);
    const ext = path.extname(filePath).toLowerCase();
    const stats = fs.statSync(filePath);
    
    // Skip files that are too large
    if (stats.size > CONFIG.maxFileSizeBytes) {
      log.warning(`Skipping large file: ${relativePath} (${Math.round(stats.size / 1024)}KB)`);
      return null;
    }
    
    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = countLines(content);
    
    // Basic file info
    const fileInfo = {
      path: relativePath,
      type: ext.substring(1), // Remove the dot
      size: stats.size,
      lines: lines,
      lastModified: stats.mtime,
      issues: [],
    };
    
    // Update summary
    result.summary.totalFiles++;
    result.summary.totalLines += lines;
    result.summary.totalSize += stats.size;
    result.summary.fileTypes[ext] = (result.summary.fileTypes[ext] || 0) + 1;
    
    // Analysis specific to file types
    if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
      // JavaScript/TypeScript specific analysis
      try {
        await analyzeJsTs(filePath, fileInfo, content);
      } catch (err) {
        log.error(`Error analyzing JS/TS file ${filePath}: ${err.message}`);
        fileInfo.issues.push({
          type: 'error',
          message: `Analysis error: ${err.message}`,
          line: 0,
          column: 0,
        });
      }
    }
    
    return fileInfo;
  } catch (err) {
    log.error(`Error analyzing file ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Perform JavaScript/TypeScript specific analysis
 */
async function analyzeJsTs(filePath, fileInfo, content) {
  // Check complexity using ESLint
  try {
    const eslintCmd = `npx eslint --no-eslintrc --config ${path.join(CONFIG.rootDir, '.eslintrc.json')} --format json "${filePath}"`;
    log.debug(`Running: ${eslintCmd}`);
    
    const eslintOutput = execSync(eslintCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const eslintResult = JSON.parse(eslintOutput);
    
    if (eslintResult && eslintResult.length > 0 && eslintResult[0].messages) {
      const complexityMessages = eslintResult[0].messages.filter(m => 
        m.ruleId === 'complexity' || 
        m.ruleId === 'max-lines' ||
        m.ruleId === 'max-lines-per-function'
      );
      
      if (complexityMessages.length > 0) {
        const maxComplexity = Math.max(...complexityMessages
          .filter(m => m.ruleId === 'complexity')
          .map(m => parseInt(m.message.match(/complexity of (\d+)/)?.[1] || '0', 10)));
        
        fileInfo.complexity = maxComplexity;
        
        // Add to top complex files if it's high complexity
        if (maxComplexity > 10) {
          result.summary.topComplexFiles.push({
            path: fileInfo.path,
            complexity: maxComplexity,
          });
          
          // Sort by complexity descending and keep only top 10
          result.summary.topComplexFiles.sort((a, b) => b.complexity - a.complexity);
          if (result.summary.topComplexFiles.length > 10) {
            result.summary.topComplexFiles.pop();
          }
        }
      }
      
      // Add issues to file info
      fileInfo.issues = eslintResult[0].messages.map(msg => ({
        type: msg.severity === 2 ? 'error' : 'warning',
        rule: msg.ruleId,
        message: msg.message,
        line: msg.line,
        column: msg.column,
      }));
      
      // Update issue count in summary
      fileInfo.issues.forEach(issue => {
        if (issue.type === 'error') result.summary.issues.errors++;
        else if (issue.type === 'warning') result.summary.issues.warnings++;
        else result.summary.issues.infos++;
      });
    }
  } catch (err) {
    // ESLint might throw if there are syntax errors
    log.debug(`ESLint error for ${filePath}: ${err.message}`);
    fileInfo.issues.push({
      type: 'error',
      rule: 'syntax',
      message: `Syntax error: ${err.message}`,
      line: 1,
      column: 1,
    });
    result.summary.issues.errors++;
  }
  
  // Detect imports/dependencies
  const importRegex = /(?:import|require)\s*\(?\s*['"]([^'"]+)['"]\)?/g;
  fileInfo.dependencies = [];
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    fileInfo.dependencies.push(match[1]);
  }
  
  // Detect TODO and FIXME comments
  const todoRegex = /\/\/\s*(TODO|FIXME)(?:\(([^)]+)\))?:?\s*(.*)/g;
  fileInfo.todos = [];
  
  while ((match = todoRegex.exec(content)) !== null) {
    fileInfo.todos.push({
      type: match[1], // TODO or FIXME
      author: match[2] || 'unknown',
      text: match[3].trim(),
      line: content.substring(0, match.index).split('\n').length,
    });
  }
}

/**
 * Recursively walk directory and analyze files
 */
async function walkDirectory(dir, depth = 0) {
  if (depth > options.maxDepth) return [];
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (shouldIgnore(fullPath)) {
      continue;
    }
    
    if (entry.isDirectory()) {
      if (options.recursive) {
        const subFiles = await walkDirectory(fullPath, depth + 1);
        files.push(...subFiles);
      }
    } else if (entry.isFile() && shouldAnalyzeFile(fullPath)) {
      const fileInfo = await analyzeFile(fullPath);
      if (fileInfo) files.push(fileInfo);
    }
  }
  
  return files;
}

/**
 * Analyze module dependencies and detect circular dependencies
 */
async function analyzeModuleDependencies() {
  log.info('Analyzing module dependencies...');
  
  try {
    const { stdout } = await execAsync('npx madge --circular --json --extensions ts,js src/');
    const circularDeps = JSON.parse(stdout);
    
    result.modules.dependencies = {
      circular: circularDeps,
      hasCycles: circularDeps.length > 0,
    };
    
    if (circularDeps.length > 0) {
      log.warning(`Found ${circularDeps.length} circular dependencies`);
    }
  } catch (err) {
    log.error(`Error analyzing module dependencies: ${err.message}`);
  }
}

/**
 * Analyze overall code quality and structure
 */
async function analyzeCodeQuality() {
  log.info('Analyzing code quality...');
  
  try {
    // Run ESLint on the entire codebase
    const { stdout } = await execAsync(`npx eslint --format json "${CONFIG.sourceDir}/**/*.{ts,js}"`);
    const lintResults = JSON.parse(stdout);
    
    // Process and aggregate lint results
    const qualityMetrics = {
      totalIssues: 0,
      issuesByType: {},
      fileIssues: {},
      mostCommonIssues: {},
    };
    
    lintResults.forEach(fileResult => {
      const filePath = path.relative(CONFIG.rootDir, fileResult.filePath);
      qualityMetrics.fileIssues[filePath] = fileResult.messages.length;
      qualityMetrics.totalIssues += fileResult.messages.length;
      
      fileResult.messages.forEach(msg => {
        const ruleId = msg.ruleId || 'syntax-error';
        qualityMetrics.mostCommonIssues[ruleId] = (qualityMetrics.mostCommonIssues[ruleId] || 0) + 1;
        
        const type = msg.severity === 2 ? 'error' : 'warning';
        qualityMetrics.issuesByType[type] = (qualityMetrics.issuesByType[type] || 0) + 1;
      });
    });
    
    // Sort most common issues
    qualityMetrics.topIssues = Object.entries(qualityMetrics.mostCommonIssues)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));
    
    result.modules.quality = qualityMetrics;
  } catch (err) {
    log.error(`Error analyzing code quality: ${err.message}`);
  }
}

/**
 * Analyze security vulnerabilities
 */
async function analyzeSecurityVulnerabilities() {
  log.info('Running security vulnerability scan...');
  
  try {
    // Run npm audit
    const { stdout } = await execAsync('npm audit --json');
    const auditResults = JSON.parse(stdout);
    
    // Process vulnerabilities
    const securityMetrics = {
      vulnerabilities: {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
      },
      dependencyIssues: [],
    };
    
    // Process vulnerabilities by severity
    if (auditResults.vulnerabilities) {
      Object.values(auditResults.vulnerabilities).forEach(vulnerability => {
        securityMetrics.vulnerabilities[vulnerability.severity]++;
        
        securityMetrics.dependencyIssues.push({
          package: vulnerability.name,
          severity: vulnerability.severity,
          description: vulnerability.title || vulnerability.url,
          path: vulnerability.path,
          fixAvailable: !!vulnerability.fixAvailable,
        });
      });
    }
    
    result.modules.security = securityMetrics;
    
    // Alert on critical vulnerabilities
    const criticalCount = securityMetrics.vulnerabilities.critical;
    const highCount = securityMetrics.vulnerabilities.high;
    
    if (criticalCount > 0) {
      log.error(`Found ${criticalCount} critical security vulnerabilities!`);
    } else if (highCount > 0) {
      log.warning(`Found ${highCount} high security vulnerabilities`);
    } else {
      log.success('No critical or high security vulnerabilities found');
    }
  } catch (err) {
    log.error(`Error analyzing security vulnerabilities: ${err.message}`);
  }
}

/**
 * Generate final report
 */
function generateReport() {
  log.info('Generating comprehensive code report...');
  
  // Calculate statistics
  result.summary.averageFileSize = Math.round(result.summary.totalSize / result.summary.totalFiles);
  result.summary.averageLines = Math.round(result.summary.totalLines / result.summary.totalFiles);
  
  // Format file types for readability
  result.summary.fileTypeBreakdown = Object.entries(result.summary.fileTypes)
    .map(([ext, count]) => ({ 
      extension: ext, 
      count, 
      percentage: Math.round((count / result.summary.totalFiles) * 100) 
    }))
    .sort((a, b) => b.count - a.count);
  
  // Generate output  
  if (options.outputJson) {
    // Write full JSON report
    fs.writeFileSync(
      path.join(CONFIG.outputDir, 'crawl-report.json'),
      JSON.stringify(result, null, 2)
    );
  }
  
  // Always write the summary report
  const summaryReport = {
    timestamp: result.timestamp,
    summary: result.summary,
    dependencies: result.modules.dependencies,
    quality: result.modules.quality,
    security: result.modules.security,
  };
  
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'crawl-summary.json'),
    JSON.stringify(summaryReport, null, 2)
  );
  
  // Generate human-readable summary
  const markdown = generateMarkdownReport(summaryReport);
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'crawl-summary.md'),
    markdown
  );
  
  log.success(`Reports generated in ${CONFIG.outputDir}`);
}

/**
 * Generate markdown report from results
 */
function generateMarkdownReport(report) {
  return `# Documind Code Analysis Report

Generated on: ${new Date(report.timestamp).toLocaleString()}

## Summary

- **Total Files:** ${report.summary.totalFiles}
- **Total Lines of Code:** ${report.summary.totalLines}
- **Average File Size:** ${report.summary.averageFileSize} bytes
- **Average Lines per File:** ${report.summary.averageLines}

## File Types

${report.summary.fileTypeBreakdown.map(type => 
  `- **${type.extension}:** ${type.count} files (${type.percentage}%)`
).join('\n')}

## Code Quality

- **Total Issues:** ${report.quality?.totalIssues || 'N/A'}
- **Errors:** ${report.quality?.issuesByType?.error || 0}
- **Warnings:** ${report.quality?.issuesByType?.warning || 0}

### Most Common Issues

${(report.quality?.topIssues || []).map(issue => 
  `- **${issue.rule}:** ${issue.count} occurrences`
).join('\n') || 'No issues found.'}

## Dependencies

${report.dependencies?.hasCycles 
  ? `⚠️ **${report.dependencies.circular.length} circular dependencies detected**` 
  : '✅ **No circular dependencies**'}

${report.dependencies?.circular?.length > 0 
  ? '\n### Circular Dependencies\n\n' + report.dependencies.circular.map(cycle => 
    `- ${cycle.join(' → ')}`
  ).join('\n')
  : ''}

## Security Vulnerabilities

${report.security ? `
- **Critical:** ${report.security.vulnerabilities.critical}
- **High:** ${report.security.vulnerabilities.high}
- **Moderate:** ${report.security.vulnerabilities.moderate}
- **Low:** ${report.security.vulnerabilities.low}
` : 'Security scan not performed'}

${report.security?.dependencyIssues?.length > 0 
  ? '\n### Vulnerable Dependencies\n\n' + report.security.dependencyIssues.map(issue => 
    `- **${issue.package}** (${issue.severity.toUpperCase()}): ${issue.description}${issue.fixAvailable ? ' (fix available)' : ''}`
  ).join('\n')
  : ''}

## Complex Files

${report.summary.topComplexFiles?.length > 0
  ? report.summary.topComplexFiles.map(file => 
    `- **${file.path}** (Complexity: ${file.complexity})`
  ).join('\n')
  : 'No highly complex files detected.'}

## Deployment Readiness

${(report.security?.vulnerabilities?.critical > 0 || report.dependencies?.hasCycles || report.quality?.issuesByType?.error > 0)
  ? '⚠️ **Code has critical issues that should be addressed before deployment**'
  : '✅ **Code is ready for deployment**'}
`;
}

/**
 * Main function
 */
async function main() {
  try {
    const startTime = Date.now();
    log.info('Starting advanced code crawler...');
    
    // Create the analysis directory
    if (!fs.existsSync(CONFIG.outputDir)) {
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }
    
    // Analyze files recursively
    log.info(`Scanning files in ${CONFIG.sourceDir}...`);
    result.files = await walkDirectory(CONFIG.sourceDir);
    log.success(`Found and analyzed ${result.files.length} files`);
    
    // Run module-level analysis
    await analyzeModuleDependencies();
    await analyzeCodeQuality();
    await analyzeSecurityVulnerabilities();
    
    // Generate report
    generateReport();
    
    const duration = (Date.now() - startTime) / 1000;
    log.success(`Code crawler finished in ${duration.toFixed(1)}s`);
    
    // Exit with error if critical issues found
    const criticalIssues = 
      (result.summary.issues.errors > 0) ||
      (result.modules.dependencies?.hasCycles) ||
      (result.modules.security?.vulnerabilities.critical > 0);
    
    if (criticalIssues && !options.fixes) {
      log.warning('Critical issues found in codebase. Review report before deployment.');
      if (!options.silent) process.exit(1);
    }
    
  } catch (error) {
    log.error(`Error during code crawling: ${error.message}`);
    if (options.debug) console.error(error);
    process.exit(1);
  }
}

// Execute main function
main();
