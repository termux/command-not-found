#!/usr/bin/env node
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const zlib = require("node:zlib");

const repositoryURL = "https://helloanwar.com/neptune-terminal-repo/apt";
// TODO(@thunder-coding): Do not hardcode list of known architectures.
const archs = ["aarch64", "arm", "i686", "x86_64"];
const scriptdir = process.env["TERMUX_SCRIPTDIR"];
const prefix = process.env["TERMUX_PREFIX"];
if (scriptdir === undefined) {
  throw new Error("TERMUX_SCRIPTDIR environment variable is not defined");
}
if (prefix === undefined) {
  throw new Error("TERMUX_PREFIX environment variable is not defined");
}
const binPrefix = prefix.substring(1) + "/bin/";

const repoBuffer = fs.readFileSync(path.join(scriptdir, "repo.json"));
const repoJSON = JSON.parse(repoBuffer);

Object.keys(repoJSON).forEach((repo_path) => {
  const repo = repoJSON[repo_path];
  archs.forEach((arch) => {
    https.get(
      `${repositoryURL}/${repo.name}/dists/${repo.distribution}/Contents-${arch}.gz`,
      (res) => {
        if (res.statusCode != 200) {
          throw new Error(`${res.url} returned ${res.statusCode}`);
        }

        let rawData = [];
        res.on("data", (chunk) => {
          rawData.push(Buffer.from(chunk, "binary"));
        });
        res.on("end", () => {
          let binMap = {};
          let rawBuffer = Buffer.concat(rawData);
          let ungzipped = zlib.gunzipSync(rawBuffer).toString();
          let linesContainingPathToBinaries = ungzipped
            .split("\n")
            .filter((line) => {
              return line.startsWith(binPrefix);
            });
          linesContainingPathToBinaries.forEach((line) => {
            const [pathToBinary, packageNames] = line.split(" ");
            const binary = pathToBinary.substring(
              pathToBinary.lastIndexOf("/") + 1
            );
            const packages = packageNames.split(",");

            packages.forEach((packageName) => {
              if (binMap[packageName] === undefined) {
                binMap[packageName] = [];
              }
              binMap[packageName].push(binary);
            });
          });
          const headerFile = `commands-${arch}-${repo.name}.h`;
          if (fs.existsSync(headerFile)) {
            fs.rmSync(headerFile);
            console.log(`removing file: ${headerFile} \n`)
          }
          Object.keys(binMap)
            .sort()
            .forEach((packageName) => {
              console.log(`appending file: ${headerFile} \n`)
              fs.appendFileSync(headerFile, `"${packageName}",\n`);
              binMap[packageName].sort().forEach((packageName) => {
                fs.appendFileSync(headerFile, `" ${packageName}",\n`);
              });
            });
        });
      }
    );
  });
});
