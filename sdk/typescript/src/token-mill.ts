import { AptosAccount, AptosClient, HexString, TokenClient } from "aptos";
import fs from "fs";
import {
  CollectionConfig,
  CollectionData,
  RoyaltyConfig,
  Token,
} from "./token-types";
import { parseAssetJson } from "./input-parser";
import { AssetUploader } from "./asset-uploader";
// import { calculateContentHash } from "./content-hash";

export class TokenMill {
  folderPath: string;

  account: AptosAccount;

  tokenClient: TokenClient;

  uploader: AssetUploader;

  constructor(
    path: string,
    account: AptosAccount,
    nodeURL: string,
    uploader: AssetUploader,
  ) {
    this.folderPath = path;
    this.account = account;
    this.uploader = uploader;
    const client = new AptosClient(nodeURL);
    this.tokenClient = new TokenClient(client);
  }

  async run() {
    // construct asset json file path
    const assetJsonpath = `${this.folderPath}/asset.json`;
    const content = fs.readFileSync(assetJsonpath, "utf8");
    this.validateAssetFolder();
    const config = this.parseAssetJson(content);
    // eslint-disable-next-line no-restricted-syntax
    for (const token of config.tokens) {
      // eslint-disable-next-line no-await-in-loop
      await this.createToken(token, config.collectionData);
    }
  }

  // provide detailed and actionable error message on the asset folde format error
  validateAssetFolder() {
    // TODO validate the input json file
    return true;
  }

  parseAssetJson(content: string): CollectionConfig {
    return parseAssetJson(content);
  }

  async createCollection(collectionData: CollectionData): Promise<string> {
    const colUri = await this.uploadOffChainMetaData(
      `${this.folderPath}/${collectionData.filePath}`,
      JSON.parse(collectionData.assetMetadata),
    );
    return this.tokenClient.createCollection(
      this.account,
      collectionData.name,
      collectionData.description,
      colUri,
      collectionData.maximum,
    );
  }

  async createToken(
    token: Token,
    collectionData: CollectionData,
  ): Promise<string> {
    // create the content hash and construct the property map
    const fpath = `${this.folderPath}/${token.tokenData.filePath}`;

    // const contentHash = calculateContentHash(fpath);
    // TODO construct property key with content hash
    const uri = await this.uploadOffChainMetaData(
      fpath,
      JSON.parse(collectionData.assetMetadata),
    );

    const royaltyPayeeAccount =
      token.tokenData.royaltyPayeeAccount === undefined
        ? await this.createRoyaltyAccount(token.tokenData.royaltyWeights)
        : token.tokenData.royaltyPayeeAccount;
    return this.tokenClient.createToken(
      this.account,
      collectionData.name,
      token.tokenData.name,
      token.tokenData.description,
      token.tokenData.supply,
      uri,
      token.tokenData.maximum,
      royaltyPayeeAccount,
    );
  }

  // create shared account for royalty
  // TODO: this should dedup if the creators and weights are same
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createRoyaltyAccount(config: RoyaltyConfig): Promise<HexString> {
    return new HexString("0xcafe");
  }

  // construct the final json with URL and input config
  async uploadOffChainMetaData(
    assetPath: string,
    metaData: { [key: string]: any },
  ): Promise<string> {
    const dataId = await this.uploader.uploadFile(assetPath);
    const url = this.createArweaveURLfromId(dataId);

    // TODO: directly construct the metadata json based on file type
    const meta = { ...metaData, image: url };
    fs.writeFileSync(`${assetPath}_test.json`, JSON.stringify(meta));
    const jsonId = await this.uploader.uploadFile(`${assetPath}_test.json`);
    return this.createArweaveURLfromId(jsonId);
  }

  createArweaveURLfromId(dataId: string): string {
    // TODO add extension info to the URL such as ?ext=png
    return `https://arweave.net/${dataId}`;
  }
}
