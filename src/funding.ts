import { Keypair, Transaction } from "@solana/web3.js";
import { initialize, PositionDirection, DriftEnv } from "@drift-labs/sdk";
import { ZoArbClient } from "./zo";
import { DriftArbClient } from "./drift";
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";
import { getTime } from "./utils";
import { Instruction } from "@drift-labs/sdk/node_modules/@project-serum/anchor";

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

export const runFundingBot = async () => {
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

    const zoBid = await zoArbClient.getTopBid();
    const zoAsk = await zoArbClient.getTopAsk();

    // At the end of each hour, check the funding rates for each exchange.
    // If the funding rates sum to more than the threshold * the spread, then open a position.
    // After funding is collected, close the position.
    let zoLongFunding = await zoArbClient.getLongFunding();
    let zoShortFunding = await zoArbClient.getShortFunding();

    let driftLongFunding = await driftArbClient.getLongFunding();
    let driftShortFunding = await driftArbClient.getShortFunding();

    let zoSpread = zoAsk - zoBid;
    let mark = await zoArbClient.getMark();

    let driftSpread =
      driftArbClient.priceInfo.longEntry - driftArbClient.priceInfo.shortEntry;

    let zoShortDiff =
      (((zoLongFunding + driftShortFunding) * 0.999 - zoSpread - driftSpread) /
        mark) *
      100;
    let zoLongDiff =
      (((zoShortFunding + driftLongFunding) * 0.999 - zoSpread - driftSpread) /
        mark) *
      100;

    console.log(
      `Buy Drift Sell 01 Diff ${process.env.MARKET}: ${zoShortDiff.toFixed(
        4
      )}%. // Buy 01 Sell Drift Diff ${
        process.env.MARKET
      }: ${zoLongDiff.toFixed(4)}%.`
    );

    let [minutes, seconds] = getTime();
    if (minutes !== 59 || seconds !== 57) {
      console.log(
        `${(59 - minutes) % 60}:${
          (57 - seconds) % 60
        } until next possible opportunity`
      );
      return;
    } else if (seconds < 20) {
      // Get 01 position
      let position = await zoArbClient.getPositions();
      if (position.coins.number !== 0) {
        let zoCloseIx: any;

        if (position.isLong) {
          zoCloseIx = await zoArbClient.closeLong(zoBid);
        } else {
          zoCloseIx = await zoArbClient.closeShort(zoAsk);
        }

        const txn = wrapInTx(await driftArbClient.getClosePositionIx());

        txn.add(zoCloseIx);
        await driftArbClient
          .sendTx(txn, [], driftArbClient.getOpts())
          .catch((t) => {
            console.log(
              "Transaction didn't go through, may due to low balance...",
              t
            );
          });
      }
      return;
    }

    let canOpenDriftLong = await driftArbClient.getCanOpenLong();
    let canOpenDriftShort = await driftArbClient.getCanOpenShort();

    if (zoShortDiff > THRESHOLD) {
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
        `Capturing ~${zoShortDiff.toFixed(4)}% profit (slippage not included)`
      );

      const txn = wrapInTx(
        await driftArbClient.getOpenPositionIx(
          PositionDirection.LONG,
          usdcQuantity
        )
      );

      txn.add(
        await zoArbClient.marketShort(
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

    if (zoLongDiff > THRESHOLD) {
      if (!canOpenDriftShort) {
        console.log(
          `Letting this opportunity go due to Drift short exposure is > $${MAX_POSITION_SIZE}`
        );
        return;
      }

      const quantity =
        Math.trunc(
          (100 * POSITION_SIZE_USD) / driftArbClient.priceInfo.shortEntry
        ) / 100;
      const usdcQuantity = quantity * driftArbClient.priceInfo.shortEntry;

      console.log(
        "===================================================================="
      );
      console.log(
        `LONG ${usdcQuantity} worth of ${process.env.MARKET} on 01 at price ~$${zoAsk}`
      );
      console.log(
        `SELL ${usdcQuantity} worth of ${process.env.MARKET} on Drift at price ~$${driftArbClient.priceInfo.shortEntry}`
      );
      console.log(
        `Capturing ~${zoLongDiff.toFixed(4)}% profit (slippage not included)`
      );

      const txn = wrapInTx(
        await driftArbClient.getOpenPositionIx(
          PositionDirection.SHORT,
          usdcQuantity
        )
      );

      txn.add(
        await zoArbClient.marketLong(
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
  setInterval(mainLoop, 750);
};
