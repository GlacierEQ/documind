#!/bin/bash

# Pre-commit hook to run linters and formatters only on staged files
# This script is called by husky pre-commit hook

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running pre-commit checks...${NC}"

# Get all staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.ts$|\.js$|\.tsx$|\.jsx$')

# Exit if no TS/JS files are staged
if [ -z "$STAGED_FILES" ]; then
  echo -e "${GREEN}No TS/JS files to check${NC}"
  exit 0
fi

# Check for lint errors
echo -e "${YELLOW}Checking for lint errors...${NC}"
npx eslint $STAGED_FILES --quiet
if [ $? -ne 0 ]; then
  echo -e "${RED}ESLint failed! Fix the errors before committing.${NC}"
  exit 1
fi

# Format the code
echo -e "${YELLOW}Formatting code...${NC}"
npx prettier --write $STAGED_FILES
if [ $? -ne 0 ]; then
  echo -e "${RED}Prettier failed! Check the errors above.${NC}"
  exit 1
fi

# Add formatted files back to staging
echo -e "${YELLOW}Adding formatted files back to staging...${NC}"
git add $STAGED_FILES

echo -e "${GREEN}Pre-commit checks passed!${NC}"
exit 0
