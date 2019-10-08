cmake_minimum_required(VERSION 3.14)
project (command-not-found)

add_executable(command-not-found command-not-found.cpp)
target_compile_options(command-not-found PRIVATE  -Wall -Wextra -Werror -pedantic)

install(TARGETS command-not-found DESTINATION libexec/termux)
