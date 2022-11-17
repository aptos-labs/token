module mint_nft::minting {
    use std::signer;
    use std::string::String;
    use std::vector;

    use aptos_framework::account::SignerCapability;
    use aptos_framework::event::EventHandle;
    use aptos_std::bucket_table::BucketTable;
    use aptos_token::token::{TokenDataId, TokenMutabilityConfig, CollectionMutabilityConfig};

    struct NFTMintConfig has key, store {
        admin: address,
        treasury: address,
        siger_cap: SignerCapability,
        token_config: TokenConfig,
        public_mint_config: PublicMintConfig,
        whitelist_mint_config: WhitelistMintConfig,
        token_minting_events: EventHandle<TokenMintingEvent>,
    }

    struct TokenConfig has store {
        collection_name: String,
        collection_description: String,
        collection_mutate_config: CollectionMutabilityConfig,
        token_name_base: String, // this is base name, when minting, we can generate actual token name as token_name_base with some sequence number
        royalty_payee_address: address,
        token_description: String,
        token_maximum: u64,
        token_uri: vector<String>,
        token_mutate_config: TokenMutabilityConfig,
        royalty_points_den: u64,
        royalty_points_num: u64,
        property_keys: vector<String>,
        property_values: vector<vector<u8>>,
        property_types: vector<String>,
    }

    struct WhitelistMintConfig has store {
        whitelisted_address: BucketTable<address, u64>,
        whitelist_mint_price: u64,
        whitelist_minting_start_time: u64,
        whitelist_minting_end_time: u64,
    }

    struct PublicMintConfig has store {
        mint_price: u64,
        minting_start_time: u64,
        minting_end_time: u64,
    }

    struct TokenMintingEvent has drop, store {
        token_receiver_address: address,
        token_data_id: vector<TokenDataId>,
    }

    fun init_module(
        resource_account: &signer
    ) {}

    // the initial admin account will be the source account (which created the resource account);
    // the source account can update the NFTMintConfig struct
    public fun set_nft_mint_config(
        source: &signer,
        admin_address: address,
        treasury_address: address,
        collection_name: String,
        collection_description: String,
        collection_mutate_config: vector<bool>,
        token_name_base: String,
        royalty_payee_address: address,
        token_description: String,
        token_maximum: u64,
        token_mutate_config: vector<bool>,
        royalty_points_den: u64,
        royalty_points_num: u64,
    ) {}

    public fun set_whitelist_minting_time_and_price(
        admin: &signer,
        start_time: u64,
        end_time: u64,
        wl_price: u64
    ) {}

    public fun set_public_minting_time_and_price(
        admin: &signer,
        start_time: u64,
        end_time: u64,
        price: u64
    ) {}

    public fun add_to_whitelist(
        admin: &signer,
        wl_addresses: vector<address>,
        mint_limit: u64
    ) {}

    public fun add_token_uri(
        admin: &signer,
        token_uri: vector<String>,
        property_keys: vector<String>,
        property_values: vector<vector<u8>>,
        property_types: vector<String>
    ) {}

    public fun mint_nft(
        nft_claimer: &signer,
        amount: u64
    ) {}

    // this will return a signer of the resource account
    public fun acquire_resource_signer(
        admin: &signer
    ): signer {}
}
