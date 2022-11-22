#!/usr/bin/env node

import { docopt } from "docopt";
import fs from "fs";
import { exit } from "process";
import chalk from "chalk";
import globby from "globby";
import path from "path";
import prompts from "prompts";
import Bundlr from "@bundlr-network/client";
import untildify from "untildify";

import { AptosAccount, HexString, MaybeHexString } from "aptos";
import { version } from "../package.json";
import {
  APTOS_FULL_NODE_URL,
  BundlrUploader,
  BUNDLR_URL,
} from "./asset-uploader";
import { TokenMill } from "./token-mill";

const doc = `
Usage:
  aptos-mint init --name=<name> --asset-path=<asset-path>
  aptos-mint fund --private-key=<private-key> --amount=<octas>
  aptos-mint balance --address=<address>
  aptos-mint mint --private-key=<private-key> [--project-path=<project-path>]
  aptos-mint -h | --help          Show this.
  aptos-mint --version
`;

function exitWithError(message: string) {
  console.error(chalk.red(message));
  exit(1);
}

function resolvePath(p: string, ...rest: string[]): string {
  return path.resolve(untildify(p), ...rest);
}

async function initProject(name: string, assetPath: string) {
  const fullPath = `./${name}`;
  if (fs.existsSync(fullPath)) {
    exitWithError(`${fullPath} already exists.`);
  }
  fs.mkdirSync(fullPath, { recursive: true });

  const configPath = `${fullPath}/config.json`;
  if (fs.existsSync(configPath)) {
    exitWithError(`${configPath} already exists.`);
  }

  fs.mkdirSync(fullPath, { recursive: true });

  let enableWL = false;

  const questions = [
    {
      type: "text",
      name: "collectionName",
      message: "What is the collection name?",
      validate: (value: string) =>
        value.length === 0 ? "Collection name cannot be empty" : true,
    },
    {
      type: "text",
      name: "collectionDescription",
      message: "What is the collection description?",
    },
    {
      type: "text",
      name: "collectionCover",
      message: "Enter the collection cover path",
    },
    {
      type: "number",
      name: "collectionMaximum",
      message: "Maximum tokens in the collection",
    },
    {
      type: "number",
      name: "royaltyPercent",
      message: "Enter royalty percentage. e.g. 5 represents 5%",
    },
    {
      type: "text",
      name: "royaltyPayeeAcct",
      message: "Enter royalty payee account address",
    },
    {
      type: "date",
      name: "mintStart",
      message: "Enter the public minting start time",
    },
    {
      type: "date",
      name: "mintEnd",
      message: "Enter the public minting end time",
    },
    {
      type: "confirm",
      name: "enableWL",
      message: "Do you want to support whitelist minting?",
    },
    {
      type: (prev: any) => {
        enableWL = prev;
        return null;
      },
    },
    {
      type: () => (enableWL ? "date" : null),
      name: "wlMintStart",
      message: "Enter the whitelist minting start time",
    },
    {
      type: () => (enableWL ? "date" : null),
      name: "wlMintEnd",
      message: "Enter the whitelist minting end time",
    },
    {
      type: () => (enableWL ? "number" : null),
      name: "wlPrice",
      message: "Enter the whitelist minting price in octas",
    },
  ];

  const response = await prompts(questions as any);
  const [configBuf, collectionBuf, tokenBuf] = await Promise.all([
    fs.promises.readFile(`${__dirname}/templates/config.json`),
    fs.promises.readFile(`${__dirname}/templates/collection.json`),
    fs.promises.readFile(`${__dirname}/templates/token.json`),
  ]);

  const configJson = JSON.parse(configBuf.toString("utf8"));
  const collectionJson = JSON.parse(collectionBuf.toString("utf8"));
  const tokenJson = JSON.parse(tokenBuf.toString("utf8"));

  const outJson = {
    assetPath,
    ...configJson,
    collection: {
      ...collectionJson,
    },
    tokens: [],
  };

  outJson.collection.name = response.collectionName;
  outJson.collection.description = response.collectionDescription;
  outJson.collection.file_path = resolvePath(response.collectionCover);
  outJson.collection.maximum = response.collectionMaximum;

  outJson.mint_start = response.mintStart;
  outJson.mint_end = response.mintEnd;
  outJson.royalty_points_numerator = response.royaltyPercent;
  outJson.royalty_points_denominator = 100;
  outJson.royalty_payee_account = response.royaltyPayeeAcct;

  if (enableWL) {
    outJson.whitelist_mint_start = response.wlMintStart;
    outJson.whitelist_mint_end = response.wlMintEnd;
    outJson.whitelist_mint_price = response.wlPrice;
  }

  const jsonFiles = await globby(`${assetPath}/json/*.json`);

  jsonFiles.forEach((p) => {
    if (path.basename(p) === "_metadata.json") return;

    const buf = fs.readFileSync(p);
    const json = JSON.parse(buf.toString("utf8"));

    const token = {
      ...tokenJson,
    };

    token.name = json.name;
    token.description = json.description;
    token.file_path = resolvePath(
      assetPath,
      "images",
      `${path.basename(p, ".json")}.png`,
    );
    token.metadata.attributes = json.attributes ?? [];
    token.supply = 1;
    token.royalty_points_denominator = outJson.royalty_points_denominator;
    token.royalty_points_numerator = outJson.royalty_points_numerator;

    outJson.tokens.push(token);
  });

  await fs.promises.writeFile(
    `${fullPath}/config.json`,
    JSON.stringify(outJson, null, 4),
    "utf8",
  );
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
    if (!json.name?.length) {
      exitWithError(`"name" cannot be empty in ${p}`);
    }
    if (!json.description?.length) {
      exitWithError(`"description" cannot be empty in ${p}`);
    }
  });
}

