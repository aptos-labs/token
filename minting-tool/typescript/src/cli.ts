#!/usr/bin/env node
/* eslint-disable max-len */

import fs from "fs";
import { exit } from "process";
import chalk from "chalk";
import globby from "globby";
import path from "path";
import prompts from "prompts";
import Bundlr from "@bundlr-network/client";
import { sha3_256 as sha3Hash } from "@noble/hashes/sha3";
import { program } from "commander";
import cluster from "node:cluster";
import short from "short-uuid";
import { Database } from "sqlite3";
import util from "util";

import { AptosAccount, BCS, HexString, MaybeHexString } from "aptos";
import { version } from "../package.json";
import { BundlrUploader } from "./asset-uploader";
import { NFTMint } from "./nft-mint";
import {
  MAINNET_BUNDLR_URL,
  TESTNET_BUNDLR_URL,
  MAINNET,
  NetworkType,
  resolvePath,
  resolveProfile,
  octasToApt,
  readProjectConfig,
  exitWithError,
  runWithAptosCLI,
  OCTAS_PER_APT,
} from "./utils";

program
  .name("aptos-mint")
  .description("CLI to create NFT collections")
  .option(
    "-v, --verbose",
    "Print more information. This is useful for debugging purpose.",
    false,
  )
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
  .command("set-minting-contract")
  .description("Set the minting contract address for a project.")
  .requiredOption(
    "--contract-address <contract-address>",
    "The address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project", ".")
  .action(async ({ projectPath, contractAddress }) => {
    await setMintingContractAddress(projectPath, contractAddress);
    console.log(`Set contract address to ${contractAddress}`);
  });

program
  .command("validate")
  .description("Validate if the config of a project is valid.")
  .option("--project-path <project-path>", "The path to the NFT project", ".")
  .option("--check-asset-hashes")
  .action(async ({ projectPath, checkAssetHashes }) => {
    await assertProjectValid(projectPath, true, checkAssetHashes || false);
  });

program
  .command("fund")
  .description(
    "Fund Bundlr Aptos. This is required before you can upload asset files to Arweave.",
  )
  .requiredOption(
    "--profile <aptos-cli-profile>",
    "The profile name of the Aptos CLI. This account needs to have the APTs to fund Bundlr.",
  )
  .requiredOption(
    "--octas <octas>",
    "The amount of Octas to fund the Bundlr service.",
  )
  .action(async ({ profile, octas }) => {
    const [account, network] = await resolveProfile(profile);
    await fundBundlr(account, octas, network);
  });

program
  .command("balance")
  .description("Get the balance available in the Bundlr service.")
  .requiredOption(
    "--profile <aptos-cli-profile>",
    "The profile name of the Aptos CLI.",
  )
  .action(async ({ profile }) => {
    const [account, network] = await resolveProfile(profile);
    await getBundlrBalance(account.address(), network);
  });

