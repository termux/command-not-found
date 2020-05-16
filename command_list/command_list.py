#!/usr/bin/python3

import subprocess, os

class command_list(object):
    def __init__(self, command_list_file):
        self.command_list_file = command_list_file
        self.packages = {}

    def read_list(self):
        """ Reads command list from file and fills package dictionary """
        with open(self.command_list_file, 'r') as f:
            all_content = f.read().split('\n')[:-1]

        for line in all_content:
            if not line.strip(',').strip('"')[0] == ' ':
                # Line doesn't start with a space so we have reached a new package
                current_package = line.strip(',').strip('"')
                self.packages[current_package] = []
            else:
                # Line starts with empty space so it is a binary
                self.packages[current_package].append(line.strip(',').strip('"')[1:])

    def write_list(self, new_commit):
        """ Writes command list to new file, after sorting packages in alphabetical order """
        new_command_list_file = '-'.join(self.command_list_file.split("-")[:-1] + [new_commit+".h"])
        with open(new_command_list_file, 'w') as f:
            for pkg, binaries in sorted(self.packages.items()):
                f.write('"'+pkg+'",\n')
                for binary in sorted(binaries):
                    f.write('" '+binary+'",\n')

    def get_list_from_deb(self, deb_path):
        """ Get list of binaries inside deb """
        all_content = [full_string.split()[5] for full_string in
                       subprocess.run(["dpkg", '-c', deb_path], capture_output = True)
                       .stdout.decode("utf-8").split("\n")[:-1]]
        binaries = [os.path.basename(b.replace("./data/data/com.termux/files/usr/bin/", "")) for b in all_content
                    if b.startswith("./data/data/com.termux/files/usr/bin/")
                    and os.path.basename(b.replace("./data/data/com.termux/files/usr/bin/", ""))]
        return binaries
        return binaries

    def add_package_to_list(self, package, binaries):
        self.packages[package] = binaries

    def remove_package_from_list(self, package):
        self.packages.pop(package, None)

    def print_package_content(self, package):
        print(self.packages[package])

    def package_exists_in_list(self, package):
        return package in self.packages.keys()
