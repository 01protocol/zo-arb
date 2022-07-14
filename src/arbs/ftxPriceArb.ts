import { Keypair } from "@solana/web3.js";
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { sleep } from "@zero_one/client";
import { FtxArbClient } from "../clients/Ftx";
import { ZoArbClient } from "../clients/Zo";

require("dotenv").config();

// % differences between markets to initiate a position.
// higher is likely more profitable but less opportunities
// FTX long is comparing to (zo short price - FTX long price) / FTX long price * 100
// FTX short is comparing (FTX short price - zo long price) / zo long price * 100
// TODO: MAKE IT DYNAMIC
const THRESHOLD = parseFloat(process.env.THRESHOLD);

// size for each position, there could be multiple positions until price is within threshold
const POSITION_SIZE_USD = parseFloat(process.env.POSITION_SIZE_USD);

// Max position size before going reduce only mode (+/- POSITION_SIZE_USD)
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE);

// Private key array
// Please set in as environment variable
// Also make sure it has SOL and collateral in it
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const SIMULATE = process.env.SIMULATE === "true";

export const runFtxPriceArb = async (log: any) => {
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

    const ftxLongDiff = (-(ftxAsk - zoBid) / ftxAsk) * 100;
    const ftxShortDiff = (-(zoAsk - ftxBid) / ftxBid) * 100;

    log.info({
      market: process.env.MARKET,
      buyFtxSell01: ftxLongDiff.toFixed(4),
      buy01SellFtx: ftxShortDiff.toFixed(4),
    });

    let canOpenZoLong = await zoArbClient.getCanOpenLong();
    let canOpenZoShort = await zoArbClient.getCanOpenShort();

    // open FTX long zo short
    // if short is maxed out, try to lower threshold to close the short open more long.
    let ftxLongThreshold = canOpenZoShort ? THRESHOLD : 1.0 * THRESHOLD;
    if (ftxLongDiff > ftxLongThreshold) {
      if (!canOpenZoLong) {
        log.info({
          event: "CannotOpenZoLong",
          maxPositionSize: MAX_POSITION_SIZE,
        });
        continue;
      }

      const quantity = Math.trunc((100 * POSITION_SIZE_USD) / ftxAsk) / 100;
      const usdcQuantity = quantity * ftxAsk;

      log.info({
        event: "Sell01",
        market: process.env.MARKET,
        price: zoBid,
        amount: usdcQuantity,
      });
      log.info({
        event: "LongFTX",
        market: process.env.MARKET,
        price: ftxAsk,
        amount: usdcQuantity,
      });
      // % profit (01 fees & slippage not included)
      log.info({
        profit: ftxLongDiff.toFixed(4),
      });

      try {
        !SIMULATE &&
          (await zoArbClient.sendAndConfirmIx(
            await zoArbClient.marketShortIx(
              POSITION_SIZE_USD,
              zoBid,
              POSITION_SIZE_USD / ftxAsk
            )
          ));

        // await zoArbClient.marketShort(
        //     POSITION_SIZE_USD,
        //     zoBid,
        //     POSITION_SIZE_USD / ftxAsk
        // );
      } catch (e) {
        // may due to low balance...
        log.error({ err: e, event: "SendZoArbTx" });
        continue; // skip if tx fails
      }

      try {
        !SIMULATE &&
          (await ftxArbClient.placeOrder({
            market: process.env.FTX_MARKET,
            side: "buy",
            price: null,
            size: quantity,
            type: "market",
          }));
      } catch (e) {
        // TODO: if this fails, then you need to cancel the order above
      }
    }

    // open zo short ftx long
    // if long is maxed out, try to lower threshold to close the long by more short.
    let ftxShortThreshold = canOpenZoLong ? THRESHOLD : 1.0 * THRESHOLD;
    if (ftxShortDiff > ftxShortThreshold) {
      if (!canOpenZoShort) {
        log.info({
          event: "CannotOpenZoShort",
          maxPositionSize: MAX_POSITION_SIZE,
        });
        continue;
      }

      // zo rounds down to the nearest multiple of 0.01
      const quantity = Math.trunc((100 * POSITION_SIZE_USD) / ftxBid) / 100;
      const usdcQuantity = quantity * ftxBid;

      log.info({
        event: "SellFTX",
        market: process.env.MARKET,
        price: ftxBid,
        amount: usdcQuantity,
      });
      log.info({
        event: "Long01",
        market: process.env.MARKET,
        price: zoAsk,
        amount: usdcQuantity,
      });
      // % profit (01 fees & slippage not included)
      log.info({
        profit: ftxShortDiff.toFixed(4),
      });

      try {
        !SIMULATE &&
          (await zoArbClient.sendAndConfirmIx(
            await zoArbClient.marketLongIx(
              POSITION_SIZE_USD,
              zoAsk,
              POSITION_SIZE_USD / ftxBid
            )
          ));
      } catch (e) {
        // may due to low balance...
        log.error({ err: e, event: "SendZoArbTx" });
        continue; // skip if tx fails
      }

      try {
        !SIMULATE &&
          (await ftxArbClient.placeOrder({
            market: process.env.FTX_MARKET,
            side: "sell",
            price: null,
            size: quantity,
            type: "market",
          }));
      } catch (e) {
        // TODO: if this fails, then you need to cancel the order above
      }
    }

    await sleep(400);
  }
};
