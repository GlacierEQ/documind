# Ninja Team CMake Integration
# Adds Ninja Team deployment capabilities to CMake
# Include this file in your main CMakeLists.txt with include(ninja-team.cmake)

cmake_minimum_required(VERSION 3.14)

# Define Ninja Team script paths
set(NINJA_TEAM_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/scripts")
set(NINJA_TEAM_ORCHESTRATOR "${NINJA_TEAM_ROOT}/ninja-team-orchestrator.sh")
set(NINJA_TEAM_DIR "${NINJA_TEAM_ROOT}/ninja-team")

# Environment options
option(DEPLOY_ENV "Deployment environment (production, staging, development)" "staging")
option(DEPLOY_TAG "Deployment tag" "latest")
option(DEPLOY_MODE "Deployment mode (swarm, compose, k8s)" "auto")
option(DEPLOY_RECURSIVE "Recursive deployment depth" 2)
option(DEPLOY_PARALLEL "Parallel deployment jobs" 2)

# Ensure scripts are executable
if(UNIX)
  find_program(CHMOD_EXEC chmod)
  if(CHMOD_EXEC)
    execute_process(
      COMMAND ${CHMOD_EXEC} +x ${NINJA_TEAM_ORCHESTRATOR}
      COMMAND ${CHMOD_EXEC} +x ${NINJA_TEAM_ROOT}/deploy-ninja-team.sh
      COMMAND ${CHMOD_EXEC} +x ${NINJA_TEAM_ROOT}/ninja-scan.sh
      COMMAND ${CHMOD_EXEC} +x ${NINJA_TEAM_ROOT}/monitor-deployment.sh
    )
    
    # Make individual ninja scripts executable
    file(GLOB NINJA_SCRIPTS "${NINJA_TEAM_DIR}/*.sh")
    foreach(script ${NINJA_SCRIPTS})
      execute_process(COMMAND ${CHMOD_EXEC} +x ${script})
    endforeach()
  endif()
endif()

# Function to add deployment targets for a specific environment
function(add_ninja_deployment ENV)
  # Basic deployment target
  add_custom_target(deploy-${ENV}
    COMMENT "Deploying to ${ENV} environment"
    COMMAND ${NINJA_TEAM_ROOT}/deploy-ninja-team.sh --env=${ENV} --tag=${DEPLOY_TAG}
  )
  
  # Zero-downtime deployment target
  add_custom_target(zero-deploy-${ENV}
    COMMENT "Zero-downtime deployment to ${ENV} environment"
    COMMAND ${NINJA_TEAM_ROOT}/deploy-ninja-team.sh --env=${ENV} --tag=${DEPLOY_TAG} --mode=${DEPLOY_MODE}
  )
  
  # Rollback target
  add_custom_target(rollback-${ENV}
    COMMENT "Rolling back ${ENV} environment"
    COMMAND ${NINJA_TEAM_ROOT}/ninja-team/ninja-guardian.sh --rollback --env=${ENV}
  )
  
  # Security scan target
  add_custom_target(security-scan-${ENV}
    COMMENT "Security scanning ${ENV} environment"
    COMMAND ${NINJA_TEAM_ROOT}/ninja-scan.sh --env=${ENV}
  )
  
  # Deep security scan target
  add_custom_target(security-scan-deep-${ENV}
    COMMENT "Deep security scanning ${ENV} environment"
    COMMAND ${NINJA_TEAM_ROOT}/ninja-scan.sh --env=${ENV} --deep
  )
  
  # Monitoring target
  add_custom_target(monitor-${ENV}
    COMMENT "Monitoring ${ENV} environment"
    COMMAND ${NINJA_TEAM_ROOT}/monitor-deployment.sh --env=${ENV} --duration=600
  )
  
  # Add complete pipeline target (build, test, scan, deploy, monitor)
  add_custom_target(pipeline-${ENV}
    COMMENT "Running full deployment pipeline to ${ENV}"
    COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --target build
    COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --target test
    COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --target security-scan-${ENV}
    COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --target zero-deploy-${ENV}
    COMMAND ${CMAKE_COMMAND} --build ${CMAKE_BINARY_DIR} --target monitor-${ENV}
  )
endfunction()

# Add deployment targets for standard environments
add_ninja_deployment(production)
add_ninja_deployment(staging)
add_ninja_deployment(development)

# Print configuration info
message(STATUS "Ninja Team Deployment configured:")
message(STATUS "  Default environment: ${DEPLOY_ENV}")
message(STATUS "  Default tag: ${DEPLOY_TAG}")
message(STATUS "  Deployment mode: ${DEPLOY_MODE}")
message(STATUS "  Recursive depth: ${DEPLOY_RECURSIVE}")
message(STATUS "  Parallel jobs: ${DEPLOY_PARALLEL}")
