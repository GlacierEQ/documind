<#
.SYNOPSIS
    Automated installation script for Documind on Windows
.DESCRIPTION
    This script installs and configures Documind on Windows with minimal user interaction
.PARAMETER InstallPath
    The installation path for Documind
.PARAMETER DatabaseType
    The type of database to use (sqlite, mysql, postgres)
.PARAMETER Port
    The port to run Documind on
.PARAMETER AsService
    Install Documind as a Windows service
#>

param (
    [string]$InstallPath = "$env:ProgramFiles\Documind",
    [ValidateSet("sqlite", "mysql", "postgres")]
    [string]$DatabaseType = "sqlite",
    [int]$Port = 8080,
    [switch]$AsService
)

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "This script must be run as an Administrator. Right-click PowerShell and select 'Run as Administrator'."
    exit 1
}

# Set up logging
$LogFile = "$env:TEMP\documind_install_log.txt"
Start-Transcript -Path $LogFile -Append

Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║             DOCUMIND                  ║" -ForegroundColor Cyan
Write-Host "║  Document Management & Search System  ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting Documind installation..." -ForegroundColor Green

# Create installation directory
Write-Host "Creating installation directory at $InstallPath..." -ForegroundColor Yellow
if (!(Test-Path -Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

# Check for Node.js
Write-Host "Checking for Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "Found Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "Node.js not found. Installing Node.js..." -ForegroundColor Yellow
    
    # Download and install Node.js
    $nodeInstallerPath = "$env:TEMP\node_installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi" -OutFile $nodeInstallerPath
    Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", $nodeInstallerPath, "/quiet", "/norestart" -Wait
    
    # Add to PATH if needed
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    
    # Verify installation
    try {
        $nodeVersion = node --version
        Write-Host "Node.js installed successfully: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Error "Failed to install Node.js. Please install it manually and try again."
        exit 1
    }
}

# Download Documind
Write-Host "Downloading Documind..." -ForegroundColor Yellow
$repoUrl = "https://github.com/yourusername/documind/archive/refs/heads/main.zip"
$zipPath = "$env:TEMP\documind.zip"
Invoke-WebRequest -Uri $repoUrl -OutFile $zipPath

# Extract files
Write-Host "Extracting files..." -ForegroundColor Yellow
Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\documind_extract" -Force
Copy-Item -Path "$env:TEMP\documind_extract\documind-main\*" -Destination $InstallPath -Recurse -Force

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
Set-Location -Path $InstallPath
npm install --production

# Create .env file
Write-Host "Configuring Documind..." -ForegroundColor Yellow
$envTemplate = Get-Content -Path "$InstallPath\.env.template" -Raw
$envContent = $envTemplate

# Update database configuration
$envContent = $envContent -replace "DOCUMIND_DATABASE_DRIVER=sqlite", "DOCUMIND_DATABASE_DRIVER=$DatabaseType"

# Update port
$envContent = $envContent -replace "DOCUMIND_PORT=8080", "DOCUMIND_PORT=$Port"

# Create a random password for WebDAV
$webDavPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
$envContent = $envContent -replace "DOCUMIND_WEBDAV_PASSWORD=your_secure_password", "DOCUMIND_WEBDAV_PASSWORD=$webDavPassword"

# Set storage path
$storagePath = "$InstallPath\storage"
$envContent = $envContent -replace "/var/documind/storage", $storagePath.Replace("\", "/")

# Write the .env file
Set-Content -Path "$InstallPath\.env" -Value $envContent

# Build the application
Write-Host "Building the application..." -ForegroundColor Yellow
npm run build

# Create storage directories
Write-Host "Creating storage directories..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path "$storagePath\uploads" -Force | Out-Null
New-Item -ItemType Directory -Path "$storagePath\thumbnails" -Force | Out-Null
New-Item -ItemType Directory -Path "$storagePath\indexes" -Force | Out-Null

# Create desktop shortcut
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:PUBLIC\Desktop\Documind.lnk")
$Shortcut.TargetPath = "http://localhost:$Port"
$Shortcut.Save()

# Install as service if requested
if ($AsService) {
    Write-Host "Installing Documind as a Windows Service..." -ForegroundColor Yellow
    
    # Install node-windows
    npm install --save-dev node-windows
    
    # Create service script
    $serviceScript = @"
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'Documind',
  description: 'Document Management System',
  script: path.join('$($InstallPath.Replace("\", "\\"))', 'dist', 'index.js'),
  nodeOptions: [],
  env: {
    name: "NODE_ENV",
    value: "production"
  }
});

svc.on('install', function() {
  svc.start();
  console.log('Service installed and started successfully');
});

svc.on('error', function(error) {
  console.error('Service error:', error);
});

svc.install();
"@
    
    Set-Content -Path "$InstallPath\install-service.js" -Value $serviceScript
    
    # Run the service installation
    node "$InstallPath\install-service.js"
    
    Write-Host "Documind service installed and started" -ForegroundColor Green
} else {
    # Start the application
    Write-Host "Starting Documind..." -ForegroundColor Yellow
    Start-Process -FilePath "node" -ArgumentList "$InstallPath\dist\index.js"
}

# Create protocol handler for PDFelement integration
Write-Host "Setting up protocol handlers for external editor integration..." -ForegroundColor Yellow

$regContent = @"
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\documind]
@="Documind Protocol"
"URL Protocol"=""

[HKEY_CLASSES_ROOT\documind\shell]

[HKEY_CLASSES_ROOT\documind\shell\open]

[HKEY_CLASSES_ROOT\documind\shell\open\command]
@="cmd.exe /c start http://localhost:$Port/api/documents/%1/view"
"@

$regFilePath = "$env:TEMP\documind_protocol.reg"
Set-Content -Path $regFilePath -Value $regContent
Start-Process -FilePath "regedit.exe" -ArgumentList "/s", $regFilePath -Wait

Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║        INSTALLATION COMPLETE          ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Green
Write-Host "Documind has been installed to: $InstallPath" -ForegroundColor Yellow
Write-Host "Access at: http://localhost:$Port" -ForegroundColor Yellow
Write-Host "Default login: admin / admin123" -ForegroundColor Yellow
Write-Host "IMPORTANT: Change the default password immediately after login!" -ForegroundColor Red
Write-Host "Installation log saved to: $LogFile" -ForegroundColor Yellow

Stop-Transcript
