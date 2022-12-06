#!/usr/bin/env node
/* eslint-disable max-len */

import fs from "fs";
import { exit } from "process";
import chalk from "chalk";
import globby from "globby";
import path from "path";
import prompts from "prompts";
import Bundlr from "@bundlr-network/client";
import untildify from "untildify";
import { sha3_256 as sha3Hash } from "@noble/hashes/sha3";
import { program } from "commander";

import { AptosAccount, HexString, MaybeHexString } from "aptos";
import { version } from "../package.json";
import { BundlrUploader } from "./asset-uploader";
import { NFTMint } from "./nft-mint";
import {
  detectNetwork,
  MAINNET_APTOS_URL,
  MAINNET_BUNDLR_URL,
  TESTNET_APTOS_URL,
  TESTNET_BUNDLR_URL,
  MAINNET,
  TESTNET,
} from "./utils";

program
  .name("aptos-mint")
  .description("CLI to create NFT collections")
  .version(version);

program
  .command("init")
  .description("Creates a NFT project with a config file.")
  .requiredOption("--name <name>", "Name of the project.")
  .requiredOption(
    "--asset-path <asset-path>",
    "The path to the hashlips asset directory.",
  )
  .action(async ({ name: projectName, assetPath }) => {
    await checkHashLipsAsset(assetPath);
    await initProject(projectName, assetPath);
  });

program
  .command("validate")
  .description("Validate if the config of a project is valid.")
  .option("--project-path <project-path>", "The path to the NFT project")
  .option("--check-asset-hashes")
  .action(({ projectPath, checkAssetHashes }) => {
    validateProject(projectPath, true, checkAssetHashes || false);
  });

program
  .command("fund")
  .description(
    "Fund Bundlr Aptos. This is required before you can upload asset files to Arweave.",
  )
  .requiredOption(
    "--private-key <private-key>",
    "The private key of the NFT creator account. This account needs to have the APTs to fund Bundlr.",
  )
  .requiredOption(
    "--amount <octas>",
    "The amount of Octas to fund the Bundlr service.",
  )
  .option(
    "--network <mainnet|testnet>",
    "The network that this command is run against. 'mainnet' and 'testnet' are valid values.",
  )
  .action(async ({ privateKey, amount, network }) => {
    await fundBundlr(
      new AptosAccount(new HexString(privateKey).toUint8Array()),
      amount,
      network,
    );
  });

program
  .command("balance")
  .description("Get the balance available in the Bundlr service.")
  .requiredOption("--address <address>")
  .option(
    "--network <mainnet|testnet>",
    "The network that this command is run against. 'mainnet' and 'testnet' are valid values.",
  )
  .action(async ({ address, network }) => {
    await getBundlrBalance(address, network);
  });

program
  .command("update-minting-time-and-price")
  .description("Update the minting time and price.")
  .requiredOption(
    "--private-key <private-key>",
    "The private key of the NFT creator account.",
  )
  .requiredOption(
    "--minting-contract <contract-address>",
    "The on-chain address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project")
  .option(
    "--network <mainnet|testnet>",
    "The network that this command is run against. 'mainnet' and 'testnet' are valid values.",
  )
  .action(async (args) => {
    const { projectPath } = args;
    if (!validateProject(projectPath, true)) exit(1);
    const mintingEngine = await createMintingEngine(args);
    await mintingEngine.setMintingTimeAndPrice();
    console.log("Minting time and price are updated successfully");
  });

program
  .command("add-to-whitelist")
  .description(
    "Whitelist the addresses that can mint NFTs during whitelist period.",
  )
  .requiredOption(
    "--addresses <addr1,addr2,...>",
    "A list of addresses separated by commas.",
  )
  .requiredOption(
    "--limit <limit-per-address>",
    "The limit of NFTs that each account is allowed to mint.",
  )
  .requiredOption(
    "--private-key <private-key>",
    "The private key of the NFT creator account.",
  )
  .requiredOption(
    "--minting-contract <contract-address>",
    "The on-chain address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project")
  .option(
    "--network <mainnet|testnet>",
    "The network that this command is run against. 'mainnet' and 'testnet' are valid values.",
  )
  .action(async (args) => {
    const { addresses, limit } = args;
    const mintingEngine = await createMintingEngine(args);
    await mintingEngine.addToWhiteList(addresses.split(","), limit);
    console.log("Addresses are whitelisted successfully");
  });

