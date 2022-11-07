import { parseAssetJson } from '../input_parser';
import fs from 'fs';
import { AptosAccount, AptosClient, CoinClient, FaucetClient } from 'aptos';
import { TokenMill } from '../token_mill';
import { BundlrUploader } from '../asset_uploader';
import Bundlr from '@bundlr-network/client';
import BigNumber from 'bignumber.js';

test(
  'test bundlr upload',
  async () => {
    let nodeUrl = 'https://fullnode.devnet.aptoslabs.com';
    let faucetUrl = 'https://faucet.devnet.aptoslabs.com';
    const faucetClient = new FaucetClient(nodeUrl, faucetUrl);
    let alice = new AptosAccount();
    await faucetClient.fundAccount(alice.address(), 900_000_000);

    let node = new BundlrUploader(alice);
    await node.fund('10000000'); // fund 0.1 apt to bundlr
    const balance = await node.bundlr.getLoadedBalance();
    const converted = node.bundlr.utils.unitConverter(balance);
    let res = await node.uploadFile('./src/test/test_folder/asset.json');
    expect(res !== undefined);
  },
  60 * 1000
);
