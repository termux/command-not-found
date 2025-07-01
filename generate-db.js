#!/usr/bin/env node
import { glob, readFile, writeFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { join } from "node:path";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

const { TERMUX_SCRIPTDIR, TERMUX_PREFIX, TERMUX_ARCH } = process.env;

if (!TERMUX_SCRIPTDIR) {
  throw new Error("TERMUX_PKG_CACHEDIR environment variable is not defined");
}

if (!TERMUX_PREFIX) {
  throw new Error("TERMUX_PREFIX environment variable is not defined");
}

if (!TERMUX_ARCH) {
  throw new Error("TERMUX_ARCH environment variable is not defined");
}

const binPrefix = TERMUX_PREFIX.substring(1) + "/bin/";
const repos = JSON.parse(
  await readFile(join(TERMUX_SCRIPTDIR, "repo.json")),
);

/**
 * Parses an alternative file and returns an array of alternative entries.
 *
 * The parsing isn't strict, and doesn't report errors. It may unintentionally throw errors if the file is malformed.
 *
 * Each entry contains:
 * - `name`: The name of the alternative.
 * - `link`: The link to the alternative.
 * - `alternative`: The alternative path.
 * - `dependents`: An array of dependents, each with `link`, `name`, and `path`. This is the list of slaves of the alternative. If there is no dependents, it'll be an empty array for consistency
 * - `priority`: The priority of the alternative.
 *
 * Note that both the name and path do not start with TERMUX_PREFIX, but instead start with the relative path from TERMUX_PREFIX.
 */
async function parseAlternativeFile(filePath) {
  const content = await readFile(filePath, "utf8");
  let name = undefined;
  let link = undefined;
  let alternative = undefined;
  let dependents = undefined;
  let priority = undefined;
  let parsingDependents = false;

  const alternatives = [];

  for (let line of content.split("\n")) {
    // Remove trailing comment
    // Comment starts with a '#' and can be at the end of the line as well
    let match = line.match(/\s*#.*/);
    line = line.substring(0, match === null ? line.length : match.index);


    if (line.startsWith("Name: ")) {
      if (parsingDependents) {
        parsingDependents = false;
      }

      // We already had a alternative entry, so push what we have parsed so far as an alternative entry
      if (name !== undefined) {
        alternatives.push({
          name: name,
          link: link,
          alternative: alternative,
          dependents: dependents === undefined ? [] : dependents,
          priority: parseInt(priority),
        });
        name = undefined;
        link = undefined;
        alternative = undefined;
        dependents = undefined;
        priority = undefined;
      }
      name = line.substring("Name: ".length).trim();
    }

    if (line.startsWith("Link: ")) {
      parsingDependents = false;
      link = line.substring("Link: ".length).trim();
    }

    if (line.startsWith("Alternative: ")) {
      parsingDependents = false;
      alternative = line.substring("Alternative: ".length).trim();
    }

    if (line.startsWith("Priority: ")) {
      parsingDependents = false;
      priority = line.substring("Priority: ".length).trim();
    }

    if (line.startsWith("Dependents:")) {
      parsingDependents = true;
    }

    // Parse the dependents entry here
    if (parsingDependents) {
      line = line.trim();
      // We have not parsed any dependents yet, so we initialize the dependents array
      if (dependents === undefined) {
        dependents = [];
      }
      // We trim the line to remove the leading indentation
      // The line should be in the format: "->link name path"
      // "->" is the leading indent
      // We use the regex \s+ to split the line into parts since the there can
      // be multiple spaces used for separating the parts for enhancing readibility
      const [dependentLink, dependentName, dependentPath] = line
        .trim()
        .split(/\s+/);
      if (dependentLink && dependentName && dependentPath) {
        dependents.push({
          link: dependentLink,
          name: dependentName,
          path: dependentPath,
        });
      }
    }
  }

  // After parsing the entire file, if we have a name, this means this is the
  // final entry. So push it as well
  if (name !== undefined) {
    alternatives.push({
      name: name,
      link: link,
      alternative: alternative,
      dependents: dependents === undefined ? [] : dependents,
      priority: priority,
    });
  }
  return alternatives;
}

async function processRepo(repo, repoPath, arch) {
  // Fetch the Contents.gz file for the given architecture from the apt mirror
  const url = `${repo.url}/dists/${repo.distribution}/Contents-${arch}.gz`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  // Since we are using a gzip file, we need to decompress it
  const data = await gunzipAsync(await response.arrayBuffer());
  // Convert to string and split by new lines
  // Each line is of the format:
  // "path/to/file package"
  //
  // Where `path/to/file` is the path to the file in the package, and `package`
  // is the name of the package that provides this file.
  const lines = data.toString().split("\n");

  // Stores mappings of binary names to package names
  // The key is the binary name, and the value is an array of package names
  // that provide this binary
  const binMap = new Map();

  // Stores mappings of file paths to package names
  // This is needed to resolve the package names for binaries that are setup
  // using the alternatives system
  const fileMap = new Map();
  // Populate the fileMap
  lines.forEach((line) => {
    const [path, packageName] = line.split(" ");
    fileMap.set(path, packageName);
  });

  // Now filter the entries from Contents.gz that have binaries, and store them
  // in binMap
  lines
    .filter((line) => line.startsWith(binPrefix))
    .forEach((line) => {
      const [pathToBinary, packageNames] = line.split(" ");
      const binary = pathToBinary.substring(pathToBinary.lastIndexOf("/") + 1);
      const packages = packageNames.split(",");

      packages.forEach((packageName) => {
        if (!binMap.has(packageName)) {
          binMap.set(packageName, []);
        }
        binMap.get(packageName).push(binary);
      });
    });

  // Now go through all the *.alternatives files in the repository and parse
  // them to find the alternatives and their dependents
  repoPath = join(TERMUX_SCRIPTDIR, repoPath);
  for await (const file of glob(`${repoPath}/*/*.alternatives`, {
    nodir: true,
  })) {
    const alternatives = await parseAlternativeFile(file);

    alternatives.forEach((alternativeEntry) => {
      let packageName = file.substring(repoPath.length + 1);
      packageName = packageName.substring(0, packageName.indexOf("/"));
      if (alternativeEntry.link.startsWith("bin/")) {
        const path = alternativeEntry.alternative;
        const binary = alternativeEntry.link.substring(
          alternativeEntry.link.lastIndexOf("/") + 1,
        );

        const packageName = fileMap.get(join(TERMUX_PREFIX.substring(1), path));
        if (packageName === undefined) {
          console.error(`Package name not found for path: ${path}`);
          process.exit(1);
        }
        if (!binMap.has(packageName)) {
          binMap.set(packageName, []);
        }
        binMap.get(packageName).push(binary);
        alternativeEntry.dependents.forEach(({ link, name: _, path }) => {
          if (link.startsWith("bin/")) {
            const depPackageName = fileMap.get(
              join(TERMUX_PREFIX.substring(1), path),
            );
            const depBinary = link.substring(link.lastIndexOf("/") + 1);
            if (!binMap.has(depPackageName)) {
              binMap.set(depPackageName, []);
            }
            binMap.get(depPackageName).push(depBinary);
          }
          // Register the link in the fileMap for the package
          // This is used by vim.alternatives where bin/vim is a link with alternative libexec/vim/vim
          // and bin/editor is a link with alternative bin/vim
          fileMap.set(join(TERMUX_PREFIX.substring(1), link), packageName);
          if (!binMap.has(packageName)) {
            binMap.set(packageName, []);
          }
          binMap.get(packageName).push(binary);
        });
      }
      // Register the link in the fileMap for the package
      // This is used by vim.alternatives where bin/vim is a link with alternative libexec/vim/vim
      // and bin/editor is a link with alternative bin/vim
      fileMap.set(
        join(TERMUX_PREFIX.substring(1), alternativeEntry.link),
        packageName,
      );
    });
  }

  const headerFile = `commands-${arch}-${repo.name}.h`;
  const header = Array.from(binMap.keys())
    .sort()
    .map((packageName) => {
      const binaries = binMap
        .get(packageName)
        .sort()
        .map((bin) => `" ${bin}",`);
      return `"${packageName}",\n${binaries.join("\n")}`;
    })
    .join("\n");

  await writeFile(headerFile, header);
}

const promises = [];

for (const path in repos) {
  if (path === "pkg_format") continue;
  const repo = repos[path];
  promises.push(processRepo(repo, path, TERMUX_ARCH));
}

await Promise.all(promises);
