import { Provider } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
    BN,
    calculateMarkPrice,
    ClearingHouse,
    initialize,
    Markets,
    PositionDirection,
    convertToNumber,
    calculateTradeSlippage,
    MARK_PRICE_PRECISION,
    QUOTE_PRECISION,
    DriftEnv, ClearingHouseUser,
} from '@drift-labs/sdk';
import { ZoArbClient } from './zo';
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";


require('dotenv').config();

// % differences between markets to initiate a position.
// higher is likely more profitable but less opportunities
// at drift long it's comparing to (zo short price - drift long price) / drift long price * 100
// at rift short it's comparing (drift short price - zo long price) / zo long price * 100
// TODO: MAKE IT DYNAMIC
const THRESHOLD = parseFloat(process.env.THRESHOLD);

// size for each position, there could be multiple positions until price is within threshold
const POSITION_SIZE_USD = parseFloat(process.env.POSITION_SIZE_USD);

// Max position size before going reduce only mode (+/- POSITION_SIZE_USD)
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE);

// Private key array
// Please read from file system or environment...
// Also have it setup & deposit money into it via Phantom.
// You can import the array into Phantom as private key string.
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// RPC address, please don't use public ones.
const RPC_ADDRESS = process.env.RPC_ADDRESS;

export const main = async () => {
    const sdkConfig = initialize({ env: 'mainnet-beta' as DriftEnv });

    // Set up the Wallet and Provider
    const privateKey = PRIVATE_KEY
    const keypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKey))
    );
    const wallet = new Wallet(keypair);

    // Set up the Connection
    const connection = new Connection(RPC_ADDRESS);

    // Set up the Provider
    const provider = new Provider(connection, wallet,
        {
            commitment: 'confirmed',
            skipPreflight: false,
        });

    // Set up zo
    const zoArbClient = new ZoArbClient(wallet);
    await zoArbClient.init();


    // Set up the Drift Clearing House
    const clearingHousePublicKey = new PublicKey(
        sdkConfig.CLEARING_HOUSE_PROGRAM_ID
    );

    const clearingHouse = ClearingHouse.from(
        connection,
        provider.wallet,
        clearingHousePublicKey
    );

    await clearingHouse.subscribe();

    const solMarketInfo = Markets.find(
        (market) => market.baseAssetSymbol === process.env.MARKET
    );
    const solMarketAccount = clearingHouse.getMarket(solMarketInfo.marketIndex);

    // set up drift user
    // Set up Clearing House user client
    const user = ClearingHouseUser.from(clearingHouse, wallet.publicKey);
    await user.subscribe();

    let priceInfo = {
        longEntry: 0,
        shortEntry: 0
    }

    clearingHouse.eventEmitter.addListener('marketsAccountUpdate', async (d) => {
        const formattedPrice = convertToNumber(calculateMarkPrice(d['markets'][0]), MARK_PRICE_PRECISION);

        let longSlippage = convertToNumber(
            calculateTradeSlippage(
                PositionDirection.LONG,
                new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
                solMarketAccount
            )[0],
            MARK_PRICE_PRECISION
        );

        let shortSlippage = convertToNumber(
            calculateTradeSlippage(
                PositionDirection.SHORT,
                new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
                solMarketAccount
            )[0],
            MARK_PRICE_PRECISION
        );

        priceInfo.longEntry = formattedPrice * (1 + longSlippage)
        priceInfo.shortEntry = formattedPrice * (1 - shortSlippage)
    })

    async function getCanOpenDriftShort() {
        if (user.getPositionSide(user.getUserPosition(solMarketInfo.marketIndex)) == PositionDirection.LONG) {
            return true
        }
        return (convertToNumber(user.getPositionValue(solMarketInfo.marketIndex), QUOTE_PRECISION) < MAX_POSITION_SIZE)
    }

    async function getCanOpenDriftLong() {
        if (user.getPositionSide(user.getUserPosition(solMarketInfo.marketIndex)) == PositionDirection.SHORT) {
            return true
        }
        return (convertToNumber(user.getPositionValue(solMarketInfo.marketIndex), QUOTE_PRECISION) < MAX_POSITION_SIZE)
    }


    async function mainLoop() {
        if (!priceInfo.shortEntry || !priceInfo.longEntry) {
            return
        }

        const zoBid = await zoArbClient.getTopBid()
        const zoAsk = await zoArbClient.getTopAsk()

        const driftShortDiff = (priceInfo.shortEntry - zoAsk) / zoAsk * 100
        const driftLongDiff = (zoBid - priceInfo.longEntry) / priceInfo.longEntry * 100

        console.log(`Buy Drift Sell 01 Diff: ${driftLongDiff.toFixed(4)}%. // Buy 01 Sell Drift Diff: ${driftShortDiff.toFixed(4)}%.`)

        let canOpenDriftLong = await getCanOpenDriftLong()
        let canOpenDriftShort = await getCanOpenDriftShort()

        // open drift long zo short
        // if short is maxed out, try to lower threshold to close the short open more long.
        let driftLongThreshold = canOpenDriftShort ? THRESHOLD : (1.0 * THRESHOLD)
        if (driftLongDiff > driftLongThreshold) {
            if (!canOpenDriftLong) {
                console.log(`Letting this opportunity go due to Drift long exposure is > $${MAX_POSITION_SIZE}`)
                return
            }

            const quantity = Math.trunc(100 * POSITION_SIZE_USD / priceInfo.longEntry) / 100;
            const usdcQuantity = quantity * priceInfo.longEntry;
            console.log(`Quantity: ${quantity}, usdc: ${usdcQuantity}`);

            console.log("====================================================================")
            console.log(`SELL ${usdcQuantity} worth of SOL on 01 at price ~$${zoBid}`);
            console.log(`LONG ${usdcQuantity} worth of SOL on Drift at price ~$${priceInfo.longEntry}`);
            console.log(`Capturing ~${driftLongDiff.toFixed(4)}% profit (01 fees & slippage not included)`);

            const txn = wrapInTx(await clearingHouse.getOpenPositionIx(
                PositionDirection.LONG,
                new BN(usdcQuantity).mul(QUOTE_PRECISION),
                solMarketInfo.marketIndex
            ));

            txn.add(await zoArbClient.marketShort(POSITION_SIZE_USD, zoBid, POSITION_SIZE_USD / priceInfo.longEntry))
            await clearingHouse.txSender.send(txn, [], clearingHouse.opts).catch(t => {
                console.log("Transaction didn't go through, may due to low balance...", t)
            });
        }

        // open zo short drift long
        // if long is maxed out, try to lower threshold to close the long by more short.
        let driftShortThreshold = canOpenDriftLong ? THRESHOLD : (1.0 * THRESHOLD)
        if (driftShortDiff > driftShortThreshold) {
            if (!canOpenDriftShort) {
                console.log(`Letting this opportunity go due to Drift short exposure is > $${MAX_POSITION_SIZE}`)
                return
            }

            // zo rounds down to nearest multiple of 0.01
            const quantity = Math.trunc(100 * POSITION_SIZE_USD / priceInfo.shortEntry) / 100;
            const usdcQuantity = quantity * priceInfo.shortEntry;
            console.log(`Quantity: ${quantity}, usdc: ${usdcQuantity}`);

            console.log("====================================================================")
            console.log(`SELL ${usdcQuantity} worth of SOL on Drift at price ~$${priceInfo.shortEntry}`);
            console.log(`LONG ${usdcQuantity} worth of SOL on zo at price ~$${zoAsk}`);
            console.log(`Capturing ~${driftShortDiff.toFixed(4)}% profit (zo fees & slippage not included)`);

            const txn = wrapInTx(await clearingHouse.getOpenPositionIx(
                PositionDirection.SHORT,
                new BN(usdcQuantity).mul(QUOTE_PRECISION),
                solMarketInfo.marketIndex
            ));
            txn.add(await zoArbClient.marketLong(POSITION_SIZE_USD, zoAsk, POSITION_SIZE_USD / priceInfo.shortEntry))
            await clearingHouse.txSender.send(txn, [], clearingHouse.opts).catch(t => {
                console.log("Transaction didn't go through, may due to low balance...", t)
            });
        }
    }
    setInterval(mainLoop, 4000)
}
