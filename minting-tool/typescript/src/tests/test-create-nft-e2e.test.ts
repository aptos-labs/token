/* eslint-disable no-console */
import { AptosAccount, FaucetClient, HexString } from "aptos";
import { TokenMill } from "../token-mill";
import { BundlrUploader } from "../asset-uploader";

test(
  "test generating nfts",
  async () => {
    const nodeUrl = "https://fullnode.devnet.aptoslabs.com";
    const faucetUrl = "https://faucet.devnet.aptoslabs.com";
    const privateKey =
      "0x6A1ADE8CFD7CD489AC69260689A9CDC6FA4876CBF6131012F7CABA6C6C68FC76";
    const faucetClient = new FaucetClient(nodeUrl, faucetUrl);

    const alice = new AptosAccount(HexString.ensure(privateKey).toUint8Array());
    console.log("test: ", alice.address());
    await faucetClient.fundAccount(alice.address(), 100_000_000);
    const uploader = new BundlrUploader(alice);
    await uploader.fund("10000000"); // fund 0.1 apt to bundlr
    const bundlr = await uploader.bundlrPromise;
    const balance = await bundlr.getLoadedBalance();
    console.log("Alice's bundlr balance: ", balance);
    const mill = new TokenMill("./src/tests/assets", alice, nodeUrl, uploader);
    await mill.run();
  },
  60 * 1000,
);
