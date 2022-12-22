module mint_nft::minting {
    use std::error;
    use std::signer;
    use std::string::{Self, String, utf8};
    use std::vector;

    use aptos_framework::account::{Self, SignerCapability, create_signer_with_capability};
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::coin;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::resource_account;
    use aptos_framework::timestamp;
    use aptos_token::token::{Self, TokenMutabilityConfig, create_token_mutability_config, create_collection, create_tokendata, TokenId};
    use mint_nft::big_vector::{Self, BigVector};
    use mint_nft::bucket_table::{Self, BucketTable};

    struct NFTMintConfig has key {
        admin: address,
        treasury: address,
        signer_cap: SignerCapability,
        token_minting_events: EventHandle<NFTMintMintingEvent>,
    }

    struct CollectionConfig has key {
        collection_name: String,
        collection_description: String,
        collection_maximum: u64,
        collection_uri: String,
        collection_mutate_config: vector<bool>,
        // this is base name, when minting, we will generate the actual token name as `token_name_base: sequence number`
        token_name_base: String,
        token_counter: u64,
        royalty_payee_address: address,
        token_description: String,
        token_maximum: u64,
        token_mutate_config: TokenMutabilityConfig,
        royalty_points_den: u64,
        royalty_points_num: u64,
        tokens: BigVector<TokenAsset>,
        // Here, we use a bucket table as a set to check duplicates.
        // The `key` is the uri of the token asset and values are all `true`.
        added_tokens: BucketTable<String, bool>,
        public_mint_limit_per_address: u64,
    }

    struct TokenAsset has drop, store {
        token_uri: String,
        property_keys: vector<String>,
        property_values: vector<vector<u8>>,
        property_types: vector<String>,
    }

    struct WhitelistMintConfig has key {
        whitelisted_address: BucketTable<address, u64>,
        whitelist_mint_price: u64,
        whitelist_minting_start_time: u64,
        whitelist_minting_end_time: u64,
    }

    struct PublicMintConfig has key {
        public_minting_addresses: BucketTable<address, u64>,
        public_mint_price: u64,
        public_minting_start_time: u64,
        public_minting_end_time: u64,
    }

    struct NFTMintMintingEvent has drop, store {
        token_receiver_address: address,
        token_id: TokenId,
    }

    const ENOT_AUTHORIZED: u64 = 1;
    const EINVALID_TIME: u64 = 2;
    const EACCOUNT_DOES_NOT_EXIST: u64 = 3;
    const EVECTOR_LENGTH_UNMATCHED: u64 = 4;
    const EEXCEEDS_COLLECTION_MAXIMUM: u64 = 5;
    const EINVALID_PRICE: u64 = 6;
    const EINVALID_UPDATE_AFTER_MINTING: u64 = 7;
    const EMINTING_IS_NOT_ENABLED: u64 = 8;
    const ENO_ENOUGH_TOKENS_LEFT: u64 = 9;
    const EACCOUNT_NOT_WHITELISTED: u64 = 10;
    const EINVALID_ROYALTY_NUMERATOR_DENOMINATOR: u64 = 11;
    const ECOLLECTION_ALREADY_CREATED: u64 = 12;
    const ECONFIG_NOT_INITIALIZED: u64 = 13;
    const EAMOUNT_EXCEEDS_MINTS_ALLOWED: u64 = 14;
    const EDUPLICATED_TOKENS: u64 = 15;

    fun init_module(resource_account: &signer) {
        let resource_signer_cap = resource_account::retrieve_resource_account_cap(resource_account, @source_addr);
        move_to(resource_account, NFTMintConfig {
            admin: @source_addr,
            treasury: @source_addr,
            signer_cap: resource_signer_cap,
            token_minting_events: account::new_event_handle<NFTMintMintingEvent>(resource_account),
        });
    }

    public entry fun set_admin(admin: &signer, new_admin_address: address) acquires NFTMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));
        nft_mint_config.admin = new_admin_address;
    }

    public entry fun set_treasury(admin: &signer, new_treasury_address: address) acquires NFTMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));
        nft_mint_config.treasury = new_treasury_address;
    }

    // the initial admin account will be the source account (which created the resource account);
    // the source account can update the NFTMintConfig struct
    public entry fun set_collection_config_and_create_collection(
        admin: &signer,
        collection_name: String,
        collection_description: String,
        collection_maximum: u64,
        collection_uri: String,
        collection_mutate_config: vector<bool>,
        token_name_base: String,
        royalty_payee_address: address,
        token_description: String,
        token_maximum: u64,
        token_mutate_config: vector<bool>,
        royalty_points_den: u64,
        royalty_points_num: u64,
        public_mint_limit_per_address: u64,
    ) acquires NFTMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));

        assert!(vector::length(&collection_mutate_config) == 3 && vector::length(&token_mutate_config) == 5, error::invalid_argument(EVECTOR_LENGTH_UNMATCHED));
        assert!(royalty_points_den > 0 && royalty_points_num < royalty_points_den, error::invalid_argument(EINVALID_ROYALTY_NUMERATOR_DENOMINATOR));
        assert!(!exists<CollectionConfig>(@mint_nft), error::permission_denied(ECOLLECTION_ALREADY_CREATED));

        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        let resource_account = create_signer_with_capability(&nft_mint_config.signer_cap);
        move_to(&resource_account, CollectionConfig {
            collection_name,
            collection_description,
            collection_maximum,
            collection_uri,
            collection_mutate_config,
            token_name_base,
            token_counter: 1,
            royalty_payee_address,
            token_description,
            token_maximum,
            token_mutate_config: create_token_mutability_config(&token_mutate_config),
            royalty_points_den,
            royalty_points_num,
            tokens: big_vector::new<TokenAsset>(128),
            added_tokens: bucket_table::new<String, bool>(128),
            // value 0 means that there's no limit
            public_mint_limit_per_address,
        });

        let resource_signer = create_signer_with_capability(&nft_mint_config.signer_cap);
        create_collection(&resource_signer, collection_name, collection_description, collection_uri, collection_maximum, collection_mutate_config);
    }

    public entry fun set_minting_time_and_price(
        admin: &signer,
        whitelist_minting_start_time: u64,
        whitelist_minting_end_time: u64,
        whitelist_mint_price: u64,
        public_minting_start_time: u64,
        public_minting_end_time: u64,
        public_mint_price: u64,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));

        let now = timestamp::now_seconds();
        // assert that we are setting the whitelist time to sometime in the future
        assert!(whitelist_minting_start_time > now && whitelist_minting_start_time < whitelist_minting_end_time, error::invalid_argument(EINVALID_TIME));
        // assert that the public minting starts after the whitelist minting ends
        assert!(public_minting_start_time > whitelist_minting_end_time && public_minting_start_time < public_minting_end_time, error::invalid_argument(EINVALID_TIME));
        // assert that the public minting price is equal or more expensive than the whitelist minting price
        assert!(public_mint_price >= whitelist_mint_price, error::invalid_argument(EINVALID_PRICE));

        if (exists<WhitelistMintConfig>(@mint_nft)) {
            let whitelist_mint_config = borrow_global_mut<WhitelistMintConfig>(@mint_nft);
            whitelist_mint_config.whitelist_minting_start_time = whitelist_minting_start_time;
            whitelist_mint_config.whitelist_minting_end_time = whitelist_minting_end_time;
            whitelist_mint_config.whitelist_mint_price = whitelist_mint_price;
        } else {
            let resource_account = create_signer_with_capability(&nft_mint_config.signer_cap);
            move_to(&resource_account, WhitelistMintConfig {
                whitelisted_address: bucket_table::new<address, u64>(8),
                whitelist_minting_start_time,
                whitelist_minting_end_time,
                whitelist_mint_price,
            });
        };

        if (exists<PublicMintConfig>(@mint_nft)) {
            let public_mint_config = borrow_global_mut<PublicMintConfig>(@mint_nft);
            public_mint_config.public_minting_start_time = public_minting_start_time;
            public_mint_config.public_minting_end_time = public_minting_end_time;
            public_mint_config.public_mint_price = public_mint_price;
        } else {
            let resource_account = create_signer_with_capability(&nft_mint_config.signer_cap);
            move_to(&resource_account, PublicMintConfig {
                public_minting_addresses: bucket_table::new<address, u64>(8),
                public_minting_start_time,
                public_minting_end_time,
                public_mint_price,
            });
        };
    }

    public entry fun add_to_whitelist(
        admin: &signer,
        wl_addresses: vector<address>,
        mint_limit: u64
    ) acquires NFTMintConfig, WhitelistMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));
        assert!(exists<WhitelistMintConfig>(@mint_nft), error::permission_denied(ECONFIG_NOT_INITIALIZED));
        // cannot update whitelisted addresses if the whitelist minting period has already passed
        let whitelist_mint_config = borrow_global_mut<WhitelistMintConfig>(@mint_nft);
        assert!(whitelist_mint_config.whitelist_minting_end_time > timestamp::now_seconds(), error::permission_denied(EINVALID_UPDATE_AFTER_MINTING));

        let i = 0;
        while (i < vector::length(&wl_addresses)) {
            let addr = *vector::borrow(&wl_addresses, i);
            // assert that the specified address exists
            assert!(account::exists_at(addr), error::invalid_argument(EACCOUNT_DOES_NOT_EXIST));
            bucket_table::add(&mut whitelist_mint_config.whitelisted_address, addr, mint_limit);
            i = i + 1;
        };
    }

    public entry fun add_tokens(
        admin: &signer,
        token_uris: vector<String>,
        property_keys: vector<vector<String>>,
        property_values: vector<vector<vector<u8>>>,
        property_types: vector<vector<String>>
    ) acquires NFTMintConfig, CollectionConfig, WhitelistMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));

        // cannot add more token uris if the public minting has already ended
        assert!(exists<WhitelistMintConfig>(@mint_nft), error::permission_denied(ECONFIG_NOT_INITIALIZED));
        let whitelist_mint_config = borrow_global_mut<WhitelistMintConfig>(@mint_nft);
        assert!(whitelist_mint_config.whitelist_minting_start_time > timestamp::now_seconds(), error::permission_denied(EINVALID_UPDATE_AFTER_MINTING));

        assert!(exists<CollectionConfig>(@mint_nft), error::permission_denied(ECONFIG_NOT_INITIALIZED));
        assert!(vector::length(&token_uris) == vector::length(&property_keys) && vector::length(&property_keys) == vector::length(&property_values) && vector::length(&property_values) == vector::length(&property_types), error::invalid_argument(EVECTOR_LENGTH_UNMATCHED));
        let collection_config = borrow_global_mut<CollectionConfig>(@mint_nft);

        assert!(vector::length(&token_uris) + big_vector::length(&collection_config.tokens) <= collection_config.collection_maximum || collection_config.collection_maximum == 0, error::invalid_argument(EEXCEEDS_COLLECTION_MAXIMUM));
        let i = 0;
        while (i < vector::length(&token_uris)) {
            let token_uri = vector::borrow(&token_uris, i);
            assert!(!bucket_table::contains(&collection_config.added_tokens, token_uri), error::invalid_argument(EDUPLICATED_TOKENS));
            big_vector::push_back(&mut collection_config.tokens, TokenAsset {
                token_uri: *token_uri,
                property_keys: *vector::borrow(&property_keys, i),
                property_values: *vector::borrow(&property_values, i),
                property_types: *vector::borrow(&property_types, i),
            });
            bucket_table::add(&mut collection_config.added_tokens, *token_uri, true);
            i = i + 1;
        };
    }

    public entry fun mint_nft(
        nft_claimer: &signer,
        amount: u64
    ) acquires NFTMintConfig, PublicMintConfig, WhitelistMintConfig, CollectionConfig {
        assert!(exists<CollectionConfig>(@mint_nft) && exists<WhitelistMintConfig>(@mint_nft) && exists<PublicMintConfig>(@mint_nft), error::permission_denied(ECONFIG_NOT_INITIALIZED));

        let collection_config = borrow_global<CollectionConfig>(@mint_nft);
        let whitelist_mint_config = borrow_global_mut<WhitelistMintConfig>(@mint_nft);
        let public_mint_config = borrow_global_mut<PublicMintConfig>(@mint_nft);

        let now = timestamp::now_seconds();
        let is_whitelist_minting_time = now > whitelist_mint_config.whitelist_minting_start_time && now < whitelist_mint_config.whitelist_minting_end_time;
        let is_public_minting_time = now > public_mint_config.public_minting_start_time && now < public_mint_config.public_minting_end_time;
        assert!(is_whitelist_minting_time || is_public_minting_time, error::permission_denied(EMINTING_IS_NOT_ENABLED));
        let token_uri_length = big_vector::length(&collection_config.tokens);
        assert!(amount <= token_uri_length, error::invalid_argument(ENO_ENOUGH_TOKENS_LEFT));

        let price = public_mint_config.public_mint_price;
        let claimer_addr = signer::address_of(nft_claimer);
        // if this is the whitelist minting time
        if (is_whitelist_minting_time) {
            assert!(bucket_table::contains(&whitelist_mint_config.whitelisted_address, &claimer_addr), error::permission_denied(EACCOUNT_NOT_WHITELISTED));
            let remaining_mint_allowed = bucket_table::borrow_mut(&mut whitelist_mint_config.whitelisted_address, claimer_addr);
            assert!(*remaining_mint_allowed >= amount, error::invalid_argument(EAMOUNT_EXCEEDS_MINTS_ALLOWED));
            *remaining_mint_allowed = *remaining_mint_allowed - amount;
            price = whitelist_mint_config.whitelist_mint_price;
        } else {
            if (collection_config.public_mint_limit_per_address != 0) {
                // If the claimer's address is not on the public_minting_addresses table yet, it means this is the
                // first time that this claimer mints. We will add the claimer's address and remaining amount of mints
                // to the public_minting_addresses table.
                if (!bucket_table::contains(&public_mint_config.public_minting_addresses, &claimer_addr)) {
                    bucket_table::add(&mut public_mint_config.public_minting_addresses, claimer_addr, collection_config.public_mint_limit_per_address);
                };
                let limit = bucket_table::borrow_mut(&mut public_mint_config.public_minting_addresses, claimer_addr);
                assert!(amount <= *limit, error::invalid_argument(EAMOUNT_EXCEEDS_MINTS_ALLOWED));
                *limit = *limit - amount;
            };
        };
        mint(nft_claimer, price, amount);
    }

    public fun acquire_resource_signer(
        admin: &signer
    ): signer acquires NFTMintConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        assert!(signer::address_of(admin) == nft_mint_config.admin, error::permission_denied(ENOT_AUTHORIZED));
        create_signer_with_capability(&nft_mint_config.signer_cap)
    }

    // ======================================================================
    //   private helper functions //
    // ======================================================================

    fun mint(nft_claimer: &signer, price: u64, amount: u64) acquires NFTMintConfig, CollectionConfig {
        let nft_mint_config = borrow_global_mut<NFTMintConfig>(@mint_nft);
        let collection_config = borrow_global_mut<CollectionConfig>(@mint_nft);
        // assert there's still some tokens in the vector
        assert!(big_vector::length(&collection_config.tokens) >= amount, error::resource_exhausted(ENO_ENOUGH_TOKENS_LEFT));

        coin::transfer<AptosCoin>(nft_claimer, nft_mint_config.treasury, price * amount);
        let token_name = collection_config.token_name_base;
        string::append_utf8(&mut token_name, b": ");

        let resource_signer = create_signer_with_capability(&nft_mint_config.signer_cap);

        while(amount > 0) {
            let now = timestamp::now_microseconds();
            let index = now % big_vector::length(&collection_config.tokens);
            let bucket_index = big_vector::bucket_index(&collection_config.tokens, index);
            let token = big_vector::swap_remove(&mut collection_config.tokens, &bucket_index);

            let curr_token_name = token_name;
            let num = u64_to_string(collection_config.token_counter);
            string::append(&mut curr_token_name, num);

            let token_data_id = create_tokendata(
                &resource_signer,
                collection_config.collection_name,
                curr_token_name,
                collection_config.token_description,
                collection_config.token_maximum,
                token.token_uri,
                collection_config.royalty_payee_address,
                collection_config.royalty_points_den,
                collection_config.royalty_points_num,
                collection_config.token_mutate_config,
                token.property_keys,
                token.property_values,
                token.property_types,
            );

            let token_id = token::mint_token(&resource_signer, token_data_id, 1);
            token::direct_transfer(&resource_signer, nft_claimer, token_id, 1);

            collection_config.token_counter = collection_config.token_counter + 1;

            event::emit_event<NFTMintMintingEvent>(
                &mut nft_mint_config.token_minting_events,
                NFTMintMintingEvent {
                    token_receiver_address: signer::address_of(nft_claimer),
                    token_id,
                }
            );
            amount = amount - 1;
        };
    }

    fun u64_to_string(value: u64): String {
        if (value == 0) {
            return utf8(b"0")
        };
        let buffer = vector::empty<u8>();
        while (value != 0) {
            vector::push_back(&mut buffer, ((48 + value % 10) as u8));
            value = value / 10;
        };
        vector::reverse(&mut buffer);
        utf8(buffer)
    }

    // ======================================================================
    //   unit tests //
    // ======================================================================

    #[test_only]
    public fun set_up_test(
        source_account: &signer,
        resource_account: &signer,
        admin_account: &signer,
        wl_nft_claimer: &signer,
        public_nft_claimer: &signer,
        treasury_account: &signer,
        aptos_framework: &signer,
        timestamp: u64,
        collection_maximum: u64,
    ) acquires NFTMintConfig {
        use aptos_framework::account::create_account_for_test;

        // set up global time for testing purpose
        timestamp::set_time_has_started_for_testing(aptos_framework);
        timestamp::update_global_time_for_test_secs(timestamp);

        create_account_for_test(signer::address_of(source_account));
        // create a resource account from the origin account, mocking the module publishing process
        resource_account::create_resource_account(source_account, vector::empty<u8>(), vector::empty<u8>());
        init_module(resource_account);

        create_account_for_test(signer::address_of(wl_nft_claimer));
        create_account_for_test(signer::address_of(public_nft_claimer));
        create_account_for_test(signer::address_of(admin_account));
        create_account_for_test(signer::address_of(treasury_account));

        let (burn_cap, mint_cap) = aptos_framework::aptos_coin::initialize_for_test(aptos_framework);
        coin::register<AptosCoin>(wl_nft_claimer);
        coin::register<AptosCoin>(public_nft_claimer);
        coin::register<AptosCoin>(treasury_account);
        coin::deposit(signer::address_of(wl_nft_claimer), coin::mint(100, &mint_cap));
        coin::deposit(signer::address_of(public_nft_claimer), coin::mint(100, &mint_cap));

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);

        let colleciton_setting = vector<bool>[false, false, false];
        let token_setting = vector<bool>[false, false, false, false, false];
        set_collection_config_and_create_collection(
            source_account,
            utf8(b"test collection"),
            utf8(b"test collection description"),
            collection_maximum,
            utf8(b"test collection uri"),
            colleciton_setting,
            utf8(b"base token name"),
            signer::address_of(treasury_account),
            utf8(b"token description"),
            0,
            token_setting,
            1,
            0,
            2,
        );

        set_admin(source_account, signer::address_of(admin_account));
        set_treasury(admin_account, signer::address_of(treasury_account));
    }

    #[test_only]
    public entry fun set_up_token_uris(admin_account: &signer) acquires NFTMintConfig, CollectionConfig, WhitelistMintConfig {
        let token_uris = vector::empty<String>();
        let property_keys = vector::empty<vector<String>>();
        let property_values = vector::empty<vector<vector<u8>>>();
        let property_types = vector::empty<vector<String>>();
        let i = 0;
        while (i < 3) {
            let token_uri = utf8(b"token uri");
            string::append(&mut token_uri, u64_to_string(i));

            vector::push_back(&mut token_uris, token_uri);
            vector::push_back(&mut property_keys, vector::empty<String>());
            vector::push_back(&mut property_values, vector::empty<vector<u8>>());
            vector::push_back(&mut property_types, vector::empty<String>());
            i = i + 1;
        };
        add_tokens(admin_account, token_uris, property_keys, property_values, property_types);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    public entry fun test_happy_path(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);

        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        let wl_addresses = vector::empty<address>();
        vector::push_back(&mut wl_addresses, signer::address_of(&wl_nft_claimer));
        add_to_whitelist(&admin_account, wl_addresses, 2);
        set_up_token_uris(&admin_account);

        timestamp::fast_forward_seconds(50);
        mint_nft(&wl_nft_claimer, 2);

        timestamp::fast_forward_seconds(160);
        mint_nft(&public_nft_claimer, 1);

        let token_id1 = token::create_token_id_raw(signer::address_of(&resource_account), utf8(b"test collection"), utf8(b"base token name: 1"), 0);
        let token_id2 = token::create_token_id_raw(signer::address_of(&resource_account), utf8(b"test collection"), utf8(b"base token name: 2"), 0);
        let token_id3 = token::create_token_id_raw(signer::address_of(&resource_account), utf8(b"test collection"), utf8(b"base token name: 3"), 0);
        let minted_token1 = token::withdraw_token(&wl_nft_claimer, token_id1, 1);
        let minted_token2 = token::withdraw_token(&wl_nft_claimer, token_id2, 1);
        let minted_token3 = token::withdraw_token(&public_nft_claimer, token_id3, 1);
        token::deposit_token(&wl_nft_claimer, minted_token1);
        token::deposit_token(&wl_nft_claimer, minted_token2);
        token::deposit_token(&public_nft_claimer, minted_token3);

        let whitelist_mint_config = borrow_global_mut<WhitelistMintConfig>(@mint_nft);
        assert!(*bucket_table::borrow(&mut whitelist_mint_config.whitelisted_address, signer::address_of(&wl_nft_claimer)) == 0, 0);
        let public_mint_config = borrow_global_mut<PublicMintConfig>(@mint_nft);
        assert!(*bucket_table::borrow(&mut public_mint_config.public_minting_addresses, signer::address_of(&public_nft_claimer)) == 1, 1);

        assert!(coin::balance<AptosCoin>(signer::address_of(&treasury_account))== 20, 1);
        assert!(coin::balance<AptosCoin>(signer::address_of(&wl_nft_claimer))== 90, 2);
        assert!(coin::balance<AptosCoin>(signer::address_of(&public_nft_claimer))== 90, 3);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x50001)]
    public entry fun invalid_set_admin_address(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_admin(&source_account, signer::address_of(&treasury_account));
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x50001)]
    public entry fun invalid_set_treasury_address(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_treasury(&source_account, signer::address_of(&treasury_account));
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x50001)]
    public entry fun invalid_set_minting_time_and_price(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&source_account, 50, 200, 5, 150, 400, 10);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x10002)]
    public entry fun test_invalid_time(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 150, 400, 10);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x10005)]
    public entry fun test_adding_token_uris_exceeds_collection_maximum(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 2);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        set_up_token_uris(&admin_account);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x5000d)]
    public entry fun test_mint_before_set_up(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        mint_nft(&wl_nft_claimer, 2);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x1000e)]
    public entry fun test_amount_exceeds_mint_allowed_whitelist(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        let wl_addresses = vector::empty<address>();
        vector::push_back(&mut wl_addresses, signer::address_of(&wl_nft_claimer));
        add_to_whitelist(&admin_account, wl_addresses, 2);
        set_up_token_uris(&admin_account);
        timestamp::fast_forward_seconds(50);
        mint_nft(&wl_nft_claimer, 3);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x1000e)]
    public entry fun test_amount_exceeds_mint_allowed_public(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        let wl_addresses = vector::empty<address>();
        vector::push_back(&mut wl_addresses, signer::address_of(&wl_nft_claimer));
        add_to_whitelist(&admin_account, wl_addresses, 2);
        set_up_token_uris(&admin_account);
        timestamp::fast_forward_seconds(250);
        mint_nft(&public_nft_claimer, 3);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x5000a)]
    public entry fun test_account_not_on_whitelist(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        let wl_addresses = vector::empty<address>();
        add_to_whitelist(&admin_account, wl_addresses, 2);
        set_up_token_uris(&admin_account);
        timestamp::fast_forward_seconds(50);
        mint_nft(&public_nft_claimer, 2);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    public entry fun test_update_minting_time(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        set_minting_time_and_price(&admin_account, 60, 300, 10, 400, 600, 50);

        let whitelist_minting_config = borrow_global_mut<WhitelistMintConfig>(@mint_nft);
        assert!(whitelist_minting_config.whitelist_minting_start_time == 60, 0);
        assert!(whitelist_minting_config.whitelist_minting_end_time == 300, 1);
        assert!(whitelist_minting_config.whitelist_mint_price == 10, 2);

        let public_minting_config = borrow_global_mut<PublicMintConfig>(@mint_nft);
        assert!(public_minting_config.public_minting_start_time == 400, 3);
        assert!(public_minting_config.public_minting_end_time == 600, 4);
        assert!(public_minting_config.public_mint_price == 50, 5);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x50007)]
    public entry fun invalid_add_to_whitelist(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        timestamp::fast_forward_seconds(200);
        let wl_addresses = vector::empty<address>();
        vector::push_back(&mut wl_addresses, signer::address_of(&wl_nft_claimer));
        add_to_whitelist(&admin_account, wl_addresses, 2);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x10009)]
    public entry fun test_all_tokens_minted(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        let wl_addresses = vector::empty<address>();
        vector::push_back(&mut wl_addresses, signer::address_of(&wl_nft_claimer));
        add_to_whitelist(&admin_account, wl_addresses, 2);
        set_up_token_uris(&admin_account);

        timestamp::fast_forward_seconds(50);
        mint_nft(&wl_nft_claimer, 2);

        timestamp::fast_forward_seconds(160);
        mint_nft(&public_nft_claimer, 2);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x10004)]
    public entry fun test_invalid_add_token_uri(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, WhitelistMintConfig, PublicMintConfig, CollectionConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        let wl_addresses = vector::empty<address>();
        vector::push_back(&mut wl_addresses, signer::address_of(&wl_nft_claimer));
        add_to_whitelist(&admin_account, wl_addresses, 2);
        let token_uris = vector::empty<String>();
        let property_keys = vector::empty<vector<String>>();
        let property_values = vector::empty<vector<vector<u8>>>();
        let property_types = vector::empty<vector<String>>();
        let i = 0;
        while (i < 3) {
            vector::push_back(&mut token_uris, utf8(b"token uri"));
            vector::push_back(&mut property_keys, vector::empty<String>());
            vector::push_back(&mut property_values, vector::empty<vector<u8>>());
            i = i + 1;
        };
        add_tokens(&admin_account, token_uris, property_keys, property_values, property_types);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    public entry fun test_acquire_signer(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        let resource_signer = acquire_resource_signer(&admin_account);
        assert!(signer::address_of(&resource_signer) == signer::address_of(&resource_account), 0);
    }

    #[test (source_account = @0xcafe, resource_account = @0xc3bb8488ab1a5815a9d543d7e41b0e0df46a7396f89b22821f07a4362f75ddc5, admin_account = @0x456, wl_nft_claimer = @0x123, public_nft_claimer = @0x234, treasury_account = @0x345, aptos_framework = @aptos_framework)]
    #[expected_failure(abort_code = 0x1000f)]
    public entry fun test_add_duplicated_tokens(
        source_account: signer,
        resource_account: signer,
        admin_account: signer,
        wl_nft_claimer: signer,
        public_nft_claimer: signer,
        treasury_account: signer,
        aptos_framework: signer,
    ) acquires NFTMintConfig, CollectionConfig, WhitelistMintConfig, PublicMintConfig {
        set_up_test(&source_account, &resource_account, &admin_account, &wl_nft_claimer, &public_nft_claimer, &treasury_account, &aptos_framework, 10, 0);
        set_minting_time_and_price(&admin_account, 50, 200, 5, 201, 400, 10);
        set_up_token_uris(&admin_account);
        set_up_token_uris(&admin_account);
    }
}
