# Command-not-found for termux

This repo contains sources for the command-not-found utility used in termux.
Apart from the sources for the binary (`command-not-found.cpp`), it also
contains lists of commands for the various official repositories:

- [termux-packages](https://github.com/termux/termux-packages)
- [game-packages](https://github.com/termux/game-packages)
- [science-packages](https://github.com/termux/science-packages)
- [termux-root-packages](https://github.com/termux/termux-root-packages)
- [unstable-packages](https://github.com/termux/unstable-packages)
- [x11-packages](https://github.com/termux/x11-packages)

in subfolders, and scripts (`update_command_list.sh`, `modify_command_list.py`)
for handling these lists.

## Building command-not-found

To build the package, `cmake` and a c++ compiler (for example `g++` or `clang++`)
needs to be installed.
To do an out of source build, run these commands from the command-not-found
directory:

```sh
mkdir build && cd build
cmake ..
make
```

This will create a command-not-found binary which can be tested directly.
To then install the program, run:

```sh
make install
```

This installs command-not-found to `CMAKE_INSTALL_PREFIX/libexec/termux`, which
is where command-not-found resides in termux.

## Updating the command lists

To generate new lists of commands you first need to update the submodule to the
commit you want to use. To update all repos to the latest commit available, run

```sh
git submodule update --init --remote
```

or to just update a single repo to the latest commit, run

```sh
git submodule update --init --remote <repo>
```

If you do not want to use the latest commit you can checkout another one by
running, from the command-not-found main folder:

```sh
cd <repo>/<repo>
git checkout <commit-number>
```

Now that the submodules are at the correct commits, `update_command_list.sh`
can be run. The script uses the previously checked in command list
(`<repo>/commands-<arch>-<commit>.h`) and checks which packages have been
updated between that commit and the currently checked out one. It then
downloads these deb archives (unless they already exist in the
`$TERMUX_TOPDIR/_cache-<arch>`-folder), creates new command lists and then
modifies command-not-found.cpp to use the new lists. To update the lists, run:

```sh
./update_command_lists.sh <repo, or 'all'>
```

This might take a while since it needs to download a lot of deb archives.
After this finishes the new command lists, and updated command-not-found.cpp,
can be checked into git, and the old lists removed. This can be done with:

```sh
# Remove currently checked in command lists
git rm $(git ls-files <repo>/commands-*.h)
# Add new command lists and updated submodule
git add <repo>
# Add command-not-found.cpp, pointing to the new command lists
git add command-not-found.cpp
# Check in into git, with some message
git commit
```

