module nft_social::social_creator {
    use std::string;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// NFT Social simplificado
    public struct NFTSOCIAL has key, store {
        id: UID,
        creator_name: string::String,
        creator_handle: string::String,
        xp: u64,
        level: u8
    }

    /// Capability para admin
    public struct AdminCap has key {
        id: UID
    }

    /// Inicialização
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) }, 
            tx_context::sender(ctx)
        )
    }

    /// Criar NFT
    public entry fun mint_social_nft(
        _admin: &AdminCap,
        creator_name: vector<u8>,
        creator_handle: vector<u8>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let nft = NFTSOCIAL {
            id: object::new(ctx),
            creator_name: string::utf8(creator_name),
            creator_handle: string::utf8(creator_handle),
            xp: 0,
            level: 1
        };

        transfer::public_transfer(nft, recipient)
    }

    /// Adicionar XP
    public entry fun add_xp(
        nft: &mut NFTSOCIAL,
        xp_amount: u64,
        _ctx: &mut TxContext
    ) {
        nft.xp = nft.xp + xp_amount;
        if (nft.xp >= 100) { nft.level = 2 };
        if (nft.xp >= 500) { nft.level = 3 };
        if (nft.xp >= 1000) { nft.level = 4 };
    }

    // Getters básicos
    public fun get_xp(nft: &NFTSOCIAL): u64 { nft.xp }
    public fun get_level(nft: &NFTSOCIAL): u8 { nft.level }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}