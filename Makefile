# Advanced Makefile for Documind
# Handles build, test, clean, and maintenance operations

# Configuration
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.ONESHELL:
MAKEFLAGS += --warn-undefined-variables --no-builtin-rules

# Directories
BUILD_DIR := build
DIST_DIR := dist
LOG_DIR := logs
SOURCE_DIR := src
TEST_DIR := tests
DOCKER_DIR := docker
ANALYSIS_DIR := $(BUILD_DIR)/analysis
REPAIR_DIR := $(BUILD_DIR)/repair

# Commands
DOCKER_COMPOSE := docker-compose
NODE := node
NPM := npm
CMAKE := cmake
NINJA := ninja
ESLINT := ./node_modules/.bin/eslint
JEST := ./node_modules/.bin/jest
TS_NODE := ./node_modules/.bin/ts-node
TSC := ./node_modules/.bin/tsc

# Colors
COLOR_RESET := \033[0m
COLOR_GREEN := \033[1;32m
COLOR_YELLOW := \033[1;33m
COLOR_CYAN := \033[1;36m
COLOR_RED := \033[1;31m
COLOR_BLUE := \033[1;34m

# Recursive search for source files
TS_FILES := $(shell find $(SOURCE_DIR) -name "*.ts" 2>/dev/null)
JS_FILES := $(shell find $(SOURCE_DIR) -name "*.js" 2>/dev/null)
TEST_FILES := $(shell find $(TEST_DIR) -name "*.ts" -o -name "*.js" 2>/dev/null)
ALL_CODE_FILES := $(TS_FILES) $(JS_FILES) $(TEST_FILES)

# Default target
.PHONY: all
all: help

# Show help
.PHONY: help
help:
	@echo -e "${COLOR_CYAN}Documind Advanced Build System${COLOR_RESET}"
	@echo -e "${COLOR_YELLOW}Available commands:${COLOR_RESET}"
	@echo -e "  ${COLOR_GREEN}make build${COLOR_RESET}        - Build the application"
	@echo -e "  ${COLOR_GREEN}make rebuild${COLOR_RESET}      - Clean and rebuild from scratch"
	@echo -e "  ${COLOR_GREEN}make clean${COLOR_RESET}        - Remove build artifacts"
	@echo -e "  ${COLOR_GREEN}make deep-clean${COLOR_RESET}   - Remove all generated files (build, node_modules, etc.)"
	@echo -e "  ${COLOR_GREEN}make test${COLOR_RESET}         - Run all tests"
	@echo -e "  ${COLOR_GREEN}make lint${COLOR_RESET}         - Run code linting"
	@echo -e "  ${COLOR_GREEN}make fix${COLOR_RESET}          - Automatically fix linting issues"
	@echo -e "  ${COLOR_GREEN}make analyze${COLOR_RESET}      - Run static code analysis"
	@echo -e "  ${COLOR_GREEN}make docker-build${COLOR_RESET} - Build Docker images"
	@echo -e "  ${COLOR_GREEN}make docker-up${COLOR_RESET}    - Start Docker containers"
	@echo -e "  ${COLOR_GREEN}make docker-down${COLOR_RESET}  - Stop Docker containers"
	@echo -e "  ${COLOR_GREEN}make deploy${COLOR_RESET}       - Deploy to production (requires configuration)"
	@echo -e ""
	@echo -e "${COLOR_YELLOW}Advanced commands:${COLOR_RESET}"
	@echo -e "  ${COLOR_GREEN}make cmake${COLOR_RESET}        - Generate build files using CMake"
	@echo -e "  ${COLOR_GREEN}make ninja${COLOR_RESET}        - Build using Ninja build system"
	@echo -e "  ${COLOR_GREEN}make analyze-deep${COLOR_RESET} - Run deep code analysis"
	@echo -e "  ${COLOR_GREEN}make repair${COLOR_RESET}       - Attempt to automatically fix code issues"
	@echo -e "  ${COLOR_GREEN}make debug${COLOR_RESET}        - Start the application in debug mode"
	@echo -e "  ${COLOR_GREEN}make scan-security${COLOR_RESET} - Run security vulnerability scan"
	@echo -e "  ${COLOR_GREEN}make scan-quality${COLOR_RESET} - Run code quality assessment"
	@echo -e "  ${COLOR_GREEN}make crawl${COLOR_RESET}        - Recursively crawl and analyze codebase"
	@echo -e "  ${COLOR_GREEN}make report${COLOR_RESET}       - Generate comprehensive code report"
	@echo -e "  ${COLOR_GREEN}make monitor${COLOR_RESET}      - Start code monitoring system"

# Install dependencies
.PHONY: install
install:
	@echo -e "${COLOR_CYAN}Installing dependencies...${COLOR_RESET}"
	@$(NPM) install
	@echo -e "${COLOR_GREEN}Dependencies installed successfully!${COLOR_RESET}"

# Build the application
.PHONY: build
build:
	@echo -e "${COLOR_CYAN}Building application...${COLOR_RESET}"
	@mkdir -p $(DIST_DIR)
	@$(TSC)
	@echo -e "${COLOR_GREEN}Build completed successfully!${COLOR_RESET}"

# Clean and rebuild
.PHONY: rebuild
rebuild: clean build

# Clean build artifacts
.PHONY: clean
clean:
	@echo -e "${COLOR_CYAN}Cleaning build artifacts...${COLOR_RESET}"
	@rm -rf $(DIST_DIR)
	@rm -rf $(BUILD_DIR)
	@echo -e "${COLOR_GREEN}Clean completed successfully!${COLOR_RESET}"

# Deep clean (remove all generated files)
.PHONY: deep-clean
deep-clean: clean
	@echo -e "${COLOR_CYAN}Deep cleaning project...${COLOR_RESET}"
	@rm -rf node_modules
	@rm -rf $(LOG_DIR)/*.log
	@rm -rf coverage
	@rm -rf .nyc_output
	@rm -rf .env.local
	@echo -e "${COLOR_GREEN}Deep clean completed successfully!${COLOR_RESET}"

# Run all tests
.PHONY: test
test:
	@echo -e "${COLOR_CYAN}Running tests...${COLOR_RESET}"
	@$(JEST)
	@echo -e "${COLOR_GREEN}Tests completed successfully!${COLOR_RESET}"

# Run linting
.PHONY: lint
lint:
	@echo -e "${COLOR_CYAN}Running linting...${COLOR_RESET}"
	@$(ESLINT) "$(SOURCE_DIR)/**/*.{ts,js}"
	@echo -e "${COLOR_GREEN}Linting completed successfully!${COLOR_RESET}"

# Fix linting issues
.PHONY: fix
fix:
	@echo -e "${COLOR_CYAN}Fixing linting issues...${COLOR_RESET}"
	@$(ESLINT) --fix "$(SOURCE_DIR)/**/*.{ts,js}"
	@echo -e "${COLOR_GREEN}Linting fixes applied successfully!${COLOR_RESET}"

# Generate CMake build files
.PHONY: cmake
cmake:
	@echo -e "${COLOR_CYAN}Generating build files with CMake...${COLOR_RESET}"
	@mkdir -p $(BUILD_DIR)
	@cd $(BUILD_DIR) && $(CMAKE) -G Ninja ..
	@echo -e "${COLOR_GREEN}CMake generation completed successfully!${COLOR_RESET}"

# Build with Ninja
.PHONY: ninja
ninja: cmake
	@echo -e "${COLOR_CYAN}Building with Ninja...${COLOR_RESET}"
	@cd $(BUILD_DIR) && $(NINJA)
	@echo -e "${COLOR_GREEN}Ninja build completed successfully!${COLOR_RESET}"

# Run static code analysis
.PHONY: analyze
analyze: cmake
	@echo -e "${COLOR_CYAN}Running code analysis...${COLOR_RESET}"
	@mkdir -p $(ANALYSIS_DIR)
	@cd $(BUILD_DIR) && $(CMAKE) --build . --target analyze
	@echo -e "${GREEN}Analysis report generated at ${BUILD_DIR}/analysis${NC}"
	@echo -e "${COLOR_GREEN}Code analysis completed!${COLOR_RESET}"

# Deep code analysis using CMake
.PHONY: analyze-deep
analyze-deep: cmake
	@echo -e "${COLOR_CYAN}Running deep code analysis...${COLOR_RESET}"
	@mkdir -p $(ANALYSIS_DIR)
	@cd $(BUILD_DIR) && $(CMAKE) --build . --target deep-analyze
	@echo -e "${COLOR_GREEN}Deep code analysis completed!${COLOR_RESET}"

# Crawl codebase recursively
.PHONY: crawl
crawl:
	@echo -e "${COLOR_CYAN}Crawling codebase recursively...${COLOR_RESET}"
	@mkdir -p $(ANALYSIS_DIR)
	@$(NODE) scripts/code-crawler.js --detailed --recursive
	@echo -e "${COLOR_GREEN}Code crawling completed!${COLOR_RESET}"

# Repair code issues automatically
.PHONY: repair
repair: fix
	@echo -e "${COLOR_CYAN}Repairing code issues...${COLOR_RESET}"
	@mkdir -p $(REPAIR_DIR)
	@$(NODE) scripts/code-repair.js --auto
	@cd $(BUILD_DIR) && $(CMAKE) --build . --target auto-repair
	@echo -e "${COLOR_GREEN}Code repair completed!${COLOR_RESET}"

# Run security vulnerability scan
.PHONY: scan-security
scan-security:
	@echo -e "${COLOR_CYAN}Running security vulnerability scan...${COLOR_RESET}"
	@mkdir -p $(ANALYSIS_DIR)/security
	@$(NPM) audit --json > $(ANALYSIS_DIR)/security/npm-audit.json || true
	@$(NODE) scripts/security-scan.js --output=$(ANALYSIS_DIR)/security
	@echo -e "${COLOR_GREEN}Security scan completed!${COLOR_RESET}"

# Run code quality assessment
.PHONY: scan-quality
scan-quality:
	@echo -e "${COLOR_CYAN}Running code quality assessment...${COLOR_RESET}"
	@mkdir -p $(ANALYSIS_DIR)/quality
	@$(NODE) scripts/quality-scan.js --output=$(ANALYSIS_DIR)/quality
	@echo -e "${COLOR_GREEN}Code quality assessment completed!${COLOR_RESET}"

# Generate comprehensive report
.PHONY: report
report: analyze scan-security scan-quality
	@echo -e "${COLOR_CYAN}Generating comprehensive code report...${COLOR_RESET}"
	@$(NODE) scripts/generate-report.js --output=$(ANALYSIS_DIR)/full-report
	@echo -e "${COLOR_GREEN}Report generated at $(ANALYSIS_DIR)/full-report/${COLOR_RESET}"

# Start code monitoring system
.PHONY: monitor
monitor:
	@echo -e "${COLOR_CYAN}Starting code monitoring system...${COLOR_RESET}"
	@$(NODE) scripts/code-monitor.js
	@echo -e "${COLOR_GREEN}Code monitoring system started!${COLOR_RESET}"

# Debug with special flags
.PHONY: debug
debug: build
	@echo -e "${COLOR_CYAN}Starting in debug mode with enhanced diagnostics...${COLOR_RESET}"
	@NODE_OPTIONS="--inspect --trace-warnings" NODE_ENV=development DEBUG=documind:* $(NODE) $(DIST_DIR)/index.js

# Docker targets
.PHONY: docker-build docker-up docker-down deploy
docker-build:
	@echo -e "${COLOR_CYAN}Building Docker images...${COLOR_RESET}"
	@$(DOCKER_COMPOSE) build
	@echo -e "${COLOR_GREEN}Docker build completed successfully!${COLOR_RESET}"

docker-up:
	@echo -e "${COLOR_CYAN}Starting Docker containers...${COLOR_RESET}"
	@$(DOCKER_COMPOSE) up -d
	@echo -e "${COLOR_GREEN}Docker containers started successfully!${COLOR_RESET}"

docker-down:
	@echo -e "${COLOR_CYAN}Stopping Docker containers...${COLOR_RESET}"
	@$(DOCKER_COMPOSE) down
	@echo -e "${COLOR_GREEN}Docker containers stopped successfully!${COLOR_RESET}"

deploy:
	@echo -e "${COLOR_CYAN}Deploying to production...${COLOR_RESET}"
	@bash scripts/ninja-deploy.sh --env=production --tag=latest
	@echo -e "${COLOR_GREEN}Deployment completed successfully!${COLOR_RESET}"

# Docker Ninja Team Targets
.PHONY: build-ninja-docker run-ninja-docker push-ninja-docker docker-deploy docker-scan docker-monitor docker-setup

build-ninja-docker:
	@echo "Building Ninja Team Docker image..."
	@bash scripts/build-ninja-docker.sh --tag=latest

run-ninja-docker:
	@echo "Running Ninja Team Docker container..."
	@bash scripts/run-ninja-container.sh $(ARGS)

push-ninja-docker:
	@echo "Pushing Ninja Team Docker image..."
	@bash scripts/build-ninja-docker.sh --tag=latest --push --registry=$(REGISTRY)

docker-deploy:
	@echo "Deploying with Ninja Team Docker container..."
	@bash scripts/run-ninja-container.sh deploy $(ENV) $(TAG) $(MODE)

docker-scan:
	@echo "Running security scan with Ninja Team Docker container..."
	@bash scripts/run-ninja-container.sh scan $(ENV)

docker-monitor:
	@echo "Monitoring deployment with Ninja Team Docker container..."
	@bash scripts/run-ninja-container.sh monitor $(ENV) $(DURATION)

docker-setup:
	@echo "Setting up Ninja Team with Docker container..."
	@bash scripts/run-ninja-container.sh setup $(ENV)