program
  .command("upload")
  .description("Upload assets to Arweave.")
  .requiredOption(
    "--private-key <private-key>",
    "The private key of the NFT creator account.",
  )
  .requiredOption(
    "--minting-contract <contract-address>",
    "The on-chain address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project")
  .option(
    "--network <mainnet|testnet>",
    "The network that this command is run against. 'mainnet' and 'testnet' are valid values.",
  )
  .action(async (args) => {
    const { projectPath } = args;

    if (!validateProject(projectPath, true)) exit(1);
    const mintingEngine = await createMintingEngine(args);
    await mintingEngine.run();
  });

async function resolveNetwork(
  network: string | null | undefined,
  address: MaybeHexString,
): Promise<"mainnet" | "testnet"> {
  if (network) {
    if (network !== MAINNET && network !== TESTNET) {
      throw new Error(
        `Invalid network value ${network}. Only "${MAINNET}" and "${TESTNET}" are supported.`,
      );
    }

    return network;
  }

  const n = await detectNetwork(address);

  // We should ask users for the network
  if (n === "both") {
    const questions = [
      {
        type: "text",
        name: "network",
        message:
          "What is the network you want to run against? Accepted networks are 'mainnet' and 'testnet'",
        validate: (value: string) =>
          value !== MAINNET && value !== TESTNET
            ? "Invalid network value. Accepted networks are 'mainnet' and 'testnet'"
            : true,
      },
    ];

    const response = await prompts(questions as any);
    return response.network;
  }

  return n;
}

function exitWithError(message: string) {
  console.error(chalk.red(message));
  exit(1);
}

