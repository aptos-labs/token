import { parseAssetJson } from '../input_parser';
import fs from 'fs';
import { TokenMill } from '../token_mill';
import { AptosAccount, FaucetClient, HexString } from 'aptos';
import { BundlrUploader } from '../asset_uploader';

test(
  'test generating nfts',
  async () => {
    let nodeUrl = 'https://fullnode.devnet.aptoslabs.com';
    let faucetUrl = 'https://faucet.devnet.aptoslabs.com';
    let private_key =
      '0x6A1ADE8CFD7CD489AC69260689A9CDC6FA4876CBF6131012F7CABA6C6C68FC76';
    const faucetClient = new FaucetClient(nodeUrl, faucetUrl);

    let alice = new AptosAccount(HexString.ensure(private_key).toUint8Array());
    console.log('test: ', alice.address());
    await faucetClient.fundAccount(alice.address(), 100_000_000);
    let uploader = new BundlrUploader(alice);
    await uploader.fund('10000000'); // fund 0.1 apt to bundlr
    const bundlr = await uploader.bundlrPromise;
    const balance = await bundlr.getLoadedBalance();
    console.log("Alice's bundlr balance: ", balance);
    let mill = new TokenMill(
      './src/test/test_folder',
      alice,
      nodeUrl,
      uploader
    );
    await mill.run();
  },
  60 * 1000
);
