Make sure you have created an account in Aptos testnet. You also need to fund the test account some coins with the testnet faucet.

Go to the `minting-tool/typescript` folder

Fund the storage service 0.1 APT
`yarn cli fund --private-key xxxxx --amount 10000000`

Create a project
`yarn cli init --asset-path ./src/tests/assets --name awesome-nft`

Mint the project
`yarn cli mint --private-key xxxxx --project-path ./awesome-nft`
