import { Keypair } from "@solana/web3.js";
import { DriftEnv, initialize, PositionDirection } from "@drift-labs/sdk";
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";
import { DriftArbClient } from "../clients/Drift";
import { ZoArbClient } from "../clients/Zo";

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

// RPC address, please don't use public ones.
const RPC_ADDRESS = process.env.RPC_ADDRESS;

export const runDriftPriceArb = async () => {
  const sdkConfig = initialize({ env: "mainnet-beta" as DriftEnv });

  // Set up the Wallet and Provider
  const privateKey = PRIVATE_KEY;
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(privateKey))
  );
  const wallet = new Wallet(keypair);

  const driftArbClient = new DriftArbClient();
  await driftArbClient.init(wallet);

  const zoArbClient = new ZoArbClient(wallet);
  await zoArbClient.init();

  async function mainLoop() {
    if (
      !driftArbClient.priceInfo.shortEntry ||
      !driftArbClient.priceInfo.longEntry
    ) {
      return;
    }

    const zoBid = await zoArbClient.getTopAsk(); // WAHT
    const zoAsk = await zoArbClient.getTopBid(); // WAHT

    const driftShortDiff =
      ((driftArbClient.priceInfo.shortEntry - zoAsk) / zoAsk) * 100;
    const driftLongDiff =
      ((zoBid - driftArbClient.priceInfo.longEntry) /
        driftArbClient.priceInfo.longEntry) *
      100;

    console.log(
      `Buy Drift Sell 01 Diff ${process.env.MARKET}: ${driftLongDiff.toFixed(
        4
      )}%. // Buy 01 Sell Drift Diff ${
        process.env.MARKET
      }: ${driftShortDiff.toFixed(4)}%.`
    );

    let canOpenDriftLong = await driftArbClient.getCanOpenLong();
    let canOpenDriftShort = await driftArbClient.getCanOpenShort();

    // open drift long zo short
    // if short is maxed out, try to lower threshold to close the short open more long.
    let driftLongThreshold = canOpenDriftShort ? THRESHOLD : 1.0 * THRESHOLD;
    if (driftLongDiff > driftLongThreshold) {
      if (!canOpenDriftLong) {
        console.log(
          `Letting this opportunity go due to Drift long exposure is > $${MAX_POSITION_SIZE}`
        );
        return;
      }

      const quantity =
        Math.trunc(
          (100 * POSITION_SIZE_USD) / driftArbClient.priceInfo.longEntry
        ) / 100;
      const usdcQuantity = quantity * driftArbClient.priceInfo.longEntry;
      console.log(`Quantity: ${quantity}, usdc: ${usdcQuantity}`);

      console.log(
        "===================================================================="
      );
      console.log(
        `SELL ${usdcQuantity} worth of ${process.env.MARKET} on 01 at price ~$${zoBid}`
      );
      console.log(
        `LONG ${usdcQuantity} worth of ${process.env.MARKET} on Drift at price ~$${driftArbClient.priceInfo.longEntry}`
      );
      console.log(
        `Capturing ~${driftLongDiff.toFixed(
          4
        )}% profit (01 fees & slippage not included)`
      );

      const txn = wrapInTx(
        await driftArbClient.getOpenPositionIx(
          PositionDirection.LONG,
          usdcQuantity
        )
      );

      txn.add(
        await zoArbClient.marketShortIx(
          POSITION_SIZE_USD,
          zoBid,
          POSITION_SIZE_USD / driftArbClient.priceInfo.longEntry
        )
      );
      await driftArbClient
        .sendTx(txn, [], driftArbClient.getOpts())
        .catch((t) => {
          console.log(
            "Transaction didn't go through, may due to low balance...",
            t
          );
        });
    }

    // open zo short drift long
    // if long is maxed out, try to lower threshold to close the long by more short.
    let driftShortThreshold = canOpenDriftLong ? THRESHOLD : 1.0 * THRESHOLD;
    if (driftShortDiff > driftShortThreshold) {
      if (!canOpenDriftShort) {
        console.log(
          `Letting this opportunity go due to Drift short exposure is > $${MAX_POSITION_SIZE}`
        );
        return;
      }

      // zo rounds down to nearest multiple of 0.01
      const quantity =
        Math.trunc(
          (100 * POSITION_SIZE_USD) / driftArbClient.priceInfo.shortEntry
        ) / 100;
      const usdcQuantity = quantity * driftArbClient.priceInfo.shortEntry;

      console.log(
        "===================================================================="
      );
      console.log(
        `SELL ${usdcQuantity} worth of ${process.env.MARKET} on Drift at price ~$${driftArbClient.priceInfo.shortEntry}`
      );
      console.log(
        `LONG ${usdcQuantity} worth of ${process.env.MARKET} on zo at price ~$${zoAsk}`
      );
      console.log(
        `Capturing ~${driftShortDiff.toFixed(
          4
        )}% profit (zo fees & slippage not included)`
      );

      const txn = wrapInTx(
        await driftArbClient.getOpenPositionIx(
          PositionDirection.SHORT,
          usdcQuantity
        )
      );
      txn.add(
        await zoArbClient.marketLongIx(
          POSITION_SIZE_USD,
          zoAsk,
          POSITION_SIZE_USD / driftArbClient.priceInfo.shortEntry
        )
      );
      await driftArbClient
        .sendTx(txn, [], driftArbClient.getOpts())
        .catch((t) => {
          console.log(
            "Transaction didn't go through, may due to low balance...",
            t
          );
        });
    }
  }
  setInterval(mainLoop, 4000);
};
