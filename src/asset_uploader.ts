import Bundlr from '@bundlr-network/client';
import NodeBundlr from '@bundlr-network/client/build/node/bundlr';
import { AptosAccount } from 'aptos';
import BigNumber from 'bignumber.js';
import fs from 'fs';

export interface AssetUploader {
  provider: string;

  // Upload content to off-chain storage and return a link
  uploadFile(filePath: string): Promise<any>;
}

export class BundlrUploader implements AssetUploader {
  provider: string;
  bundlrUrl: string = 'https://devnet.bundlr.network';
  bundlr: NodeBundlr;
  account: AptosAccount;

  constructor(account: AptosAccount) {
    this.provider = 'bundlr';
    this.account = account;
    const signingFunction = async (msg: Uint8Array) => {
      return this.account.signBuffer(msg).toUint8Array();
    };

    this.bundlr = Bundlr.init({
      url: this.bundlrUrl,
      currency: 'aptos',
      publicKey: this.account.pubKey().toString(),
      signingFunction: signingFunction
    });
  }

  async uploadFile(filePath: string): Promise<string> {
    let res = await this.bundlr.uploadFile(filePath);
    return res.data.id;
  }

  async fund(amount: string) {
    await this.bundlr.fund(BigNumber(amount));
  }
}
