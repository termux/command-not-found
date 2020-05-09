#!/usr/bin/env python3

import sys, os

from command_list import command_list

if len(sys.argv) < 3:
    print("Error: too few arguments.")
    print("Call with 'echo path-to-deb | ./modify_command_list.py path-to-command-list new-commit [--delete package(s)]'")
    sys.exit(1)
command_list_path = sys.argv[1]
new_commit = sys.argv[2]
repo = os.path.basename(os.path.dirname(command_list_path))

if len(sys.argv) > 3:
    if sys.argv[3] == "--delete":
        packages_to_delete = sys.argv[4:]
    else:
        print("Error: unknown argument '" + sys.argv[3] + "'")
        sys.exit(1)
else:
    packages_to_delete = ""

list_of_commands = command_list(command_list_path)
list_of_commands.read_list()

for package in packages_to_delete:
    list_of_commands.remove_package_from_list(package.replace("packages/", "").strip("/"))

# Read from stdin, strip away newlines and empty lines.
# Packages are read from stdin instead of giving as arguments as we otherwise
# might pass more arguments than ARG_MAX, on some systems.
for package in [pkg.strip('\n') for pkg in sys.stdin if pkg.strip('\n')]:
    package_name = package.split("/")[-1].split("_")[0]
    print("Parsing " + package_name)
    binaries = list_of_commands.get_list_from_deb(package)

    if binaries:
        if list_of_commands.package_exists_in_list(package_name):
            list_of_commands.remove_package_from_list(package_name)
        list_of_commands.add_package_to_list(package_name, binaries)

list_of_commands.write_list(new_commit)
