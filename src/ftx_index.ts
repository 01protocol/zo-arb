import { Keypair, Transaction } from "@solana/web3.js";
import { initialize, PositionDirection, DriftEnv } from "@drift-labs/sdk";
import { ZoArbClient } from "./zo";
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";
import { getTime } from "./utils";
import { Instruction } from "@drift-labs/sdk/node_modules/@project-serum/anchor";
import { FtxArbClient } from "./Ftx";
import { sleep } from "@zero_one/client";

require("dotenv").config();

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

export const runFtxDiffBot = async () => {

    const privateKey = PRIVATE_KEY;
    const keypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKey))
    );
    const wallet = new Wallet(keypair);

    const ftxArbClient = new FtxArbClient();
    await ftxArbClient.init();

    const zoArbClient = new ZoArbClient(wallet);
    await zoArbClient.init();

    while (true) {

        await zoArbClient.refresh();
        const zoAsk = await zoArbClient.getTopAsk();
        const zoBid = await zoArbClient.getTopBid();

        await ftxArbClient.refresh();
        const ftxBid = ftxArbClient.getBid().toNumber();
        const ftxAsk = ftxArbClient.getAsk().toNumber();

        //console.log(`01: ${zoBid}//${zoAsk}, FTX: ${ftxBid}//${ftxAsk}`);
        const ftxLongDiff = -(ftxAsk - zoBid) / ftxAsk * 100;
        const ftxShortDiff = -(zoAsk - ftxBid) / ftxBid * 100;

        console.log(
            `Buy FTX Sell 01 Diff ${process.env.MARKET}: ${ftxLongDiff.toFixed(
                4
            )}%. // Buy 01 Sell FTX Diff ${process.env.MARKET
            }: ${ftxShortDiff.toFixed(4)}%.`
        );

        let canOpenZoLong = await zoArbClient.getCanOpenLong();
        let canOpenZoShort = await zoArbClient.getCanOpenShort();

        // open drift long zo short
        // if short is maxed out, try to lower threshold to close the short open more long.
        let ftxLongThreshold = canOpenZoShort ? THRESHOLD : 1.0 * THRESHOLD;
        if (ftxLongDiff > ftxLongThreshold) {
            if (!canOpenZoLong) {
                console.log(
                    `Letting this opportunity go due to 01 long exposure is > $${MAX_POSITION_SIZE}`
                );
                continue;
            }

            const quantity =
                Math.trunc(
                    (100 * POSITION_SIZE_USD) / ftxAsk
                ) / 100;
            const usdcQuantity = quantity * ftxAsk;

            console.log(
                "===================================================================="
            );
            console.log(
                `SELL ${usdcQuantity} worth of ${process.env.MARKET} on 01 at price ~$${zoBid}`
            );
            console.log(
                `LONG ${usdcQuantity} worth of ${process.env.MARKET} on FTX at price ~$${ftxAsk}`
            );
            console.log(
                `Capturing ~${ftxLongDiff.toFixed(
                    4
                )}% profit (01 fees & slippage not included)`
            );

            try {
                await zoArbClient.sendAndConfirmIx(await zoArbClient.marketShortIx(
                    POSITION_SIZE_USD,
                    zoBid,
                    POSITION_SIZE_USD / ftxAsk
                )).catch((t) => {
                    console.log(
                        "Transaction didn't go through, may due to low balance...",
                        t
                    );
                });  /* 
            await zoArbClient.marketShort(
                POSITION_SIZE_USD,
                zoBid,
                POSITION_SIZE_USD / ftxAsk
            ); */
                await ftxArbClient.placeOrder(
                    {
                        market: process.env.FTX_MARKET,
                        side: "buy",
                        price: null,
                        size: quantity,
                        type: "market",
                    }
                )
            } catch (t) {
                console.log(
                    "Transaction didn't go through, may due to low balance...",
                    t
                );
            };
        }

        // open zo short ftx long
        // if long is maxed out, try to lower threshold to close the long by more short.
        let driftShortThreshold = canOpenZoLong ? THRESHOLD : 1.0 * THRESHOLD;
        if (ftxShortDiff > driftShortThreshold) {
            if (!canOpenZoShort) {
                console.log(
                    `Letting this opportunity go due to 01 short exposure is > $${MAX_POSITION_SIZE}`
                );
                continue;
            }

            // zo rounds down to nearest multiple of 0.01
            const quantity =
                Math.trunc(
                    (100 * POSITION_SIZE_USD) / ftxBid
                ) / 100;
            const usdcQuantity = quantity * ftxBid;

            console.log(
                "===================================================================="
            );
            console.log(
                `SELL ${usdcQuantity} worth of ${process.env.MARKET} on FTX at price ~$${ftxBid}`
            );
            console.log(
                `LONG ${usdcQuantity} worth of ${process.env.MARKET} on 01 at price ~$${zoAsk}`
            );
            console.log(
                `Capturing ~${ftxShortDiff.toFixed(
                    4
                )}% profit (zo fees & slippage not included)`
            );

            try {
                if (!await zoArbClient
                    .sendAndConfirmIx(await zoArbClient.marketLongIx(
                        POSITION_SIZE_USD,
                        zoAsk,
                        POSITION_SIZE_USD / ftxBid
                    ))) {
                        throw new Error("01 Transaction didn't go through");
                    };
                
                await ftxArbClient.placeOrder(
                    {
                        market: process.env.FTX_MARKET,
                        side: "sell",
                        price: null,
                        size: quantity,
                        type: "market",
                    }
                );
            } catch (t) {
                console.log(
                    "Transaction didn't go through, may due to low balance...",
                    t
                );
            };
        }
        await sleep(400);
    }

};
