/* eslint-disable no-await-in-loop */
/* eslint-disable max-len */
import {
  AptosAccount,
  AptosClient,
  HexString,
  TokenClient,
  MaybeHexString,
  getPropertyValueRaw,
} from "aptos";
import { Database } from "sqlite3";
import path from "path";
import util from "util";
import { sha3_256 as sha3Hash } from "@noble/hashes/sha3";
import canonicalize from "canonicalize";

import fs from "fs";

import chalk from "chalk";
import { AssetUploader, BundlrUploader } from "./asset-uploader";
import {
  dateTimeStrToUnixSecs,
  MAINNET,
  MAINNET_APTOS_URL,
  NetworkType,
  readProjectConfig,
  TESTNET_APTOS_URL,
} from "./utils";

// This class gets the minting contract ready for lazy minting.
export class NFTMint {
  private readonly tokenClient: TokenClient;

  private readonly client: AptosClient;

  private readonly uploader: AssetUploader;

  private readonly db: Database;

  private readonly config: Record<string, any>;

  private dbGet: (sql: string) => Promise<unknown>;

  private dbRun: (sql: string) => Promise<unknown>;

  private dbAll: (sql: string) => Promise<unknown>;

  constructor(
    public readonly projectPath: string,
    private readonly account: AptosAccount,
    public readonly mintingContractAddress: MaybeHexString,
    public readonly network: NetworkType,
  ) {
    const uploader = new BundlrUploader(account, network);
    const nodeURL = network === MAINNET ? MAINNET_APTOS_URL : TESTNET_APTOS_URL;
    this.db = new Database(path.join(projectPath, "minting.sqlite"));
    // Wait for up to two minutes when others are holding the lock
    this.db.configure("busyTimeout", 1200000);
    this.projectPath = projectPath ?? ".";
    this.config = readProjectConfig(projectPath);
    this.uploader = uploader;
    this.client = new AptosClient(nodeURL);
    this.tokenClient = new TokenClient(this.client);
    this.dbGet = util.promisify(this.db.get.bind(this.db));
    this.dbRun = util.promisify(this.db.run.bind(this.db));
    this.dbAll = util.promisify(this.db.all.bind(this.db));
    this.mintingContractAddress = HexString.ensure(
      mintingContractAddress,
    ).hex();
  }

  getExplorerLink(txnHash: string): string {
    return `https://explorer.aptoslabs.com/txn/${txnHash}?network=${this.network}`;
  }

  async checkTxnSuccessWithMessage(txnHash: string, message: string) {
    const txn = await this.client.waitForTransactionWithResult(txnHash, {
      timeoutSecs: 600,
    });

    if (!(txn as any)?.success) {
      throw new Error(
        `${message}\nTransaction link ${this.getExplorerLink(txnHash)}`,
      );
    }
  }

  hash(jsonObj: any): string {
    const canonicalStr = canonicalize(jsonObj)!;

    const hash = sha3Hash.create();
    hash.update(canonicalStr);

    return HexString.fromUint8Array(hash.digest()).hex();
  }

  async insertTask(
    taskType:
      | "collection_img_upload"
      | "token"
      | "set_collection_config"
      | "set_minting_time_and_price",
    name: string,
  ) {
    const row = await this.dbGet(
      `SELECT id FROM tasks where type = '${taskType}' and name = '${name}'`,
    );

    if (!row) {
      await this.dbRun(
        `INSERT INTO tasks(name, type, extra_data, finished) VALUES('${name}', '${taskType}', '', 0)`,
      );
    }
  }

  // Theses tasks can be ran on multiple cpu cores
  async loadTasks(config: Record<string, any>) {
    await this.insertTask("set_collection_config", "set_collection_config");
    await this.insertTask(
      "set_minting_time_and_price",
      "set_minting_time_and_price",
    );

    await this.insertTask("collection_img_upload", config.collection.name);

    config.tokens.forEach(async (token: any, i: number) => {
      await this.insertTask("token", i.toString());
    });
  }

  async ensureTablesExist() {
    // Minting has not started in the past. Let's create the minting tracking db
    await this.dbRun(`
      CREATE TABLE IF NOT EXISTS tasks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        extra_data TEXT,
        finished INTEGER
      )
    `);
  }

