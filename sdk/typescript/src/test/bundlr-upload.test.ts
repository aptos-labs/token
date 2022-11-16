import { AptosAccount, FaucetClient } from "aptos";
import { BundlrUploader } from "../asset-uploader";

test(
  "test bundlr upload",
  async () => {
    const nodeUrl = "https://fullnode.devnet.aptoslabs.com";
    const faucetUrl = "https://faucet.devnet.aptoslabs.com";
    const faucetClient = new FaucetClient(nodeUrl, faucetUrl);
    const alice = new AptosAccount();
    await faucetClient.fundAccount(alice.address(), 100_000_000);

    const node = new BundlrUploader(alice);
    await node.fund("10000000"); // fund 0.1 apt to bundlr
    const res = await node.uploadFile("./src/test/assets/asset.json");
    expect(res !== undefined);
  },
  60 * 1000,
);