function octasToApt(amount: string): string {
  return (Number.parseInt(amount, 10) / 100000000).toFixed(2);
}

async function fundBundlr(account: AptosAccount, amount: string) {
  const questions = [
    {
      type: "confirm",
      name: "continue",
      message: `Do you want to fund the storage service ${octasToApt(
        amount,
      )} APT from account address ${account.address()}`,
    },
  ];
  const response = await prompts(questions as any);
  if (!response.continue) return;

  const bundlr = new BundlrUploader(account);
  await bundlr.fund(amount);
  console.log("The storage service is funded.");
}

async function getBundlrBalance(accountAddress: MaybeHexString) {
  const bundlr = await Bundlr.init({
    url: BUNDLR_URL,
    currency: "aptos",
  });

  const balance = await bundlr.getBalance(
    HexString.ensure(accountAddress).hex(),
  );
  console.log(`${balance} OCTAS (${octasToApt(balance.toString())} APTs)`);
}

// async function uploadProject(projectPath: string) {

// }

async function run() {
  const args = docopt(doc);
  if (args["--version"]) {
    console.log(version);
  } else if (args.init) {
    const [projectName, assetPath] = [args["--name"], args["--asset-path"]];
    await checkHashLipsAsset(assetPath);
    await initProject(projectName, assetPath);
  } else if (args.fund) {
    const [privateKey, amount] = [args["--private-key"], args["--amount"]];
    await fundBundlr(
      new AptosAccount(new HexString(privateKey).toUint8Array()),
      amount,
    );
  } else if (args.balance) {
    await getBundlrBalance(args["--address"]);
  } else if (args.mint) {
    const account = new AptosAccount(
      new HexString(args["--private-key"]).toUint8Array(),
    );

    const projectPath = args["--project-path"];

    const uploader = new BundlrUploader(account);

    const mill = new TokenMill(
      projectPath ?? ".",
      account,
      APTOS_FULL_NODE_URL,
      uploader,
    );

    await mill.run();
  }
}

run();
