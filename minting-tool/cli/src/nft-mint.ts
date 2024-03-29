/* eslint-disable no-await-in-loop */
/* eslint-disable max-len */
import {
  AptosAccount,
  AptosClient,
  HexString,
  MaybeHexString,
  getPropertyValueRaw,
  TxnBuilderTypes,
} from "aptos";
import { Database } from "sqlite3";
import path from "path";
import util from "util";
import { sha3_256 as sha3Hash } from "@noble/hashes/sha3";
import canonicalize from "canonicalize";
import cluster from "node:cluster";
import { cpus } from "node:os";
import { program } from "commander";

import fs from "fs";

import chalk from "chalk";
import { exit } from "process";
import { AssetUploader, BundlrUploader } from "./asset-uploader";
import {
  dateTimeStrToUnixSecs,
  MAINNET,
  MAINNET_APTOS_URL,
  MapWithDefault,
  NetworkType,
  readProjectConfig,
  sleep,
  TESTNET_APTOS_URL,
} from "./utils";

const numCPUs = Math.max(20, cpus().length);

const MAX_TXN_BATCH_SIZE = 40;

// This class gets the minting contract ready for lazy minting.
export class NFTMint {
  private readonly client: AptosClient;

  private readonly uploader: AssetUploader;

  private readonly db: Database;

  private readonly config: Record<string, any>;

  private dbGet: (sql: string) => Promise<unknown>;

  private dbRun: (sql: string) => Promise<unknown>;

  private dbAll: (sql: string) => Promise<unknown>;

  private txnBatchSize = MAX_TXN_BATCH_SIZE;

  exitWorkers: number;

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
    this.dbGet = util.promisify(this.db.get.bind(this.db));
    this.dbRun = util.promisify(this.db.run.bind(this.db));
    this.dbAll = util.promisify(this.db.all.bind(this.db));
    this.mintingContractAddress = HexString.ensure(
      mintingContractAddress,
    ).hex();
    this.exitWorkers = 0;

    if (this.config.txnBatchSize) {
      this.txnBatchSize = this.config.txnBatchSize;
    }
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
    taskType: "collection_img_upload" | "token" | "set_minting_time_and_price",
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
    try {
      // If the mint config actually exists, return early.
      await this.client.getAccountResource(
        this.mintingContractAddress,
        `${this.mintingContractAddress}::minting::CollectionConfig`,
      );

      return;
      // eslint-disable-next-line no-empty
    } catch (e) {}

