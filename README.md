# Token Tooling

## Aptos NFT mint tool

The Aptos Non-Fungible Token (NFT) Minting Tool includes a CLI, a mint contract, and a template minting site that aim to lower the barriers for NFT creators to launch NFTs on Aptos. Currently, supported features include:

- Paying storage services with APTs. The Aptos NFT mint tool uploads NFT assets to Arweave through the [Bundlr](https://bundlr.network/) service. Bundlr makes it easy for creators to pay for the storage with APTs.
- Presale support through whitelisted addresses.
- Randomizing NFT mint order to reduce the impact of the rarity sniping tool.
- Supporting large-scale collections. The tool uploads assets in parallel and prepares the NFTs data in batches.
- Tracking progresses in a local DB

For details about using the tool see: [https://aptos.dev/concepts/coin-and-token/nft-minting-tool/](https://aptos.dev/concepts/coin-and-token/nft-minting-tool/)
