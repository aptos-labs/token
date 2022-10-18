
# TokenShop Requirements

## Interactive UI for Entering Asset Info

Through Cli prompts to generate `asset.json` in the asset folder

## Creating NFT Metadata from Asset Files

1. Read from a fold with asset files and asset.json
2. Parse the asset.json
3. loop through all the entries in the asset.json
   1. uploader uploads the asset file to bundlr
   2. compute the content hash of the asset file
   3. check if there are multiple creators in Royalty
      1. yes, create a shared account module on the user's account with creators and their weights, use that account as royalty payee account
      2. no, use the user's account as royalty payee account
4. upload all txn arguments to created resource account

## Mint NFTs on Demand

* Buyer can pay a price to mint token from the collection with an unknown imageUrl. To get unknown imageUrl, use a timestamp hash to get corresponding image index on the uploaded image.
* Token shop maintains a status of an image. If it is already claimed, it automatically samples the next image for token creation
* Allow discount on whitelist

## Control Access
Provide a list of options rules that restrict the access.
If there are multiple rules applies, we use the and of different rules

* provide a Cli for signing off-chain proof containing, eg: whitelisted account addresses
* Provide a start and end time for accessing the mint

## Reporting

Report MetaData uploaded and deployed to resource account

## Failure Recovery

Resume the work from failed item

