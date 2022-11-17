#!/usr/bin/env node

import { docopt } from "docopt";
import fs from "fs";
import { exit } from "process";
import chalk from "chalk";
import globby from "globby";
import path from "path";
import invariant from "tiny-invariant";

import { version } from "../package.json";

const doc = `
Usage:
  aptos-mint init <asset_path>
  aptos-mint -h | --help          Show this.
  aptos-mint --version
`;

function exitWithError(message: string) {
  console.error(chalk.red(message));
  exit(1);
}

/**
 * Verify that a path contains the required asset and metadata files
 * @param assetPath the build output path of HashLips
 */
async function checkHashLipsAsset(assetPath: string) {
  if (!fs.existsSync(assetPath)) {
    exitWithError(`"${assetPath}" is not a valid path.`);
  }

  // We first check "images" and "json" directories exist

  if (!fs.existsSync(`${assetPath}/images`)) {
    exitWithError(`Directory "${assetPath}/images" doesn't exist.`);
  }

  if (!fs.existsSync(`${assetPath}/json`)) {
    exitWithError(`Directory "${assetPath}/json" doesn't exist.`);
  }

  // Check that if every image file has a corresponding json file
  const images = await globby(`${assetPath}/images/*.png`); // only png files are supported
  const jsonFiles = await globby(`${assetPath}/json/*.json`);
  const jsonSet = new Set();
  jsonFiles.forEach((p) => jsonSet.add(path.basename(p, ".json")));
  images.forEach((p) => {
    if (!jsonSet.has(path.basename(p, ".png"))) {
      // eslint-disable-next-line quotes
      exitWithError('"images" and "json" files don\'t match.');
    }
  });

  // Check the json file format
  jsonFiles.forEach(async (p) => {
    if (path.basename(p) === "_metadata.json") return;

    const buf = await fs.promises.readFile(p);
    const json = JSON.parse(buf.toString("utf8"));
    invariant(json.name?.length > 0, `"name" cannot be empty in ${p}`);
    invariant(
      json.description?.length > 0,
      `"description" cannot be empty in ${p}`,
    );
  });
}

async function run() {
  const args = docopt(doc);
  if (args["--version"]) {
    console.log(version);
  }

  if (args.init) {
    checkHashLipsAsset(args["<asset_path>"]);
  }
}

run();
