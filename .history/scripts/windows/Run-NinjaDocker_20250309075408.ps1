<#
.SYNOPSIS
    Run Ninja Team Docker container on Windows
.DESCRIPTION
    PowerShell script to run the Ninja Team deployment system in a Docker container on Windows
#>

param(
    [string]$Command = "deploy",
    [string]$Environment = "production",
    [string]$Tag = "latest",
    [string]$Mode = "compose",
    [switch]$Interactive,
    [switch]$Help
)

# Banner
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║            NINJA TEAM CONTAINER RUNNER (Windows)               ║" -ForegroundColor Blue
Write-Host "║            Run Containerized Deployment System                 ║" -ForegroundColor Blue
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Blue

# Show help if requested
if ($Help) {
    Write-Host "Usage: .\Run-NinjaDocker.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Parameters:"
    Write-Host "  -Command <cmd>      Command to run (deploy, monitor, scan, setup, shell)"
    Write-Host "  -Environment <env>  Target environment (default: production)"
    Write-Host "  -Tag <tag>          Docker image tag (default: latest)"
    Write-Host "  -Mode <mode>        Deployment mode (default: compose)"
    Write-Host "  -Interactive        Run in interactive mode"
    Write-Host "  -Help               Show this help message"
    exit 0
}

# Check if Docker is installed
try {
    $null = docker --version
} catch {
    Write-Host "Error: Docker is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

# Get repository root directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# Determine Docker run options
$DockerOpts = "-v /var/run/docker.sock:/var/run/docker.sock"
$DockerOpts += " -v ${RepoRoot}/deploy:/app/deploy:rw"
$DockerOpts += " -v ${RepoRoot}/logs:/app/logs:rw"
$DockerOpts += " -v ${RepoRoot}/backups:/app/backups:rw"
$DockerOpts += " -e NINJA_ENV=$Environment"

# Add interactive flag if requested
if ($Interactive) {
    $DockerOpts += " -it"
} else {
    $DockerOpts += " --rm"
}

# Construct command
$FullCommand = "$Command"
if ($Command -eq "deploy") {
    $FullCommand += " $Environment $Tag $Mode"
} elseif ($Command -eq "monitor") {
    $FullCommand += " $Environment"
} elseif ($Command -eq "scan") {
    $FullCommand += " $Environment"
} elseif ($Command -eq "setup") {
    $FullCommand += " $Environment"
}

Write-Host "Running Ninja Team container with command: $FullCommand" -ForegroundColor Yellow

# Run docker
$DockerCmd = "docker run $DockerOpts ninja-team:latest $FullCommand"
Write-Host "Executing: $DockerCmd" -ForegroundColor Cyan
Invoke-Expression $DockerCmd
