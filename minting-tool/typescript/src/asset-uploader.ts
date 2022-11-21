import Bundlr from "@bundlr-network/client";
import NodeBundlr from "@bundlr-network/client/build/node/bundlr";
import { AptosAccount } from "aptos";
import BigNumber from "bignumber.js";

export const BUNDLR_URL = "https://devnet.bundlr.network";
export const APTOS_FULL_NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";

export interface AssetUploader {
  provider: string;

  // Upload content to off-chain storage and return a link
  uploadFile(filePath: string): Promise<any>;
}

export class BundlrUploader implements AssetUploader {
  provider: string;

  bundlrPromise: Promise<NodeBundlr>;

  account: AptosAccount;

  constructor(
    account: AptosAccount,
    config: {
      bundlrUrl: string;
      aptosFullNodeUrl: string;
    } = {
      bundlrUrl: BUNDLR_URL,
      aptosFullNodeUrl: APTOS_FULL_NODE_URL,
    },
  ) {
    this.provider = "bundlr";
    this.account = account;
    const signingFunction = async (msg: Uint8Array) =>
      this.account.signBuffer(msg).toUint8Array();

    this.bundlrPromise = Bundlr.init({
      url: config.bundlrUrl,
      providerUrl: config.aptosFullNodeUrl,
      currency: "aptos",
      publicKey: this.account.pubKey().toString(),
      signingFunction,
    });
  }

  async uploadFile(filePath: string): Promise<string> {
    const bundlr = await this.bundlrPromise;

    const res = await bundlr.uploadFile(filePath);
    return res.id;
  }

  async fund(amount: string) {
    const bundlr = await this.bundlrPromise;
    await bundlr.fund(BigNumber(amount));
  }
}
