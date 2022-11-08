import {
  CollectionConfig,
  CollectionData,
  RoyaltyConfig,
  Token
} from './token_types';
import { AptosAccount, AptosClient, HexString, TokenClient } from 'aptos';
import { parseAssetJson } from './input_parser';
import fs from 'fs';
import { AssetUploader } from './asset_uploader';
import { calculateContentHash } from './content_hash';

export class TokenMill {
  folderPath: string;
  account: AptosAccount;
  tokenClient: TokenClient;
  uploader: AssetUploader;

  constructor(
    path: string,
    account: AptosAccount,
    nodeURL: string,
    uploader: AssetUploader
  ) {
    this.folderPath = path;
    this.account = account;
    this.uploader = uploader;
    let client = new AptosClient(nodeURL);
    this.tokenClient = new TokenClient(client);
  }

  async run() {
    // construct asset json file path
    let assetJsonpath = `${this.folderPath}/asset.json`;
    let content = fs.readFileSync(assetJsonpath, 'utf8');
    this.validateAssetFolder();
    let config = this.parseAssetJson(content);
    let a = await this.createCollection(config.collectionData);
    for (const token of config.tokens) {
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
    let col_uri = await this.uploadOffChainMetaData(
      `${this.folderPath}/${collectionData.filePath}`,
      collectionData.assetMetadata
    );
    return this.tokenClient.createCollection(
      this.account,
      collectionData.name,
      collectionData.description,
      col_uri,
      collectionData.maximum
    );
  }

  async createToken(
    token: Token,
    collectionData: CollectionData
  ): Promise<string> {
    // create the content hash and construct the property map
    let fpath = `${this.folderPath}/${token.tokenData.filePath}`;

    let contentHash = calculateContentHash(fpath);
    // TODO construct property key with content hash
    let uri = await this.uploadOffChainMetaData(
      fpath,
      collectionData.assetMetadata
    );

    let royalty_payee_account =
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
      royalty_payee_account
    );
  }

  // create shared account for royalty
  // TODO: this should dedup if the creators and weights are same
  async createRoyaltyAccount(config: RoyaltyConfig): Promise<HexString> {
    return new HexString('0xcafe');
  }

  // construct the final json with URL and input config
  async uploadOffChainMetaData(
    assetPath: string,
    metaData: any
  ): Promise<string> {
    let dataId = await this.uploader.uploadFile(assetPath);
    let url = this.createArweaveURLfromId(dataId);

    // TODO: directly construct the metadata json based on file type
    metaData['image'] = url;
    fs.writeFileSync(`${assetPath}_test.json`, JSON.stringify(metaData));
    let jsonId = await this.uploader.uploadFile(`${assetPath}_test.json`);
    return this.createArweaveURLfromId(jsonId);
  }

  createArweaveURLfromId(dataId: string): string {
    // TODO add extension info to the URL such as ?ext=png
    return `https://arweave.net/${dataId}`;
  }
}
