import { Provider } from '@project-serum/anchor';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
    calculateMarkPrice,
    ClearingHouse,
    ClearingHouseUser,
    initialize,
    Market,
    Markets,
    PositionDirection,
    convertToNumber,
    calculateTradeSlippage,
    MARK_PRICE_PRECISION,
    QUOTE_PRECISION,
    BN
} from '@drift-labs/sdk';

import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import * as bunyan from "bunyan";
import Decimal from "decimal.js";

export class Drift {
    private readonly log = bunyan.createLogger({ name: "drift" });
    private clearingHouse: ClearingHouse;
    private user: ClearingHouseUser;
    private market: Market;
    private marketIndex: BN;

    public async setup() {
        const sdkConfig = initialize({ env: 'devnet' });
        const privateKey = process.env.BOT_PRIVATE_KEY; // stored as an array string
        const keypair = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(privateKey))
        );
        
        const wallet = new Wallet(keypair);
        const rpcAddress = process.env.RPC_ADDRESS;
        const connection = new Connection(rpcAddress);
        const provider = new Provider(connection, wallet, Provider.defaultOptions());
        const clearingHousePublicKey = new PublicKey(
            sdkConfig.CLEARING_HOUSE_PROGRAM_ID
        );
        this.clearingHouse = ClearingHouse.from(
            connection,
            provider.wallet,
            clearingHousePublicKey
        );

        this.user = ClearingHouseUser.from(this.clearingHouse, wallet.publicKey);

        const usdcTokenAddress = await this.getTokenAddress(
            sdkConfig.USDC_MINT_ADDRESS,
            wallet.publicKey.toString()
        );
        const userAccountExists = await this.user.exists();
    
        if (!userAccountExists) {
            const depositAmount = new BN(process.env.USDC_MINIMUM).mul(QUOTE_PRECISION);
            await this.clearingHouse.initializeUserAccountAndDepositCollateral(
                depositAmount,
                usdcTokenAddress
            );
        }
    
        await this.user.subscribe();

        const marketInfo = Markets.find(
            (market) => market.baseAssetSymbol === process.env.MARKET
        ); 
        this.marketIndex = marketInfo.marketIndex;

        this.market = this.clearingHouse.getMarket(marketInfo.marketIndex);
    }

    getTokenAddress = (
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

    async placeTrade(side: PositionDirection, amount: BN, baseAssetSymbol: string, entryPrice: BN): Promise<void> {

        const marketInfo = Markets.find(
            (market) => market.baseAssetSymbol === baseAssetSymbol
        );

        await this.clearingHouse.openPosition(
            side, 
            amount,
            marketInfo.marketIndex,
            entryPrice
        );
    }

    async getMarketPrice() {
        this.market = this.clearingHouse.getMarket(this.marketIndex);
        return convertToNumber(calculateMarkPrice(this.market), MARK_PRICE_PRECISION);
    }
}

export interface DriftAccountInfo {
    freeCollateral: Decimal,
    totalAccountValue: Decimal,
    marginFraction: Decimal,
    positions: DriftPositionInfo[],
}

export interface DriftPositionInfo {
    market: string,
    netSize: Decimal,
    entryPrice: Decimal,
    realizedPnl: Decimal,
    cost: Decimal,
}

export interface DriftMarketInfo {
    baseAssetSymbol: string,
    currentPrice: Decimal,
    bestAsk: Decimal,
    bestBid: Decimal,
    lastUpdated: BN
}