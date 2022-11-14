import { AptosAccount, FaucetClient } from 'aptos';
import { BundlrUploader } from '../asset_uploader';

test(
  'test bundlr upload',
  async () => {
    let nodeUrl = 'https://fullnode.devnet.aptoslabs.com';
    let faucetUrl = 'https://faucet.devnet.aptoslabs.com';
    const faucetClient = new FaucetClient(nodeUrl, faucetUrl);
    let alice = new AptosAccount();
    await faucetClient.fundAccount(alice.address(), 100_000_000);

    let node = new BundlrUploader(alice);
    await node.fund('10000000'); // fund 0.1 apt to bundlr
    const bundlr = await node.bundlrPromise;
    const balance = await bundlr.getLoadedBalance();
    const converted = bundlr.utils.unitConverter(balance);
    let res = await node.uploadFile('./src/test/test_folder/asset.json');
    expect(res !== undefined);
  },
  60 * 1000
);
