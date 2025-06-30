#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { join } from 'node:path';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);

const { TERMUX_PKG_CACHEDIR, TERMUX_PREFIX, TERMUX_ARCH } = process.env;

if (!TERMUX_PKG_CACHEDIR) {
  throw new Error('TERMUX_PKG_CACHEDIR environment variable is not defined');
}

if (!TERMUX_PREFIX) {
  throw new Error('TERMUX_PREFIX environment variable is not defined');
}

if (!TERMUX_ARCH) {
  throw new Error('TERMUX_ARCH environment variable is not defined');
}

const binPrefix = TERMUX_PREFIX.substring(1) + '/bin/';
const repos = JSON.parse(await readFile(join(TERMUX_PKG_CACHEDIR, 'repo.json')));

async function processRepo(repo, arch) {
  const url = `${repo.url}/dists/${repo.distribution}/Contents-${arch}.gz`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  const data = await gunzipAsync(await response.arrayBuffer());
  const binMap = {};
  data
    .toString()
    .split('\n')
    .filter(line => line.startsWith(binPrefix))
    .forEach(line => {
      const [pathToBinary, packageNames] = line.split(' ');
      const binary = pathToBinary.substring(pathToBinary.lastIndexOf('/') + 1);
      const packages = packageNames.split(',');

      packages.forEach(packageName => {
        binMap[packageName] ??= [];
        binMap[packageName].push(binary);
      });
    });

  const headerFile = `commands-${arch}-${repo.name}.h`;
  const header = Object.keys(binMap)
    .sort()
    .map(packageName => {
      const binaries = binMap[packageName].sort().map(bin => `" ${bin}",`);
      return `"${packageName}",\n${binaries.join('\n')}`;
    })
    .join('\n');

  await writeFile(headerFile, header);
}

const promises = [];

for (const path in repos) {
  if (path === 'pkg_format') continue;
  const repo = repos[path];
  promises.push(processRepo(repo, TERMUX_ARCH));
}

await Promise.all(promises);