  async uploadTokenImageTask(token: any, i: number) {
    const row: any = await this.dbGet(
      `SELECT finished FROM tasks where type = 'token' and name = '${i}'`,
    );

    if (row?.finished) {
      console.log(
        `The asset of the token with index "${i}" was uploaded. Skip.`,
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [assetUri, hash] = await this.uploadOffChainMetaData(
      token.file_path,
      token,
    );

    await this.dbRun(
      `UPDATE tasks set finished = 1, extra_data = '${assetUri}' where type = 'token' and name = '${i}'`,
    );

    console.log(
      `The asset of the token with index "${i}" is uploaded to ${assetUri}`,
    );
  }

  async setCollectionConfigTask() {
    let row: any = await this.dbGet(
      "SELECT * FROM tasks where type = 'set_collection_config' and name = 'set_collection_config'",
    );

    if (row?.finished) {
      return;
    }

    row = await this.dbGet(
      `SELECT extra_data FROM tasks where type = 'collection_img_upload' and name = '${this.config.collection.name}'`,
    );

    if (!row?.extra_data) {
      throw new Error("Collection asset url is not available.");
    }

    const collectionUri = row.extra_data;

    const { collection } = this.config;

    const rawTxn = await this.client.generateTransaction(
      this.account.address(),
      {
        function: `${this.mintingContractAddress}::minting::set_collection_config_and_create_collection`,
        type_arguments: [],
        arguments: [
          collection.name,
          collection.description,
          collection.maximum,
          collectionUri,
          collection.mutability_config,
          collection.token_name_base,
          this.config.royalty_payee_account,
          collection.token_description,
          1, // TODO: remove the hard coded value for token_maximum
          collection.token_mutate_config,
          this.config.royalty_points_denominator,
          this.config.royalty_points_numerator,
        ],
      },
    );

    const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
    const pendingTxn = await this.client.submitTransaction(bcsTxn);

    await this.checkTxnSuccessWithMessage(
      pendingTxn.hash,
      "Failed to set collection config and create collection.",
    );

    await this.dbRun(
      "UPDATE tasks set finished = 1 where type = 'set_collection_config' and name = 'set_collection_config'",
    );
  }

  async setMintingTimeAndPrice() {
    const rawTxn = await this.client.generateTransaction(
      this.account.address(),
      {
        function: `${this.mintingContractAddress}::minting::set_minting_time_and_price`,
        type_arguments: [],
        arguments: [
          dateTimeStrToUnixSecs(
            this.config.whitelist_mint_start || this.config.mint_start,
          ),
          dateTimeStrToUnixSecs(
            this.config.whitelist_mint_end || this.config.mint_end,
          ),
          this.config.whitelist_mint_price || this.config.mint_price,
          dateTimeStrToUnixSecs(this.config.mint_start),
          dateTimeStrToUnixSecs(this.config.mint_end),
          this.config.mint_price,
        ],
      },
    );

    const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
    const pendingTxn = await this.client.submitTransaction(bcsTxn);

    await this.checkTxnSuccessWithMessage(
      pendingTxn.hash,
      "Failed to set minting time and price.",
    );
  }

  async addToWhiteList(addresses: string[], mintLimitPerAddress: number) {
    const rawTxn = await this.client.generateTransaction(
      this.account.address(),
      {
        function: `${this.mintingContractAddress}::minting::add_to_whitelist`,
        type_arguments: [],
        arguments: [addresses, mintLimitPerAddress],
      },
    );

    const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
    const pendingTxn = await this.client.submitTransaction(bcsTxn);

    await this.checkTxnSuccessWithMessage(
      pendingTxn.hash,
      "Failed to to add adresses to whitelist.",
    );
  }

  async setMintingTimeAndPriceTask() {
    const dbGet = util.promisify(this.db.get.bind(this.db));
    const row: any = await dbGet(
      "SELECT finished FROM tasks where type = 'set_minting_time_and_price' and name = 'set_minting_time_and_price'",
    );

    if (row?.finished) {
      return;
    }

    await this.setMintingTimeAndPrice();

    await this.dbRun(
      "UPDATE tasks set finished = 1 where type = 'set_minting_time_and_price' and name = 'set_minting_time_and_price'",
    );
  }

  // WARNING: we are adding tokens one by one. This costs more gas. However, this will avoid the exception that
  // transaction size exceeds limits. For simplicity, we only support adding token one by one at the moment.
  async addTokensTask(token: any, i: number) {
    const row: any = await this.dbGet(
      `SELECT * FROM tasks where type = 'token' and name = '${i}'`,
    );

    // 2 means the token has been added to the smart contract.
    if (row.finished === 2) {
      console.log(`Token at index ${i} was added to the smart contract. Skip.`);
      return;
    }

    const {
      property_keys: propertyKeys,
      property_values: propertyValues,
      property_types: propertyTypes,
    } = token.property_map;

    // We would store token attributes on chain too
    token?.metadata?.attributes?.forEach((attr: any) => {
      if (attr?.trait_type && attr?.value) {
        propertyKeys?.unshift(attr?.trait_type);
        propertyValues?.unshift(attr?.value);
        propertyTypes?.unshift("0x1::string::String");
      }
    });

    const rawTxn = await this.client.generateTransaction(
      this.account.address(),
      {
        function: `${this.mintingContractAddress}::minting::add_tokens`,
        type_arguments: [],
        arguments: [
          [row.extra_data],
          [propertyKeys],
          [getPropertyValueRaw(propertyValues, propertyTypes)],
          [propertyTypes],
        ],
      },
    );

    const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
    const pendingTxn = await this.client.submitTransaction(bcsTxn);

    await this.checkTxnSuccessWithMessage(
      pendingTxn.hash,
      `Failed to add the token at index ${i} to smart contract.`,
    );

    await this.dbRun(
      `UPDATE tasks set finished = 2 where type = 'token' and name = '${row.name}'`,
    );
    console.log(`Token at index ${i} is added to the smart contract.`);
  }

  async uploadCollectionImageTask(collection: any) {
    const row: any = await this.dbGet(
      `SELECT finished FROM tasks where type = 'collection_img_upload' and name = '${collection.name}'`,
    );

    if (row?.finished) {
      console.log(
        `The asset of the collection "${collection.name}" was uploaded. Skip.`,
      );
      return;
    }

    if (!collection.file_path) return;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [coverUri, hash] = await this.uploadOffChainMetaData(
      collection.file_path,
      collection,
    );

    await this.dbRun(
      `UPDATE tasks set finished = 1, extra_data = '${coverUri}' where type = 'collection_img_upload' and name = '${collection.name}'`,
    );

    console.log(`Collection cover image is uploaded to "${coverUri}"`);
  }

  async verifyAllTasksDone() {
    console.log(chalk.greenBright("Verifying if all tasks are done..."));

    const rows: any = await this.dbAll(
      "SELECT finished FROM tasks where type = 'token'",
    );

    if (!rows) {
      console.error(chalk.red("Unable to read task statuses."));
      return;
    }

    rows.forEach((row: any) => {
      if (row.finished !== 2) {
        throw new Error(
          "Some tasks did not finish. You can rerun the upload command.",
        );
      }
    });
    console.log(chalk.greenBright("All tasks are done"));
  }

  // Run in parallel for a large number of assets
  async run() {
    const config = await this.validateProjectFolder();

    await this.ensureTablesExist();
    await this.loadTasks(config);

    // Upload the collection asset
    await this.uploadCollectionImageTask(config.collection);

    // Upload the token assets
    for (let i = 0; i < config.tokens.length; i += 1) {
      const token = config.tokens[i];
      await this.uploadTokenImageTask(token, i);
    }

    // Create the collection
    await this.setCollectionConfigTask();

    // Set minting time
    await this.setMintingTimeAndPriceTask();

    // Add tokens
    for (let i = 0; i < config.tokens.length; i += 1) {
      const token = config.tokens[i];
      await this.addTokensTask(token, i);
    }

    await this.verifyAllTasksDone();
  }

  async validateProjectFolder(): Promise<Record<string, any>> {
    if (!fs.existsSync(path.join(this.projectPath, "config.json"))) {
      throw new Error(`config.json doesn't exist in ${this.projectPath}`);
    }

    const { config } = this;

    if (!config?.collection?.name) {
      throw new Error("collection name cannot be empty");
    }

    config?.collection?.tokens?.forEach((token: any) => {
      if (!token?.name) {
        throw new Error("token name cannot be empty");
      }
    });

    return config;
  }

  // create shared account for royalty
  // TODO: this should dedup if the creators and weights are same
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createRoyaltyAccount(config: any): Promise<HexString> {
    throw new Error("Unimplemented");
  }

  // construct the final json with URL and input config
  async uploadOffChainMetaData(
    assetPath: string,
    metaData: { [key: string]: any },
  ): Promise<[string, string]> {
    const dataId = await this.uploader.uploadFile(assetPath);
    const url = this.createArweaveURLfromId(dataId);

    const meta: any = { ...metaData, image: url };
    delete meta.file_path;

    const canonicalizedMeta = canonicalize(meta)!;
    const tmp = await fs.promises.mkdtemp("temp");
    const metaPath = path.join(tmp, "metadata.json");
    await fs.promises.writeFile(metaPath, canonicalizedMeta);

    const jsonId = await this.uploader.uploadFile(metaPath);

    // Now we can remove the temp folder
    await fs.promises.rm(tmp, { recursive: true });
    return [url, jsonId];
  }

  createArweaveURLfromId(dataId: string): string {
    return `https://arweave.net/${dataId}`;
  }
}
