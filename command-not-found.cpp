/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include <cstring>
#include <filesystem>
#include <iostream>
#include <list>
#include <map>
#include <string>
#include <string_view>
#include <sys/cdefs.h>

#ifndef __TERMUX_PREFIX__
#error "__TERMUX_PREFIX__ not defined"
#endif

const std::list<std::string_view> main_commands = {
#ifdef __aarch64__
#include "commands-aarch64-termux-main.h"
#elif defined __arm__
#include "commands-arm-termux-main.h"
#elif defined __i686__
#include "commands-i686-termux-main.h"
#elif defined __x86_64__
#include "commands-x86_64-termux-main.h"
#else
#error Failed to detect arch
#endif
};

const std::list<std::string_view> root_commands = {
#ifdef __aarch64__
#include "commands-aarch64-termux-root.h"
#elif defined __arm__
#include "commands-arm-termux-root.h"
#elif defined __i686__
#include "commands-i686-termux-root.h"
#elif defined __x86_64__
#include "commands-x86_64-termux-root.h"
#else
#error Failed to detect arch
#endif
};

const std::list<std::string_view> x11_commands = {
#ifdef __aarch64__
#include "commands-aarch64-termux-x11.h"
#elif defined __arm__
#include "commands-arm-termux-x11.h"
#elif defined __i686__
#include "commands-i686-termux-x11.h"
#elif defined __x86_64__
#include "commands-x86_64-termux-x11.h"
#else
#error Failed to detect arch
#endif
};

struct info {
  std::string binary, repository;
};

inline int termux_min3(int a, int b, int c) {
  return (a < b ? (a < c ? a : c) : (b < c ? b : c));
}

int termux_levenshtein_distance(char const *s1, char const *s2) {
  int s1len = strlen(s1);
  int s2len = strlen(s2);
  int x, y;
  int **matrix;
  int distance;
  matrix = (int **)malloc(sizeof *matrix * (s2len + 1));

  if (!matrix) {
    std::cerr << "Memory allocation seem to have failed" << std::endl;
    return -2;
  }

  matrix[0] = (int *)malloc(sizeof *matrix[0] * (s1len + 1));

  if (!matrix[0]) {
    std::cerr << "Memory allocation seem to have failed" << std::endl;
    return -3;
  }

  matrix[0][0] = 0;
  for (x = 1; x <= s2len; x++) {
    matrix[x] = (int *)malloc(sizeof *matrix[x] * (s1len + 1));

    if (!matrix[x]) {
      std::cerr << "Memory allocation seem to have failed" << std::endl;
      return -4;
    }

    matrix[x][0] = matrix[x - 1][0] + 1;
  }
  for (y = 1; y <= s1len; y++) {
    matrix[0][y] = matrix[0][y - 1] + 1;
  }
  for (x = 1; x <= s2len; x++) {
    for (y = 1; y <= s1len; y++) {
      matrix[x][y] =
          termux_min3(matrix[x - 1][y] + 1, matrix[x][y - 1] + 1,
                      matrix[x - 1][y - 1] + (s1[y - 1] == s2[x - 1] ? 0 : 1));
    }
  }
  distance = matrix[s2len][s1len];

  for (x = 0; x <= s2len; x++) {
    free(matrix[x]);
  }
  free(matrix);

  return distance;
}

int termux_look_for_packages(const char *command_not_found,
                             const std::list<std::string_view> &cmds,
                             int *best_distance,
                             std::map<std::string, info> &pkg_map,
                             const char repository[]) {
  std::string current_package;
  std::string current_binary;
  int distance;
  for (auto it = cmds.begin(); it != cmds.end(); ++it) {
    std::string_view current_line = *it;
    if (current_line[0] != ' ') {
      current_package = current_line;
    } else {
      current_binary = current_line.substr(1);
      distance = termux_levenshtein_distance(command_not_found,
                                             current_binary.c_str());
      if (distance < -1) {
        // malloc failed, return the error code
        return -distance;
      } else if (*best_distance == distance) {
        // As good as our previously best match
        pkg_map.insert(std::pair<std::string, info>(
            current_package, {current_binary, repository}));
      } else if (*best_distance == -1 || distance < *best_distance) {
        // New best match
        pkg_map.clear();
        *best_distance = distance;
        pkg_map.insert(std::pair<std::string, info>(
            current_package, {current_binary, repository}));
      }
    }
  }
  return 0;
}

int main(int argc, const char *argv[]) {
  if (argc != 2) {
    std::cerr << "usage: command-not-found <command>" << std::endl;
    return 1;
  }

  const char *command = argv[1];
  int best_distance = -1;
  std::map<std::string, info> package_map;
  std::map<std::string, info>::iterator it;
  int res;
  std::string_view sources_prefix =
      __TERMUX_PREFIX__ "/etc/apt/sources.list.d/";

  res = termux_look_for_packages(command, main_commands, &best_distance,
                                 package_map, "");
  if (res != 0) {
    return res;
  }

  res = termux_look_for_packages(command, root_commands, &best_distance,
                                 package_map, "root");
  if (res != 0) {
    return res;
  }

  res = termux_look_for_packages(command, x11_commands, &best_distance,
                                 package_map, "x11");
  if (res != 0) {
    return res;
  }

  if (best_distance == -1 || best_distance > 3) {
    std::cerr << command << ": command not found" << std::endl;
  } else if (best_distance == 0) {
    std::cerr << "The program " << command
              << " is not installed. Install it by executing:" << std::endl;
    for (it = package_map.begin(); it != package_map.end(); ++it) {
      std::cerr << " pkg install " << it->first;
      if (it->second.repository != "" &&
          !std::filesystem::exists(std::string(sources_prefix) +
                                   it->second.repository + ".list")) {
        std::cerr << ", after running pkg install " << it->second.repository
                  << "-repo" << std::endl;
      } else {
        std::cerr << std::endl;
      }
      if (next(it) != package_map.end()) {
        std::cerr << "or" << std::endl;
      }
    }
  } else {
    std::cerr << "No command " << command
              << " found, did you mean:" << std::endl;
    for (it = package_map.begin(); it != package_map.end(); ++it) {
      std::cerr << " Command " << it->second.binary << " in package "
                << it->first;
      if (it->second.repository != "" &&
          !std::filesystem::exists(std::string(sources_prefix) +
                                   it->second.repository + ".list")) {
        std::cerr << " from the " << it->second.repository << "-repo repository"
                  << std::endl;
      } else {
        std::cerr << std::endl;
      }
    }
  }
  return 127;
}
