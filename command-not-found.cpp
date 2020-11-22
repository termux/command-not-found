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

#include <iostream>
#include <cstring>
#include <map>
#include <list>
#include <sys/stat.h>

#ifndef PREFIX
# define PREFIX "/data/data/com.termux/files/usr"
#endif

using namespace std;

list<string> games_commands = {
#ifdef __aarch64__
# include "game-packages/commands-aarch64-099bedc.h"
#elif defined __arm__
# include "game-packages/commands-arm-099bedc.h"
#elif defined __i686__
# include "game-packages/commands-i686-099bedc.h"
#elif defined __x86_64__
# include "game-packages/commands-x86_64-099bedc.h"
#else
# error Failed to detect arch
#endif
};

list<string> main_commands = {
#ifdef __aarch64__
# include "termux-packages/commands-aarch64-e686fa9.h"
#elif defined __arm__
# include "termux-packages/commands-arm-e686fa9.h"
#elif defined __i686__
# include "termux-packages/commands-i686-e686fa9.h"
#elif defined __x86_64__
# include "termux-packages/commands-x86_64-e686fa9.h"
#else
# error Failed to detect arch
#endif
};

list<string> root_commands = {
#ifdef __aarch64__
# include "termux-root-packages/commands-aarch64-1981d42.h"
#elif defined __arm__
# include "termux-root-packages/commands-arm-1981d42.h"
#elif defined __i686__
# include "termux-root-packages/commands-i686-1981d42.h"
#elif defined __x86_64__
# include "termux-root-packages/commands-x86_64-1981d42.h"
#else
# error Failed to detect arch
#endif
};

list<string> science_commands = {
#ifdef __aarch64__
# include "science-packages/commands-aarch64-2b5427b.h"
#elif defined __arm__
# include "science-packages/commands-arm-2b5427b.h"
#elif defined __i686__
# include "science-packages/commands-i686-2b5427b.h"
#elif defined __x86_64__
# include "science-packages/commands-x86_64-2b5427b.h"
#else
# error Failed to detect arch
#endif
};

list<string> unstable_commands = {
#ifdef __aarch64__
# include "unstable-packages/commands-aarch64-807f8d8.h"
#elif defined __arm__
# include "unstable-packages/commands-arm-807f8d8.h"
#elif defined __i686__
# include "unstable-packages/commands-i686-807f8d8.h"
#elif defined __x86_64__
# include "unstable-packages/commands-x86_64-807f8d8.h"
#else
# error Failed to detect arch
#endif
};

list<string> x11_commands = {
#ifdef __aarch64__
# include "x11-packages/commands-aarch64-2ea5151.h"
#elif defined __arm__
# include "x11-packages/commands-arm-2ea5151.h"
#elif defined __i686__
# include "x11-packages/commands-i686-2ea5151.h"
#elif defined __x86_64__
# include "x11-packages/commands-x86_64-2ea5151.h"
#else
# error Failed to detect arch
#endif
};

struct info {string binary, repository;};

/* https://stackoverflow.com/a/12774387 */
inline bool file_exists (const string& name) {
  struct stat buffer;
  return (stat (name.c_str(), &buffer) == 0);
}

inline int termux_min3(int a, int b, int c) {
  return (a < b ? (a < c ? a : c) : (b < c ? b : c));
}

int termux_levenshtein_distance(char const* s1, char const* s2) {
  int s1len = strlen(s1);
  int s2len = strlen(s2);
  int x, y;
  int **matrix;
  int distance;
  matrix = (int **) malloc(sizeof *matrix * (s2len+1));

  if (!matrix) {
    cerr << "Memory allocation seem to have failed" << endl;
    return -2;
  }

  matrix[0] = (int *) malloc(sizeof *matrix[0] * (s1len+1));

  if (!matrix[0]) {
    cerr << "Memory allocation seem to have failed" << endl;
    return -3;
  }

  matrix[0][0] = 0;
  for (x = 1; x <= s2len; x++) {
    matrix[x] = (int *) malloc(sizeof *matrix[x] * (s1len+1));

    if (!matrix[x]) {
      cerr << "Memory allocation seem to have failed" << endl;
      return -4;
    }

    matrix[x][0] = matrix[x-1][0] + 1;
  }
  for (y = 1; y <= s1len; y++) {
    matrix[0][y] = matrix[0][y-1] + 1;
  }
  for (x = 1; x <= s2len; x++) {
    for (y = 1; y <= s1len; y++) {
      matrix[x][y] = termux_min3(matrix[x-1][y] + 1, matrix[x][y-1] + 1, matrix[x-1][y-1] + (s1[y-1] == s2[x-1] ? 0 : 1));
    }
  }
  distance = matrix[s2len][s1len];

  for (x = 0; x <= s2len; x++) {
    free(matrix[x]);
  }
  free(matrix);

  return distance;
}