    const row: any = await this.dbGet(
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
          this.config.max_mints_per_address,
        ],
      },
    );

    const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
    const pendingTxn = await this.client.submitTransaction(bcsTxn);

    await this.checkTxnSuccessWithMessage(
      pendingTxn.hash,
      "Failed to set collection config and create collection.",
    );
  }

  async setMintingTimeAndPrice() {
    const rawTxn = await this.client.generateTransaction(
      this.account.address(),
      {
        function: `${this.mintingContractAddress}::minting::set_minting_time_and_price`,
        type_arguments: [],
        arguments: [
          this.config.whitelist_mint_start
            ? dateTimeStrToUnixSecs(this.config.whitelist_mint_start)
            : 0,
          this.config.whitelist_mint_end
            ? dateTimeStrToUnixSecs(this.config.whitelist_mint_end)
            : 0,
          this.config.whitelist_mint_price || 0,
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

  private async genAddTokensTxn(
    tokens: [any, number][],
  ): Promise<TxnBuilderTypes.RawTransaction> {
    const tokenNames = tokens.map(([, i]) => `'${i}'`);

    const query = `SELECT extra_data FROM tasks where type = 'token' and name in (${tokenNames.join(
      ",",
    )})`;

    // Fetch the asset urls from local sqlite.
    const rows: any = await this.dbAll(query);

    if (!rows) {
      throw new Error(`Failed to run query "${query}"`);
    }

    const urls = rows.map((row: any) => row.extra_data);

    const propertyKeys: any[] = [];
    const propertyValues: any[] = [];
    const propertyTypes: any[] = [];

    tokens.forEach(([token]) => {
      const keys = [...token.property_map.property_keys];
      const values = getPropertyValueRaw(
        token.property_map.property_values,
        token.property_map.property_types,
      );
      const types = [...token.property_map.property_types];

      // We would store token attributes on chain too
      token?.metadata?.attributes?.forEach((attr: any) => {
        if (attr?.trait_type && attr?.value) {
          keys?.unshift(attr?.trait_type);
          values?.unshift(
            ...getPropertyValueRaw([attr?.value], ["0x1::string::String"]),
          );
          types?.unshift("0x1::string::String");
        }
      });

      propertyKeys.push(keys);
      propertyValues.push(values);
      propertyTypes.push(types);
    });

    return this.client.generateTransaction(this.account.address(), {
      function: `${this.mintingContractAddress}::minting::add_tokens`,
      type_arguments: [],
      arguments: [urls, propertyKeys, propertyValues, propertyTypes],
    });
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

    const rawTxn = await this.genAddTokensTxn([[token, i]]);

    const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
    const pendingTxn = await this.client.submitTransaction(bcsTxn);

    const txnResult = await this.client.waitForTransactionWithResult(
      pendingTxn.hash,
      {
        timeoutSecs: 600,
      },
    );

    if (
      !(txnResult as any)?.success &&
      !(txnResult as any).vm_status.includes("EDUPLICATED_TOKENS")
    ) {
      throw new Error(
        `Failed to add the token at index ${i} to smart contract.\nTransaction link ${this.getExplorerLink(
          pendingTxn.hash,
        )}`,
      );
    }

    await this.dbRun(
      `UPDATE tasks set finished = 2 where type = 'token' and name = '${row.name}'`,
    );
    console.log(`Token at index ${i} is added to the smart contract.`);
  }

  async addTokensBatchTask(tokens: [any, number][]) {
    try {
      const rawTxn = await this.genAddTokensTxn(tokens);

      const bcsTxn = await this.client.signTransaction(this.account, rawTxn);
      const pendingTxn = await this.client.submitTransaction(bcsTxn);

      const tokenNames = tokens.map(([, i]) => `'${i}'`);

      await this.checkTxnSuccessWithMessage(
        pendingTxn.hash,
        `Failed to add the tokens at indices ${tokenNames.join(
          ", ",
        )} to smart contract.`,
      );

      await this.dbRun(
        `UPDATE tasks set finished = 2 where type = 'token' and name in (${tokenNames.join(
          ",",
        )})`,
      );

      console.log(
        `Tokens at indices ${tokenNames.join(
          ", ",
        )} are added to the smart contract.`,
      );
    } catch (e) {
      if (program.opts().verbose) {
        console.error(e);
      }

      // Falls back to single txn mode
      for (let i = 0; i < tokens.length; i += 1) {
        const [token, index] = tokens[i];
        try {
          // In single txn mode, we allow individual txn fail and continue with the rest.
          // The reason is that some txns of the batch might have already been uploaded.
          await this.addTokensTask(token, index);
        } catch (err) {
          if (program.opts().verbose) {
            console.error(err);
          }
        }
      }
    }
  }

  async decideBatchSize() {
    while (this.txnBatchSize > 1) {
      try {
        // Simulate token submittion, halve txnBatchSize if simulation failed
        const batchTokens = this.config.tokens.slice(-1 * this.txnBatchSize);

        const tokens = batchTokens.map((t: any, i: number) => [
          t,
          this.config.tokens.length - 1 - i,
        ]);

        const rawTxn = await this.genAddTokensTxn(tokens);

        const result = await this.client.simulateTransaction(
          this.account,
          rawTxn,
        );

        if (result?.[0].success) {
          return;
        }

        this.txnBatchSize = Math.ceil(this.txnBatchSize / 2);
      } catch (e) {
        this.txnBatchSize = Math.ceil(this.txnBatchSize / 2);
      }
    }
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

  private generateTaskIds(): MapWithDefault<number, number[]> {
    const cpuTaskQeue = new MapWithDefault<number, number[]>(() => []);

    const taskIds = this.config.tokens.map((_: any, i: number) => i);
    let i = 0;
    while (taskIds.length > 0) {
      const task = taskIds[0];
      cpuTaskQeue.get(i % numCPUs)!.push(task);
      taskIds.shift();
      i += 1;
    }

    return cpuTaskQeue;
  }

  private forkWorkers(env: { [key: string]: any }) {
    const taskIds = this.generateTaskIds();
    // Fork workers.
    for (let i = 0; i < numCPUs; i += 1) {
      if (taskIds.has(i)) {
        cluster.fork({ TASKS: JSON.stringify(taskIds.get(i)), ...env });
      }
    }
  }

  private async joinWorkers() {
    this.exitWorkers = 0;
    const numberTasks = this.generateTaskIds().size;

    while (this.exitWorkers < numberTasks) {
      await sleep(2000);
    }
  }

  // Run in parallel for a large number of assets
  async run() {
    if (cluster.isPrimary) {
      cluster.on("exit", () => {
        this.exitWorkers += 1;
      });
      const config = await this.validateProjectFolder();

      await this.ensureTablesExist();
      await this.loadTasks(config);

      // Upload the collection asset
      await this.uploadCollectionImageTask(config.collection);

      // Fork workers
      this.forkWorkers({ STEP: "upload_token_assets" });
    } else if (process.env.STEP === "upload_token_assets") {
      // In worker
      const tasks = JSON.parse(process.env.TASKS || "[]");
      // Upload the token assets
      for (let i = 0; i < tasks.length; i += 1) {
        const tokenIndex = tasks[i];
        const token = this.config.tokens[tokenIndex];
        await this.uploadTokenImageTask(token, tokenIndex);
      }
      // Make sure workers exit here
      exit(0);
    }

    // Now, we are back to the primary process
    await this.joinWorkers();

    // Create the collection
    await this.setCollectionConfigTask();

    // Set minting time
    await this.setMintingTimeAndPriceTask();

    await this.decideBatchSize();

    // Add tokens
    const rows: any = await this.dbAll(
      "SELECT name FROM tasks where type = 'token' and finished = 1",
    );
    const tokensToBeAdded = rows
      .map((r: any) => r.name)
      .sort((a: string, b: string) => parseInt(a, 10) - parseInt(b, 10));

    const batches: [any, number][][] = [];

    let currentBatch: [any, number][] = [];
    while (tokensToBeAdded.length > 0) {
      const i = tokensToBeAdded.shift();
      currentBatch.push([this.config.tokens[i], i]);

      if (currentBatch.length === this.txnBatchSize) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    for (let j = 0; j < batches.length; j += 1) {
      await this.addTokensBatchTask(batches[j]);
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    metaData: { [key: string]: any },
  ): Promise<[string, string]> {
    const dataId = await this.uploader.uploadFile(assetPath);
    const url = this.createArweaveURLfromId(dataId);

    return [url, ""];
  }

  createArweaveURLfromId(dataId: string): string {
    return `https://arweave.net/${dataId}`;
  }
}