function resolvePath(p: string, ...rest: string[]): string {
  if (!p) return "";
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
      message: "Enter the collection cover image path",
    },
    {
      type: "text",
      name: "tokenNameBase",
      message:
        // eslint-disable-next-line max-len
        "Enter the base name of tokens. Final token names will be derived from the base name by appending sequence numbers",
    },
    {
      type: "text",
      name: "tokenDescription",
      message: "Enter the default token description",
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
      type: "number",
      name: "mintPrice",
      message: "Enter the public minting price in octas",
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
  outJson.collection.token_name_base = response.tokenNameBase;
  outJson.collection.token_description = response.tokenDescription;

  outJson.mint_start = response.mintStart;
  outJson.mint_end = response.mintEnd;
  outJson.mint_price = response.mintPrice;
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

async function fundBundlr(
  account: AptosAccount,
  amount: string,
  network: string | null | undefined,
) {
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

  const targetNetwork = await resolveNetwork(network, account.address());

  const bundlr = new BundlrUploader(account, targetNetwork);
  await bundlr.fund(amount);
  console.log("The storage service is funded.");
}

async function getBundlrBalance(
  accountAddress: MaybeHexString,
  network: string | null | undefined,
) {
  const targetNetwork = await resolveNetwork(network, accountAddress);

  const bundlrUrl =
    targetNetwork === MAINNET ? MAINNET_BUNDLR_URL : TESTNET_BUNDLR_URL;
  const bundlr = await Bundlr.init({
    url: bundlrUrl,
    currency: "aptos",
  });

  const balance = await bundlr.getBalance(
    HexString.ensure(accountAddress).hex(),
  );
  console.log(`${balance} OCTAS (${octasToApt(balance.toString())} APTs)`);
}

function validateProject(
  project: string,
  print: boolean,
  checkAssetHashes: boolean = false,
): boolean {
  const projectPath = project || ".";

  const configBuf = fs.readFileSync(path.join(projectPath, "config.json"));

  const config = JSON.parse(configBuf.toString("utf8"));
  const { collection } = config;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (config?.royalty_points_numerator <= 0) {
    // eslint-disable-next-line quotes
    warnings.push('Did you forget to set "royalty_points_numerator".');
  }

  if (!config?.royalty_payee_account) {
    // eslint-disable-next-line quotes
    warnings.push('Did you forget to set "royalty_payee_account".');
  }

  if (
    config.mint_start &&
    config.mint_end &&
    new Date(config.mint_end) <= new Date(config.mint_start)
  ) {
    // eslint-disable-next-line quotes
    errors.push('"mint_end" should not be earlier than "mint_start".');
  }

  if (
    config.whitelist_mint_start &&
    config.whitelist_mint_end &&
    new Date(config.whitelist_mint_end) <= new Date(config.whitelist_mint_start)
  ) {
    errors.push(
      // eslint-disable-next-line quotes
      '"whitelist_mint_end" should not be earlier than "whitelist_mint_start".',
    );
  }

  if (
    config.mint_start &&
    config.whitelist_mint_end &&
    new Date(config.mint_start) < new Date(config.whitelist_mint_end)
  ) {
    errors.push(
      // eslint-disable-next-line quotes
      '"whitelist_mint_end" should be earlier than "mint_start".',
    );
  }

  if (
    config.whitelist_mint_start &&
    new Date(config.whitelist_mint_start) < new Date()
  ) {
    errors.push(
      // eslint-disable-next-line quotes
      '"whitelist_mint_start" should be a future time.',
    );
  }

  if (config.mint_price < config.whitelist_mint_price) {
    errors.push(
      // eslint-disable-next-line quotes
      '"mint_price" should be not less than "whitelist_mint_price".',
    );
  }

  if (!collection?.name) {
    errors.push("Collection name cannot be empty.");
  }

  if (!collection?.file_path) {
    errors.push("Collection has no cover image.");
  } else if (!fs.existsSync(collection.file_path)) {
    errors.push(`Collection cover file ${collection.file_path} doesn't exist.`);
  }

  if (!config.tokens || config.tokens.length === 0) {
    errors.push("No tokens available for minting.");
  }

  const tokenImages = new Set();

  const assetHashMap = new Map<string, string>();

  config.tokens.forEach((token: any, i: number) => {
    if (!token.file_path) {
      errors.push(`Token at index ${i} has no image.`);
    } else if (!fs.existsSync(token.file_path)) {
      errors.push(`Token image ${token.file_path} doesn't exist.`);
    } else if (tokenImages.has(token.file_path)) {
      errors.push(`Duplicated token image file ${token.file_path}.`);
    } else {
      tokenImages.add(token.file_path);
    }

    if (token.supply <= 0) {
      errors.push(`${token.name} "supply" is <= 0`);
    }

    // Warning! This is going to be really slow.
    if (checkAssetHashes) {
      const fbuf = fs.readFileSync(token.file_path);
      const hash = sha3Hash.create();
      hash.update(fbuf);

      const hashHex = HexString.fromUint8Array(hash.digest()).hex();
      if (assetHashMap.has(hashHex)) {
        console.error(
          `${token.name} and ${assetHashMap.get(
            hashHex,
          )} have the same asset files!`,
        );
        exit(1);
      } else {
        assetHashMap.set(hashHex, token.name);
      }
    }
  });

  if (print) {
    errors.forEach((err: string) => console.error(chalk.red(err)));
    warnings.forEach((warn: string) => console.error(chalk.yellow(warn)));

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`${projectPath}/config.json passed validation check.`);
    }
  }

  return errors.length === 0;
}

async function createMintingEngine({
  privateKey,
  projectPath,
  network,
  mintingContract,
}: any): Promise<NFTMint> {
  const account = new AptosAccount(new HexString(privateKey).toUint8Array());

  const targetNetwork = await resolveNetwork(network, account.address());

  const uploader = new BundlrUploader(account, targetNetwork);

  return new NFTMint(
    projectPath ?? ".",
    account,
    targetNetwork === MAINNET ? MAINNET_APTOS_URL : TESTNET_APTOS_URL,
    uploader,
    mintingContract,
  );
}

async function run() {
  program.parse();
}

run();