program
  .command("update-minting-time-and-price")
  .description("Update the minting time and price.")
  .requiredOption(
    "--profile <aptos-cli-profile>",
    "The profile name of the Aptos CLI.",
  )
  .option(
    "--minting-contract <contract-address>",
    "The on-chain address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project", ".")
  .action(async ({ projectPath, profile, mintingContract }) => {
    await assertProjectValid(projectPath, true);
    const mintingEngine = await createNFTMintingEngine({
      projectPath,
      profile,
      mintingContract,
    });

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
    "--profile <aptos-cli-profile>",
    "The profile name of the Aptos CLI.",
  )
  .option(
    "--minting-contract <contract-address>",
    "The on-chain address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project", ".")
  .action(
    async ({ addresses, limit, profile, mintingContract, projectPath }) => {
      const mintingEngine = await createNFTMintingEngine({
        projectPath,
        profile,
        mintingContract,
      });
      await mintingEngine.addToWhiteList(addresses.split(","), limit);
      console.log("Addresses are whitelisted successfully");
    },
  );

program
  .command("upload")
  .description("Upload assets to Arweave.")
  .requiredOption(
    "--profile <aptos-cli-profile>",
    "The profile name of the Aptos CLI.",
  )
  .option(
    "--minting-contract <contract-address>",
    "The on-chain address of the minting contract.",
  )
  .option("--project-path <project-path>", "The path to the NFT project", ".")
  .action(async ({ profile, mintingContract, projectPath }) => {
    // Only primary process needs to validate the project.
    if (cluster.isPrimary) {
      await assertProjectValid(projectPath, true);
    }

    const mintingEngine = await createNFTMintingEngine({
      projectPath,
      profile,
      mintingContract,
    });
    await mintingEngine.run();
  });

program
  .command("publish-contract")
  .description(
    "Build the smart contract with the Aptos CLI and publish the smart contract to a resource account",
  )
  .requiredOption(
    "--profile <aptos-cli-profile>",
    "The profile name of the Aptos CLI.",
  )
  .option(
    "--resource-account-seed",
    "The seed that is used to the resource account.",
  )
  .option("--project-path <project-path>", "The path to the NFT project", ".")
  .action(async ({ profile, resourceAccountSeed, projectPath }) => {
    const [account] = await resolveProfile(profile);
    const seed = resourceAccountSeed || short.generate();

    const fullProjectPath = resolvePath(projectPath);

    const resourceAccountAddr = AptosAccount.getResourceAccountAddress(
      account.address(),
      BCS.bcsSerializeStr(seed),
    );

    await runWithAptosCLI(
      `aptos move create-resource-account-and-publish-package --seed ${seed} --package-dir ${fullProjectPath}/contracts --address-name mint_nft --named-addresses source_addr=${profile} --profile ${profile}`,
    );

    await setMintingContractAddress(projectPath, resourceAccountAddr.hex());
  });

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

  // We would like to pull in the smart contract to the project folder
  fs.cpSync(`${__dirname}/contracts`, `${fullPath}/contracts`, {
    recursive: true,
  });

  let enableWL = true;

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
      type: "number",
      float: true,
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
      name: "maxMintsPerAddress",
      message:
        "Enter the maximum allowed mints per address. 0 means no limits.",
    },
    {
      type: "number",
      float: true,
      name: "mintPrice",
      message: "Enter the public minting price in APTs",
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
      float: true,
      message: "Enter the whitelist minting price in APTs",
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
  outJson.collection.token_description = response.tokenDescription || "";

  outJson.mint_start = response.mintStart;
  outJson.mint_end = response.mintEnd;
  outJson.mint_price = response.mintPrice * OCTAS_PER_APT;
  outJson.max_mints_per_address = response.maxMintsPerAddress || 0;

  // Here we need to do number scaling since the smart contract only accepts integers. We only allow creators to provide
  // a number with a maximum of two digits precision.
  outJson.royalty_points_numerator = Math.floor(
    Number.parseFloat(response.royaltyPercent) * 100,
  );
  outJson.royalty_points_denominator = 10000;
  outJson.royalty_payee_account = response.royaltyPayeeAcct;

  if (enableWL) {
    outJson.whitelist_mint_start = response.wlMintStart;
    outJson.whitelist_mint_end = response.wlMintEnd;
    outJson.whitelist_mint_price = response.wlPrice * OCTAS_PER_APT;
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

async function fundBundlr(
  account: AptosAccount,
  amount: string,
  network: NetworkType,
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

  const bundlr = new BundlrUploader(account, network);
  await bundlr.fund(amount);
  console.log("The storage service is funded.");
}

async function getBundlrBalance(
  accountAddress: MaybeHexString,
  network: NetworkType,
) {
  const bundlrUrl =
    network === MAINNET ? MAINNET_BUNDLR_URL : TESTNET_BUNDLR_URL;
  const bundlr = await Bundlr.init({
    url: bundlrUrl,
    currency: "aptos",
  });

  const balance = await bundlr.getBalance(
    HexString.ensure(accountAddress).hex(),
  );
  console.log(`${balance} OCTAS (${octasToApt(balance.toString())} APTs)`);
}

async function isMintingTimeAndPriceAlreadySet(
  projectPath: string,
): Promise<boolean> {
  try {
    const db = new Database(path.join(projectPath, "minting.sqlite"));
    const dbGet = util.promisify(db.get.bind(db));

    const row: any = await dbGet(
      "SELECT finished FROM tasks where type = 'set_minting_time_and_price' and name = 'set_minting_time_and_price'",
    );

    if (row?.finished) {
      return true;
    }
    // eslint-disable-next-line no-empty
  } catch (e) {}

  return false;
}

async function assertProjectValid(
  projectPath: string,
  print: boolean,
  checkAssetHashes: boolean = false,
) {
  const config = readProjectConfig(projectPath);
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

  const skipMintingTimeCheck = await isMintingTimeAndPriceAlreadySet(
    projectPath,
  );

  if (!skipMintingTimeCheck) {
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
      new Date(config.whitelist_mint_end) <=
        new Date(config.whitelist_mint_start)
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

    if (
      config.whitelist_mint_price !== 0 &&
      config.mint_price < config.whitelist_mint_price
    ) {
      errors.push(
        // eslint-disable-next-line quotes
        '"mint_price" should be not less than "whitelist_mint_price".',
      );
    }
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

    // Make sure token attributes are unique
    const attributeKeys = new Set();
    token.metadata?.attributes?.forEach((attr: any) => {
      if (attr?.trait_type) {
        if (attributeKeys.has(attr.trait_type)) {
          throw new Error(
            `Found duplicate trait type "${attr.trait_type}" for token ${i}`,
          );
        }
        attributeKeys.add(attr.trait_type);
      }
    });

    // Warning! This is going to be really slow.
    if (checkAssetHashes) {
      const fbuf = fs.readFileSync(token.file_path);
      const hash = sha3Hash.create();
      hash.update(fbuf);

      const hashHex = HexString.fromUint8Array(hash.digest()).hex();
      if (assetHashMap.has(hashHex)) {
        exitWithError(
          `${token.name} and ${assetHashMap.get(
            hashHex,
          )} have the same asset files!`,
        );
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

  if (errors.length > 0) {
    exit(1);
  }
}

async function createNFTMintingEngine({
  projectPath,
  profile,
  mintingContract,
}: {
  projectPath: string;
  profile: string;
  mintingContract: string;
}): Promise<NFTMint> {
  const [account, network] = await resolveProfile(profile);
  const nftContract =
    mintingContract || readProjectConfig(projectPath)?.contractAddress;
  if (!nftContract) {
    throw new Error("Minting contract address is unknown.");
  }
  return new NFTMint(projectPath, account, nftContract, network);
}

async function setMintingContractAddress(
  projectPath: string,
  contractAddress: string,
) {
  const config = readProjectConfig(projectPath);
  config.contractAddress = contractAddress;

  await fs.promises.writeFile(
    `${resolvePath(projectPath)}/config.json`,
    JSON.stringify(config, null, 4),
    "utf8",
  );
}

async function run() {
  program.parse();
}

process.on("uncaughtException", (err: Error) => {
  if (program.opts().verbose) {
    console.error(err);
  }

  exitWithError(err.message);
});

run();
