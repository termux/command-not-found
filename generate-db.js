#!/usr/bin/env node
import { glob, readFile, writeFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { join } from "node:path";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

const { TERMUX_PKG_CACHEDIR, TERMUX_PREFIX, TERMUX_ARCH } = process.env;

if (!TERMUX_PKG_CACHEDIR) {
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
  await readFile(join(TERMUX_PKG_CACHEDIR, "repo.json")),
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
    let match = line.match(/\s*#.*/);
    line = line.substring(0, match === null ? line.length : match.index);
    if (line.startsWith("Name: ")) {
      if (parsingDependents) {
        parsingDependents = false;
      }

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

    if (parsingDependents) {
      line = line.trim();
      if (dependents === undefined) {
        dependents = [];
      }
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
  const url = `${repo.url}/dists/${repo.distribution}/Contents-${arch}.gz`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  const data = await gunzipAsync(await response.arrayBuffer());
  const binMap = {};
  const lines = data.toString().split("\n");

  const fileMap = new Map();
  lines.forEach((line) => {
    const [path, packageName] = line.split(" ");
    fileMap.set(path, packageName);
  });

  lines
    .filter((line) => line.startsWith(binPrefix))
    .forEach((line) => {
      const [pathToBinary, packageNames] = line.split(" ");
      const binary = pathToBinary.substring(pathToBinary.lastIndexOf("/") + 1);
      const packages = packageNames.split(",");

      packages.forEach((packageName) => {
        binMap[packageName] ??= [];
        binMap[packageName].push(binary);
      });
    });

  repoPath = join(TERMUX_PKG_CACHEDIR, repoPath);
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
        binMap[packageName] ??= [];
        binMap[packageName].push(binary);
        alternativeEntry.dependents.forEach(({ link, name, path }) => {
          if (link.startsWith("bin/")) {
            const depPackageName = fileMap.get(
              join(TERMUX_PREFIX.substring(1), path),
            );
            const depBinary = link.substring(link.lastIndexOf("/") + 1);
            binMap[depPackageName] ??= [];
            binMap[depPackageName].push(depBinary);
          }
          // Register the link in the fileMap for the package
          // This is used by vim.alternatives where bin/vim is a link with alternative libexec/vim/vim
          // and bin/editor is a link with alternative bin/vim
          fileMap.set(join(TERMUX_PREFIX.substring(1), link), packageName);
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

  // Sort the binaries for each package in alphabetical order
  // This is needed as the '*.alternatives' files are not guaranteed to be in any order
  for (const packageName in binMap) {
    binMap[packageName].sort();
  }

  const headerFile = `commands-${arch}-${repo.name}.h`;
  const header = Object.keys(binMap)
    .sort()
    .map((packageName) => {
      const binaries = binMap[packageName].sort().map((bin) => `" ${bin}",`);
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