int termux_look_for_packages(const char* command_not_found, list<string>* cmds, int* best_distance, void* guesses_at_best_distance, const char repository[]) {
  string current_package;
  string current_binary;
  int distance;
  map<string, info>* pkg_map = (map<string, info>*) guesses_at_best_distance;
  for (list<string>::iterator it = (*cmds).begin(); it != (*cmds).end(); ++it) {
    string current_line = *it;
    if (current_line[0] != ' ') {
      current_package = current_line;
    } else {
      current_binary = current_line.substr(1);
      distance = termux_levenshtein_distance(command_not_found, current_binary.c_str());
      if (distance < -1) {
        // malloc failed, return the error code
        return -distance;
      } else if (*best_distance == distance) {
        // As good as our previously best match
        (*pkg_map).insert(pair<string,info>(current_package, {current_binary, repository}));
      } else if (*best_distance == -1 || distance < *best_distance) {
        // New best match
        (*pkg_map).clear();
        *best_distance = distance;
        (*pkg_map).insert(pair<string,info>(current_package, {current_binary, repository}));
      }
    }
  }
  return 0;
}

int main(int argc, const char *argv[]) {
  if (argc != 2) {
    cerr <<  "usage: command-not-found <command>" << endl;
    return 1;
  }

  const char *command = argv[1];
  int best_distance = -1;
  struct info {string binary, repository;};
  map <string, info> package_map;
  map <string, info>::iterator it;
  int res;
  string sources_prefix = string(PREFIX) + "/etc/apt/sources.list.d/";

  res = termux_look_for_packages(command, &main_commands, &best_distance, &package_map, "");
  if (res != 0) { return res; }

  res = termux_look_for_packages(command, &games_commands, &best_distance, &package_map, "game");
  if (res != 0) { return res; }

  res = termux_look_for_packages(command, &root_commands, &best_distance, &package_map, "root");
  if (res != 0) { return res; }

  res = termux_look_for_packages(command, &science_commands, &best_distance, &package_map, "science");
  if (res != 0) { return res; }

  res = termux_look_for_packages(command, &unstable_commands, &best_distance, &package_map, "unstable");
  if (res != 0) { return res; }

  res = termux_look_for_packages(command, &x11_commands, &best_distance, &package_map, "x11");
  if (res != 0) { return res; }

  if (best_distance == -1 || best_distance > 3) {
    cerr << command << ": command not found" << endl;
  } else if (best_distance == 0) {
    cerr << "The program " << command << " is not installed. Install it by executing:" << endl;
    for (it=package_map.begin(); it!=package_map.end(); ++it) {
      cerr << " pkg install " << it->first;
      if (it->second.repository != "" &&
          !file_exists(sources_prefix + it->second.repository + ".list")) {
        cerr << ", after running pkg in " << it->second.repository << "-repo" << endl;
      } else {
        cerr << endl;
      }
      if (next(it) != package_map.end()) {
        cerr << "or" << endl;
      }
    }
  } else {
    cerr << "No command " << command << " found, did you mean:" << endl;
    for (it=package_map.begin(); it!=package_map.end(); ++it) {
      cerr << " Command " << it->second.binary << " in package " << it->first;
      if (it->second.repository != "" &&
          !file_exists(sources_prefix + it->second.repository + ".list")) {
        cerr << " from the " << it->second.repository << "-repo repository" << endl;
      } else {
        cerr << endl;
      }
    }
  }
  return 127;
}
