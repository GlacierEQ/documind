# Deep analysis module for Documind
# Performs comprehensive code analysis and diagnostics

# Enable CTest for test tracking
enable_testing()

# Find required tools
find_program(CLOC_EXECUTABLE cloc)
find_program(NPX_EXECUTABLE npx)
find_program(NODE_EXECUTABLE node)
find_program(GREP_EXECUTABLE grep)
find_program(FIND_EXECUTABLE find)

# Define analysis output directory
set(ANALYSIS_OUTPUT_DIR "${CMAKE_BINARY_DIR}/analysis")
file(MAKE_DIRECTORY ${ANALYSIS_OUTPUT_DIR})

# Code metrics analysis
if(CLOC_EXECUTABLE)
  execute_process(
    COMMAND ${CLOC_EXECUTABLE} --by-file --report-file=${ANALYSIS_OUTPUT_DIR}/cloc-report.txt --exclude-dir=node_modules,dist,build,coverage .
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    RESULT_VARIABLE CLOC_RESULT
  )
  
  if(CLOC_RESULT EQUAL 0)
    message(STATUS "Code metrics analysis completed: ${ANALYSIS_OUTPUT_DIR}/cloc-report.txt")
  else()
    message(WARNING "Code metrics analysis failed with exit code ${CLOC_RESULT}")
  endif()
else()
  message(STATUS "CLOC not found, skipping code metrics analysis")
endif()

# Run TypeScript compiler in strict mode for enhanced analysis
if(NPX_EXECUTABLE)
  execute_process(
    COMMAND ${NPX_EXECUTABLE} tsc --noEmit --strict --project tsconfig.json
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    RESULT_VARIABLE TSC_RESULT
    OUTPUT_FILE ${ANALYSIS_OUTPUT_DIR}/tsc-analysis.log
    ERROR_FILE ${ANALYSIS_OUTPUT_DIR}/tsc-errors.log
  )
  
  if(TSC_RESULT EQUAL 0)
    message(STATUS "TypeScript analysis completed successfully")
  else()
    message(WARNING "TypeScript analysis found issues, see ${ANALYSIS_OUTPUT_DIR}/tsc-errors.log")
  endif()
else()
  message(STATUS "NPX not found, skipping TypeScript analysis")
endif()

# Run ESLint for detailed code quality analysis
execute_process(
  COMMAND ${NPX_EXECUTABLE} eslint --ext .ts,.js src/ --format json
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  RESULT_VARIABLE ESLINT_RESULT
  OUTPUT_FILE ${ANALYSIS_OUTPUT_DIR}/eslint-report.json
  ERROR_FILE ${ANALYSIS_OUTPUT_DIR}/eslint-errors.log
)

if(ESLINT_RESULT EQUAL 0)
  message(STATUS "ESLint analysis completed: ${ANALYSIS_OUTPUT_DIR}/eslint-report.json")
else()
  message(WARNING "ESLint analysis found issues")
endif()

# Dependency analysis
execute_process(
  COMMAND ${NPX_EXECUTABLE} madge --circular --extensions ts,js src/
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  RESULT_VARIABLE MADGE_RESULT
  OUTPUT_FILE ${ANALYSIS_OUTPUT_DIR}/circular-deps.txt
  ERROR_FILE ${ANALYSIS_OUTPUT_DIR}/madge-errors.log
)

if(MADGE_RESULT EQUAL 0)
  message(STATUS "Dependency analysis completed: ${ANALYSIS_OUTPUT_DIR}/circular-deps.txt")
else()
  message(WARNING "Dependency analysis found issues")
endif()

# Generate dependency graph visualization
execute_process(
  COMMAND ${NPX_EXECUTABLE} madge --image ${ANALYSIS_OUTPUT_DIR}/dependency-graph.svg --extensions ts,js src/
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
)

# Check for common security patterns
execute_process(
  COMMAND ${NPX_EXECUTABLE} auditjs ossi
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  RESULT_VARIABLE AUDIT_RESULT
  OUTPUT_FILE ${ANALYSIS_OUTPUT_DIR}/security-audit.txt
  ERROR_FILE ${ANALYSIS_OUTPUT_DIR}/audit-errors.log
)

if(AUDIT_RESULT EQUAL 0)
  message(STATUS "Security audit completed: ${ANALYSIS_OUTPUT_DIR}/security-audit.txt")
else()
  message(WARNING "Security audit found issues")
endif()

# Create a merged analysis report
file(WRITE ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt "# Documind Codebase Analysis Summary\n\n")
file(APPEND ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt "Analysis performed: ${CMAKE_CURRENT_TIME}\n\n")

# Include code metrics in summary
if(EXISTS "${ANALYSIS_OUTPUT_DIR}/cloc-report.txt")
  file(READ "${ANALYSIS_OUTPUT_DIR}/cloc-report.txt" CLOC_CONTENT)
  file(APPEND ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt "## Code Metrics\n\n")
  file(APPEND ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt "${CLOC_CONTENT}\n\n")
endif()

# Include circular dependencies in summary
if(EXISTS "${ANALYSIS_OUTPUT_DIR}/circular-deps.txt")
  file(READ "${ANALYSIS_OUTPUT_DIR}/circular-deps.txt" CIRCULAR_CONTENT)
  file(APPEND ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt "## Circular Dependencies\n\n")
  file(APPEND ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt "${CIRCULAR_CONTENT}\n\n")
endif()

# Final status message
message(STATUS "Analysis completed: ${ANALYSIS_OUTPUT_DIR}/analysis-summary.txt")
