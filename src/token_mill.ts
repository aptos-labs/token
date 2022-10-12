import {CollectionConfig, CollectionData, RoyaltyConfig, Token} from "./token_types";
import {AptosAccount, TokenClient, TxnBuilderTypes} from "aptos";
import {parseAssetJson} from "./input_parser";
import fs from "fs";
import {bytesToHex} from "@noble/hashes/utils";

export class TokenMill {
    folderPath: string;
    account: AptosAccount;
    tokenClient: TokenClient;
    uploader: AssetUploader;


    constructor(path: string, account: AptosAccount) {
        this.folderPath = path;
        this.account = account;
    }

    async run() {
        // construct asset json file path
        let assetJsonpath = `${this.folderPath}/asset.json`;
        let content = fs.readFileSync(assetJsonpath,'utf8');
        this.validateAssetFolder();
        let config = this.parseAssetJson(content);
        await this.createCollection(config.collectionData);
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
        // upload the asset file and obtain first URL
        let url = this.uploader.uploadFile(`${this.folderPath}/${collectionData.filePath}`);

        // construct the json file and upload it to obtain uri
        // TODO: directly construct the metadata json based on file type
        let jsonMetadata = this.getMetaDataJson(url, collectionData.assetMetadata);
        let col_uri = this.uploader.uploadContent(jsonMetadata);
        return this.tokenClient.createCollection(
            this.account,
            collectionData.name,
            collectionData.description,
            col_uri,
            collectionData.maximum,
        );
    }

    createToken(token: Token, collectionData: CollectionData) {
        // create the content hash and construct the property map
        let contentHash = this.uploader.calculateContentHash(`${this.folderPath}/${token.tokenData.filePath}`);

        // upload the asset file and obtain first URL
        let url = this.uploader.uploadFile(`${this.folderPath}/${token.tokenData.filePath}`);

        // construct the json file and upload it to obtain uri
        // TODO: directly construct the metadata json based on file type
        let jsonMetadata = this.getMetaDataJson(url, token.tokenData.assetMetadata);
        let uri = this.uploader.uploadContent(jsonMetadata);
        let royalty_payee_account: TxnBuilderTypes.AccountAddress = token.tokenData.royaltyPayeeAccount === undefined ? this.createRoyaltyAccount(token.tokenData.royaltyWeights): token.tokenData.royaltyPayeeAccount;
        return this.tokenClient.createToken(
            this.account,
            collectionData.name,
            token.tokenData.name,
            token.tokenData.description,
            token.tokenData.supply,
            uri,
            token.tokenData.maximum,
            bytesToHex(royalty_payee_account.address),
        );
    }

    // create shared account for royalty
    // TODO: this should dedup if the creators and weights are same
    createRoyaltyAccount(config: RoyaltyConfig): TxnBuilderTypes.AccountAddress{
        return TxnBuilderTypes.AccountAddress.fromHex("0xcafe");
    }

    // construct the final json with URL and input config
    getMetaDataJson(url: string, input_config: any): string {
        return "";
    }
}