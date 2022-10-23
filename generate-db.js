#!/usr/bin/env node
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const zlib = require("node:zlib");

const repositoryURL = "https://packages-cf.termux.dev/apt";
// TODO(@thunder-coding): Do not hardcode list of known architectures.
const archs = ["aarch64", "arm", "i686", "x86_64"];
const scriptdir = process.env["TERMUX_SCRIPTDIR"];
const defaultPrefixRegExp = /^data\/data\/com\.termux\/files\/usr/g;
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

const fetchFile = (url) => new Promise((resolve, reject) => {
  let req = https.get(url);
  req.on("error", (err) => {
    req.destroy();
    reject(err);
  });

  req.on("response", (res) => {
    if (res.statusCode != 200) {
      req.destroy(); res.destroy();
      reject(new Error(`${url} returned ${res.statusCode}`));
    }
    res.on("error", (err) => {
      req.destroy(); res.destroy();
      reject(err);
    });

    let rawData = [];
    res.on("data", (chunk) => {
      rawData.push(chunk);
    });
    res.on("end", () => {
      req.destroy(); res.destroy();
      resolve(Buffer.concat(rawData));
    });
  });
});

const promises = [];
Object.keys(repoJSON).forEach((repo_path) => {
  const repo = repoJSON[repo_path];
  archs.forEach((arch) => {
    let reqUrl = `${repositoryURL}/${repo.name}/dists/${repo.distribution}/Contents-${arch}.gz`;
    promises.push(fetchFile(reqUrl).then((rawBuffer) => {
      let binMap = {};
      let ungzipped = zlib.gunzipSync(rawBuffer).toString();
      let lines = ungzipped
        .split("\n")
        .map(s => s.replace(defaultPrefixRegExp, prefix.substring(1)));
      let linesContainingPathToBinaries = lines
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
      const unjoinedContent = [];
      Object.keys(binMap)
        .sort()
        .forEach((packageName) => {
          unjoinedContent.push(`"${packageName}",\n`);
          binMap[packageName].sort().forEach((packageName) => {
            unjoinedContent.push(`" ${packageName}",\n`);
          });
        });
      const content = unjoinedContent.join("");

      const headerFile = `commands-${arch}-${repo.name}.h`;
      if (fs.existsSync(headerFile)) {
        fs.rmSync(headerFile);
      }
      if (content.replace(/\n/g, "") === "") throw new Error(`content is empty`);
      const encoding = "utf-8";
      fs.writeFileSync(headerFile, content, { encoding: encoding });
      if (fs.readFileSync(headerFile, { encoding: encoding }) !== content) throw new Error(`error writting to ${headerFile}`);

      console.log(`${path.basename(__filename)}: downloaded from ${reqUrl} and then written to ${headerFile}`);
    }).catch((e) => {
      console.error(`${path.basename(__filename)}: error during/after downloading from ${reqUrl}`, e);
      throw e;
    }));
  });
});
Promise.allSettled(promises).then((results) => process.exit(results.find((result) => result.status !== "fulfilled") == null ? 0 : -1));
