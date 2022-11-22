import { AptosAccount, AptosClient, HexString, TokenClient, BCS } from "aptos";
import { Database } from "sqlite3";
import path from "path";
import util from "util";
import { sha3_256 as sha3Hash } from "@noble/hashes/sha3";
import canonicalize from "canonicalize";

import fs from "fs";
import invariant from "tiny-invariant";

import { AssetUploader } from "./asset-uploader";

export class TokenMill {
  projectPath: string;

  account: AptosAccount;

  tokenClient: TokenClient;

  client: AptosClient;

  uploader: AssetUploader;

  db: Database;

  config: Record<string, any>;

  constructor(
    projectPath: string,
    account: AptosAccount,
    nodeURL: string,
    uploader: AssetUploader,
  ) {
    this.db = new Database(path.join(projectPath, ".minting.sqlite"));
    this.projectPath = projectPath;
    this.config = this.readProjectConfig();
    this.account = account;
    this.uploader = uploader;
    this.client = new AptosClient(nodeURL);
    this.tokenClient = new TokenClient(this.client);
  }

  hash(jsonObj: any): string {
    const canonicalStr = canonicalize(jsonObj)!;

    const hash = sha3Hash.create();
    hash.update(canonicalStr);

    return HexString.fromUint8Array(hash.digest()).hex();
  }

  async verifyAndInsertTask(
    taskType: "collection" | "token",
    name: string,
    hash: string,
  ) {
    const dbGet = util.promisify(this.db.get.bind(this.db));
    const row = await dbGet(
      `SELECT hash FROM tasks where type = '${taskType}' and name = '${name}'`,
    );

    const dbRun = util.promisify(this.db.run.bind(this.db));
    if (!row) {
      await dbRun(
        `INSERT INTO tasks(name, type, hash, finished) VALUES('${name}', '${taskType}', '${hash}', 0)`,
      );
    } else {
      const { hash: rowHash } = row as any;
      invariant(rowHash === hash, "Inconsistent colleciton config found");
    }
  }

  async loadTasks(config: Record<string, any>) {
    await this.verifyAndInsertTask(
      "collection",
      config.collection.name,
      this.hash(config.collection),
    );

    config.tokens.forEach(async (token: any) => {
      await this.verifyAndInsertTask("token", token.name, this.hash(token));
    });
  }

  async ensureTasksTableExist() {
    // Minting has not started in the past. Let's create the minting tracking db
    const dbRun = util.promisify(this.db.run.bind(this.db));
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tasks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        hash TEXT,
        finished INTEGER
      )
    `);
  }

  async createTokenTask(token: any) {
    const dbGet = util.promisify(this.db.get.bind(this.db));
    const row: any = await dbGet(
      `SELECT finished FROM tasks where type = 'token' and name = '${token.name}'`,
    );

    if (row?.finished) {
      console.log(`Token "${token.name}" was created. Skip.`);
      return;
    }

    const [assetUri, hash] = await this.uploadOffChainMetaData(
      token.file_path,
      token,
    );

    const royaltyPayeeAccount =
      token.royalty_payee_account === undefined
        ? await this.createRoyaltyAccount({})
        : token.royalty_payee_account;

    // Let's put the asset hash into the token property map
    const propertyKeys = ["content_hash"];
    const propertyValues = [
      new TextDecoder().decode(BCS.bcsSerializeStr(hash)),
    ];
    const propertyTypes = ["vector<u8>"];

    await this.tokenClient.createToken(
      this.account,
      this.config.collection.name,
      token.name,
      token.description,
      token.supply,
      assetUri,
      token.supply,
      royaltyPayeeAccount,
      token.royalty_points_denominator,
      token.royalty_points_numerator,
      propertyKeys,
      propertyValues,
      propertyTypes,
    );

    const dbRun = util.promisify(this.db.run.bind(this.db));

    await dbRun(
      `UPDATE tasks set finished = 1 where type = 'token' and name = '${token.name}'`,
    );

    console.log(`Token "${token.name}" is minted. ${assetUri}`);
  }

  async createCollectionTask(collection: any) {
    const dbGet = util.promisify(this.db.get.bind(this.db));
    const row: any = await dbGet(
      `SELECT finished FROM tasks where type = 'collection' and name = '${collection.name}'`,
    );

    if (row?.finished) {
      console.log(`Collection "${collection.name}" was created. Skip.`);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [coverUri, hash] = await this.uploadOffChainMetaData(
      collection.file_path,
      collection,
    );

    const txnHash = await this.tokenClient.createCollection(
      this.account,
      collection.name,
      collection.description,
      coverUri,
      collection.maximum,
    );

    const txn = await this.client.waitForTransactionWithResult(txnHash, {
      timeoutSecs: 600,
    });
    if (!(txn as any)?.success) {
      console.error(`Failed to create collection. Transaction hash ${txnHash}`);
      return;
    }

    const dbRun = util.promisify(this.db.run.bind(this.db));

    await dbRun(
      `UPDATE tasks set finished = 1 where type = 'collection' and name = '${collection.name}'`,
    );

    console.log(`Collection "${collection.name}" is minted. ${coverUri}`);
  }

  // Run in parallel for a large number of assets
  async run() {
    const config = await this.validateProjectFolder();

    await this.ensureTasksTableExist();
    await this.loadTasks(config);

    // Create collection first
    await this.createCollectionTask(config.collection);

    // eslint-disable-next-line no-await-in-loop, no-restricted-syntax
    for (const token of config.tokens) {
      // eslint-disable-next-line no-await-in-loop
      await this.createTokenTask(token);
    }
  }

  async validateProjectFolder(): Promise<Record<string, any>> {
    invariant(
      fs.existsSync(path.join(this.projectPath, "config.json")),
      `config.json doesn't exist in ${this.projectPath}`,
    );

    const { config } = this;

    invariant(config?.collection?.name, "collection name cannot be empty");

    config?.collection?.tokens?.forEach((token: any) => {
      invariant(token?.name, "token name cannot be empty");
    });

    return config;
  }

  readProjectConfig(): any {
    const configBuf = fs.readFileSync(
      path.join(this.projectPath, "config.json"),
    );
    return JSON.parse(configBuf.toString("utf8"));
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
    return [this.createArweaveURLfromId(jsonId), this.hash(canonicalizedMeta)];
  }

  createArweaveURLfromId(dataId: string): string {
    return `https://arweave.net/${dataId}`;
  }
}
