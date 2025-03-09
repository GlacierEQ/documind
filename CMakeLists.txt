# Documind CMake Configuration
# Provides advanced build capabilities and code analysis

cmake_minimum_required(VERSION 3.14)
project(documind LANGUAGES CXX)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Options
option(DOCUMIND_ENABLE_TESTING "Enable testing" ON)
option(DOCUMIND_ENABLE_ANALYSIS "Enable code analysis" ON)
option(DOCUMIND_ENABLE_COVERAGE "Enable code coverage" OFF)

# Include directories
set(DOCUMIND_ROOT_DIR ${CMAKE_CURRENT_SOURCE_DIR})
set(DOCUMIND_SOURCE_DIR ${DOCUMIND_ROOT_DIR}/src)
set(DOCUMIND_INCLUDE_DIR ${DOCUMIND_ROOT_DIR}/include)
set(DOCUMIND_TEST_DIR ${DOCUMIND_ROOT_DIR}/tests)

# Detect Ninja build system
if(CMAKE_GENERATOR MATCHES "Ninja")
  message(STATUS "Using Ninja build system")
  set(DOCUMIND_USING_NINJA TRUE)
else()
  set(DOCUMIND_USING_NINJA FALSE)
endif()

# Find required tools
find_program(NODE_EXECUTABLE node)
find_program(NPM_EXECUTABLE npm)
find_program(ESLINT_EXECUTABLE eslint HINTS ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin)
find_program(JEST_EXECUTABLE jest HINTS ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin)
find_program(TSC_EXECUTABLE tsc HINTS ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin)

# Create a target for TypeScript compilation
add_custom_target(typescript-build
  COMMAND ${CMAKE_COMMAND} -E echo "Compiling TypeScript..."
  COMMAND ${TSC_EXECUTABLE}
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  COMMENT "Compiling TypeScript files"
)

# Create a target for linting
add_custom_target(lint
  COMMAND ${CMAKE_COMMAND} -E echo "Linting code..."
  COMMAND ${ESLINT_EXECUTABLE} "${DOCUMIND_SOURCE_DIR}/**/*.{ts,js}"
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  COMMENT "Linting source files"
)

# Create a target for fixing linting issues
add_custom_target(fix-lint
  COMMAND ${CMAKE_COMMAND} -E echo "Fixing linting issues..."
  COMMAND ${ESLINT_EXECUTABLE} --fix "${DOCUMIND_SOURCE_DIR}/**/*.{ts,js}"
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  COMMENT "Fixing linting issues"
)

# Create a target for running tests
add_custom_target(run-tests
  COMMAND ${CMAKE_COMMAND} -E echo "Running tests..."
  COMMAND ${JEST_EXECUTABLE}
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  COMMENT "Running all tests"
)

# Code analysis targets
if(DOCUMIND_ENABLE_ANALYSIS)
  # Basic analysis target
  add_custom_target(analyze
    COMMAND ${CMAKE_COMMAND} -E echo "Running code analysis..."
    COMMAND ${ESLINT_EXECUTABLE} --no-fix "${DOCUMIND_SOURCE_DIR}/**/*.{ts,js}" --format json --output-file ${CMAKE_BINARY_DIR}/eslint-report.json
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Running code analysis"
  )
  
  # Find advanced analysis tools
  find_program(CLOC_EXECUTABLE cloc)
  find_program(SONAR_SCANNER_EXECUTABLE sonar-scanner)
  
  # Deep analysis target
  add_custom_target(deep-analyze
    COMMAND ${CMAKE_COMMAND} -E echo "Running deep code analysis..."
    COMMAND ${CMAKE_COMMAND} -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/deep_analysis.cmake
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Running deep code analysis"
  )
  
  # Auto repair target
  add_custom_target(auto-repair
    COMMAND ${CMAKE_COMMAND} -E echo "Auto-repairing code issues..."
    COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/auto-repair.js
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Auto-repairing code issues"
  )
endif()

# Define all source files (recursive search)
file(GLOB_RECURSE DOCUMIND_TS_SOURCES "${DOCUMIND_SOURCE_DIR}/**/*.ts")
file(GLOB_RECURSE DOCUMIND_JS_SOURCES "${DOCUMIND_SOURCE_DIR}/**/*.js")
file(GLOB_RECURSE DOCUMIND_TEST_SOURCES "${DOCUMIND_TEST_DIR}/**/*.ts" "${DOCUMIND_TEST_DIR}/**/*.js")

# This target crawls the codebase and generates a source index
add_custom_target(crawl-code
  COMMAND ${CMAKE_COMMAND} -E echo "Crawling codebase..."
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/crawl-code.js
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  COMMENT "Crawling codebase and generating source index"
)

# Build everything
add_custom_target(build-all
  DEPENDS typescript-build crawl-code
  COMMAND ${CMAKE_COMMAND} -E echo "Build completed successfully"
)

# Print summary of what was found and configured
message(STATUS "=== Documind Build Configuration ===")
message(STATUS "Node.js: ${NODE_EXECUTABLE}")
message(STATUS "npm: ${NPM_EXECUTABLE}")
message(STATUS "TypeScript sources: ${DOCUMIND_TS_SOURCES}")
message(STATUS "JavaScript sources: ${DOCUMIND_JS_SOURCES}")
message(STATUS "Test sources: ${DOCUMIND_TEST_SOURCES}")

# Include cmake subdirectory with additional configuration
add_subdirectory(cmake)
