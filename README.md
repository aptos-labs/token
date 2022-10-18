# Requirements

## Interactive UI for Entering Asset Info

Through Cli prompts to generate `asset.json` in the asset folder

## Creating NFT directly from Asset Files

1. Read from a fold with asset files and asset.json
2. Parse the asset.json
3. loop through all the entries in the asset.json
   1. uploader uploads the asset file to bundlr
   2. compute the content hash of the asset file
   3. check if there are multiple creators in Royalty
      1. yes, create a shared account module on the user's account with creators and their weights, use that account as royalty payee account
      2. no, use the user's account as royalty payee account
   4. generate the txn argument, create transaction payload, submit transaction

## Listing NFTs from their Own Accounts

Implement the entry functions to support listing, canceling listing at user account

Call deployed marketplace utils to generate listing at users’ own account

## Control Access

Provide a Cli for signing off-chain proof. By default, no access control for buying NFT

## Reporting

Report NFT created, listed in users’ own account

## Failure Recovery

Resume the work from failed item

# TODO

- gas optimization deploy contracts to batch create NFTs in one TXN
- support auction at user account
- website with basic UI for creator to create their own NFT shop