#!/usr/bin/env bash

shopt -s nullglob
set -e

if [ "$1" == "all" ]; then
    repos="termux-packages termux-root-packages science-packages game-packages unstable-packages x11-packages"
else
    repos="$1"
fi

: "${TMPDIR:=/tmp}"

download_deb() {
    # This function sources a package's build.sh, and possible *.subpackage.sh,
    # and downloads the debs from a given repo. Debs are saved in $TERMUX_TOPDIR/_cache-$ARCH,
    # which is the same directory as when doing ./build-package.sh -i <pkg> builds
    pkg=$1
    pkg_dir=$2
    TERMUX_ARCH=$3

    # TERMUX_TOPDIR is defined in termux_step_setup_variables
    source ./termux-packages/termux-packages/scripts/build/termux_step_setup_variables.sh
    source ./termux-packages/termux-packages/scripts/build/termux_extract_dep_info.sh
    export TERMUX_SCRIPTDIR=./termux-packages/termux-packages
    source $TERMUX_SCRIPTDIR/scripts/properties.sh
    termux_step_setup_variables
    cd $repo/$repo
    export TERMUX_SCRIPTDIR=.

    for build_file in ${pkg_dir}/build.sh ${pkg_dir}*.subpackage.sh; do
        if [ "$(basename $build_file)" == "build.sh" ]; then
            pkg_name=$pkg
        else
            pkg_name=$(basename ${build_file%%.*})
        fi
        # Assume arch=TERMUX_ARCH unless TERMUX_{,SUB}PKG_PLATFORM_INDEPENDENT=true
        export TERMUX_ARCH
        dep_arch=""
        dep_version=""

        # Some packages, like all of texlive's subpackages, gives an error when sourcing the build.sh.
        # This happens because texlive's subpackages use a script to get the file list, which fails due
        # to unset variables in this context. We are only interested in the arch, not the file list
        # though so this error is not blocking. stderr is redirected to /dev/null below until a nicer
        # workaround can be found.
        read dep_arch dep_version <<< $(termux_extract_dep_info $pkg_name "${pkg_dir}" 2>/dev/null)
        if [ -z "$dep_arch" ]; then
            # termux_extract_dep_info returned nothing so the package is
            # probably blacklisted for the current arch
            return
        fi
        (
            mkdir -p "$TERMUX_TOPDIR/_cache-${dep_arch}"
            cd "$TERMUX_TOPDIR/_cache-${dep_arch}"
            if [ ! -f "${pkg_name}_${dep_version}_${dep_arch}.deb" ];
            then
                echo "Downloading ${repo_url}/$dep_arch/${pkg_name}_${dep_version}_${dep_arch}.deb" 1>&2
                temp_deb=$(mktemp $TMPDIR/${pkg_name}_${dep_version}_${dep_arch}.deb.XXXXXX)
                curl --fail -L -o "${temp_deb}" "${repo_url}/$dep_arch/${pkg_name}_${dep_version}_${dep_arch}.deb" || exit 1
                mv ${temp_deb} ${pkg_name}_${dep_version}_${dep_arch}.deb
            else
                printf "%-50s %s\n" "${pkg_name}_${dep_version}_${dep_arch}.deb" "already downloaded" 1>&2
            fi
            echo "$TERMUX_TOPDIR/_cache-${dep_arch}/${pkg_name}_${dep_version}_${dep_arch}.deb\n"
        )
    done
}

for repo in $repos; do
    case $repo in
        termux-packages)
            repo_url="https://grimler.se/$repo-24"
            ;;
        termux-root-packages)
            repo_url="https://grimler.se/$repo-24"
            ;;
        science-packages)
            repo_url="https://grimler.se/$repo-24"
            ;;
        game-packages)
            repo_url="https://grimler.se/$repo-24"
            ;;
        unstable-packages)
            repo_url="https://grimler.se/$repo"
            ;;
        x11-packages)
            repo_url="https://grimler.se/$repo"
            ;;
        *)
            echo "Unknown repo: '$repo'"
            exit 1
    esac

    for arch in aarch64 arm i686 x86_64; do
        # Get current commit, based on files checked into git
        current_commit=$(basename $(git ls-files $repo/commands-${arch}-*.h) \
                             |awk -F"-" '{ print substr($3,1,7) }')

        # Get new commit (current checked out commit of submodule)
        new_commit=$(git submodule status $repo \
                         |awk '{ if ($1 ~ /^+/) {print substr($1,2,7)} else {print substr($1,1,7)} }')
        if [ "$current_commit" == "$new_commit" ]; then continue; fi

        updated_packages=$(cd $repo/$repo;
                           git diff --dirstat=files,0 \
                               ${current_commit}..${new_commit} \
                               -- packages|awk '{if (gsub(/\//, "/") == 2) print $2}')
        debs=""
        deleted_packages=""
        for package in ${updated_packages}; do
            if [ -d $repo/$repo/$package ] && ! grep -q $arch < <(grep "^TERMUX_PKG_BLACKLISTED_ARCHES=" $repo/$repo/$package/build.sh); then
                debs+="$(download_deb $(basename $package) $package $arch)"
            else
                # Package seem to have been deleted,
                # we need to delete it from the command list
                deleted_packages+=" $package"
            fi
        done
        if [ ! "$deleted_packages" == "" ]; then
            extra_args="--delete $deleted_packages"
        fi

        # Length of $DEBS could be larger than ARG_MAX, at least on some
        # systems. To not risk such a problem we pipe the DEB list instead of
        # giving it as an argument.
        echo -e "$debs" | ./modify_command_list.py "./${repo}/commands-${arch}-${current_commit}.h" ${new_commit} ${extra_args}
        sed -i "s%# include \"${repo}/commands-${arch}-.*.h\"%# include \"${repo}/commands-${arch}-${new_commit}\.h\"%g" command-not-found.cpp
    done
done
