#!/usr/bin/env bash

shopt -s nullglob
set -e

if [ "$1" == "all" ]; then
    REPOS="termux-packages termux-root-packages science-packages game-packages unstable-packages x11-packages"
else
    REPOS="$1"
fi

: ${TMPDIR:=/tmp}

download_deb() {
    # This function sources a package's build.sh, and possible *.subpackage.sh,
    # and downloads the debs from a given repo. Debs are saved in $TERMUX_TOPDIR/_cache-$ARCH,
    # which is the same directory as when doing ./build-package.sh -i <pkg> builds
    PKG=$1
    PKG_DIR=$2
    TERMUX_ARCH=$3

    # TERMUX_TOPDIR is defined in termux_step_setup_variables
    source ./termux-packages/termux-packages/scripts/build/termux_step_setup_variables.sh
    source ./termux-packages/termux-packages/scripts/build/termux_extract_dep_info.sh
    export TERMUX_SCRIPTDIR=./termux-packages/termux-packages
    source $TERMUX_SCRIPTDIR/scripts/properties.sh
    termux_step_setup_variables
    cd $REPO/$REPO
    export TERMUX_SCRIPTDIR=.

    for BUILD_FILE in ${PKG_DIR}/build.sh ${PKG_DIR}*.subpackage.sh; do
        if [ "$(basename $BUILD_FILE)" == "build.sh" ]; then
            PKG_NAME=$PKG
        else
            PKG_NAME=$(basename ${BUILD_FILE%%.*})
        fi
        # Assume arch=TERMUX_ARCH unless TERMUX_{,SUB}PKG_PLATFORM_INDEPENDENT=true
        export TERMUX_ARCH
        DEP_ARCH=""
        DEP_VERSION=""

        # Some packages, like all of texlive's subpackages, gives an error when sourcing the build.sh.
        # This happens because texlive's subpackages use a script to get the file list, which fails due
        # to unset variables in this context. We are only interested in the arch, not the file list
        # though so this error is not blocking. stderr is redirected to /dev/null below until a nicer
        # workaround can be found.
        read DEP_ARCH DEP_VERSION <<< $(termux_extract_dep_info $PKG_NAME "${PKG_DIR}" 2>/dev/null)
        if [ -z "$DEP_ARCH" ]; then
            # termux_extract_dep_info returned nothing so the package is
            # probably blacklisted for the current arch
            return
        fi
        (
            mkdir -p "$TERMUX_TOPDIR/_cache-${DEP_ARCH}"
            cd "$TERMUX_TOPDIR/_cache-${DEP_ARCH}"
            if [ ! -f "${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb" ];
            then
                echo "Downloading ${REPO_URL}/$DEP_ARCH/${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb" 1>&2
                TEMP_DEB=$(mktemp $TMPDIR/${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb.XXXXXX)
                curl --fail -L -o "${TEMP_DEB}" "${REPO_URL}/$DEP_ARCH/${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb" || exit 1
                mv ${TEMP_DEB} ${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb
            else
                printf "%-50s %s\n" "${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb" "already downloaded" 1>&2
            fi
            echo "$TERMUX_TOPDIR/_cache-${DEP_ARCH}/${PKG_NAME}_${DEP_VERSION}_${DEP_ARCH}.deb\n"
        )
    done
}

for REPO in $REPOS; do
    case $REPO in
        termux-packages)
            REPO_URL="https://dl.bintray.com/termux/$REPO-24"
            ;;
        termux-root-packages)
            REPO_URL="https://dl.bintray.com/grimler/$REPO-24"
            ;;
        science-packages)
            REPO_URL="https://dl.bintray.com/grimler/$REPO-24"
            ;;
        game-packages)
            REPO_URL="https://dl.bintray.com/grimler/$REPO-24"
            ;;
        unstable-packages)
            REPO_URL="https://dl.bintray.com/xeffyr/$REPO"
            ;;
        x11-packages)
            REPO_URL="https://dl.bintray.com/xeffyr/$REPO"
            ;;
        *)
            echo "Unknown repo: '$REPO'"
            exit 1
    esac

    for ARCH in aarch64 arm i686 x86_64; do
        # Get current commit, based on files checked into git
        CURRENT_COMMIT=$(basename $(git ls-files $REPO/commands-${ARCH}-*.h) \
                             |awk -F"-" '{ print substr($3,1,7) }')

        # Get new commit (current checked out commit of submodule)
        NEW_COMMIT=$(git submodule status $REPO \
                         |awk '{ if ($1 ~ /^+/) {print substr($1,2,7)} else {print substr($1,1,7)} }')
        if [ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]; then continue; fi

        UPDATED_PACKAGES=$(cd $REPO/$REPO;
                           git diff --dirstat=files,0 \
                               ${CURRENT_COMMIT}..${NEW_COMMIT} \
                               -- packages|awk '{if (gsub(/\//, "/") == 2) print $2}')
        DEBS=""
        DELETED_PACKAGES=""
        for PACKAGE in ${UPDATED_PACKAGES}; do
            if [ -d $REPO/$REPO/$PACKAGE ] && ! grep -q $ARCH < <(grep "^TERMUX_PKG_BLACKLISTED_ARCHES=" $REPO/$REPO/$PACKAGE/build.sh); then
                DEBS+="$(download_deb $(basename $PACKAGE) $PACKAGE $ARCH)"
            else
                # Package seem to have been deleted,
                # we need to delete it from the command list
                DELETED_PACKAGES+=" $PACKAGE"
            fi
        done
        if [ ! "$DELETED_PACKAGES" == "" ]; then
            EXTRA_ARGS="--delete $DELETED_PACKAGES"
        fi

        # Length of $DEBS could be larger than ARG_MAX, at least on some
        # systems. To not risk such a problem we pipe the DEB list instead of
        # giving it as an argument.
        echo -e "$DEBS" | ./modify_command_list.py "./${REPO}/commands-${ARCH}-${CURRENT_COMMIT}.h" ${NEW_COMMIT} ${EXTRA_ARGS}
        sed -i "s%# include \"${REPO}/commands-${ARCH}-.*.h\"%# include \"${REPO}/commands-${ARCH}-${NEW_COMMIT}\.h\"%g" command-not-found.cpp
    done
done
