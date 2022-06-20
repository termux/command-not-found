# Command-not-found for termux

This repo contains sources for the command-not-found utility used in termux.
Apart from the sources for the binary (`command-not-found.cpp`), it also
contains a script to generate lists of commands for the various official
repositories:

- [main repo](https://github.com/termux/termux-packages/tree/master/packages)
- [root repo](https://github.com/termux/termux-packages/tree/master/root-packages)
- [x11 repo](https://github.com/termux/termux-packages/tree/master/x11-packages)

## Building command-not-found

To build the package, `cmake` and a c++ compiler (for example `g++` or `clang++`)
needs to be installed.
Apart from `cmake` and a C++ compiler, `nodejs` is also needed in order to
generate list of commands.
To do an out of source build, run these commands from the command-not-found
directory:

```sh
mkdir build && cd build
cmake ..
make
```

This will generate command lists by running `./generate-db.js`, and create
a command-not-found binary which can be tested directly.
To then install the program, run:

```sh
make install
```

This installs command-not-found to `CMAKE_INSTALL_PREFIX/libexec/termux`, which
is where command-not-found resides in termux.

## Updating the command lists

In order to update the command lists, just a rebuild of command-not-found
is to be done by bumping the `TERMUX_PKG_REVISION` in build recipe of
command-not-found.
