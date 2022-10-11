# Token Batch Creation Tool

1. Read from a fold with asset files and asset.json
2. Parse the asset.json
3. loop through all the entries in the asset.json
   1. uploader uploads the asset file to bundlr
   2. compute the content hash of the asset file
   3. check if there are multiple creators in Royalty
      1. yes, create a shared account module on the user's account with creators and their weights, use that account as royalty payee account
      2. no, use the user's account as royalty payee account
   4. generate the txn argument, create transaction payload, submit transaction

# TODO
deploy contracts to batch create NFTs in one TXN.