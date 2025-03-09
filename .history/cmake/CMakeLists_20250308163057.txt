# Sub-CMakeLists for Documind

# Include cmake modules
include(CodeAnalysis)
include(BuildConfig)

# Define code crawling target
add_custom_target(code-crawler ALL
  COMMAND ${CMAKE_COMMAND} -E echo "Running code crawler..."
  COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/../scripts/crawl-code.js
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/..
  COMMENT "Crawling codebase for analysis"
)

# Add a target for generating tag files (for code navigation)
add_custom_target(generate-tags
  COMMAND ${CMAKE_COMMAND} -E echo "Generating tags file..."
  COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-tags.sh
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/..
  COMMENT "Generating tags file for code navigation"
)
