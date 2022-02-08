import { Provider } from '@project-serum/anchor';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
    calculateMarkPrice,
    ClearingHouse,
    ClearingHouseUser,
    initialize,
    Markets,
    PositionDirection,
    convertToNumber,
    calculateTradeSlippage,
    MARK_PRICE_PRECISION,
    QUOTE_PRECISION,
    BN
} from '@drift-labs/sdk';

import Wallet_ from "@project-serum/anchor/dist/cjs/nodewallet.js";

export const getTokenAddress = (
    mintAddress: string,
    userPubkey: string,
): Promise<PublicKey> => {
    return Token.getAssociatedTokenAddress(
        new PublicKey(`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`),
        TOKEN_PROGRAM_ID,
        new PublicKey(mintAddress),
        new PublicKey(userPubkey)
    );
}

export const main = async () => {
    const Wallet = Wallet_["default"];

    const sdkConfig = initialize({ env: 'devnet' });

    const privateKey = process.env.BOT_PRIVATE_KEY; // stored as an array string
    const keypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKey))
    );
    
    const wallet = new Wallet(keypair);

    const rpcAddress = process.env.RPC_ADDRESS;
    const connection = new Connection(rpcAddress);

    const provider = new Provider(connection, wallet, Provider.defaultOptions());

    const lamportsBalance = await connection.getBalance(wallet.publicKey);
    console.log('SOL balance:', lamportsBalance / 10 ** 9);

    const usdcTokenAddress = await getTokenAddress(
        sdkConfig.USDC_MINT_ADDRESS,
        wallet.publicKey.toString()
    );

    const clearingHousePublicKey = new PublicKey(
        sdkConfig.CLEARING_HOUSE_PROGRAM_ID
    );
    const clearingHouse = ClearingHouse.from(
        connection,
        provider.wallet,
        clearingHousePublicKey
    );
    await clearingHouse.subscribe();

    const user = ClearingHouseUser.from(clearingHouse, wallet.publicKey);

    const userAccountExists = await user.exists();

    if (!userAccountExists) {
        const depositAmount = new BN(10000).mul(QUOTE_PRECISION);
        await clearingHouse.initializeUserAccountAndDepositCollateral(
            depositAmount,
            await getTokenAddress(
                usdcTokenAddress.toString(),
                wallet.publicKey.toString()
            )
        );
    }

    await user.subscribe();

    const solMarketInfo = Markets.find(
        (market) => market.baseAssetSymbol === 'SOL'
    );

    const currentMarketPrice = calculateMarkPrice(
        clearingHouse.getMarket(solMarketInfo.marketIndex),
    );

    const formattedPrice = convertToNumber(currentMarketPrice, QUOTE_PRECISION);

    console.log(`Current Market Price is $${ formattedPrice }`);

    const solMarketAccount = clearingHouse.getMarket(solMarketInfo.marketIndex);

    const slippage = convertToNumber(
        calculateTradeSlippage(
            PositionDirection.LONG,
            new BN(5000).mul(QUOTE_PRECISION),
            solMarketAccount,
        )[0],
        MARK_PRICE_PRECISION
    );

    console.log(`Slippage for a $5000 LONG on the SOL market would be $${ slippage }`);

    await clearingHouse.openPosition(
        PositionDirection.LONG,
        new BN(5000).mul(QUOTE_PRECISION),
        solMarketInfo.marketIndex,
    );
    console.log(`Longed $5000 worth of SOL`);
    await clearingHouse.openPosition(
        PositionDirection.SHORT,
        new BN(2000).mul(QUOTE_PRECISION),
        solMarketInfo.marketIndex,
    );

    await clearingHouse.closePosition(solMarketInfo.marketIndex);
};