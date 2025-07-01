cmake_minimum_required(VERSION 3.25)
project (command-not-found)

set(CMAKE_CXX_STANDARD 20)

set(COMMAND_NOT_FOUND_VERSION "3.1")

add_custom_target(generate-db COMMAND ./generate-db.js WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
add_executable(command-not-found command-not-found.cpp)
add_dependencies(command-not-found generate-db)
target_compile_options(command-not-found PRIVATE  -Wall -Wextra -Werror -pedantic)
target_compile_definitions(command-not-found PRIVATE COMMAND_NOT_FOUND_VERSION="${COMMAND_NOT_FOUND_VERSION}")

install(TARGETS command-not-found DESTINATION libexec/termux)
