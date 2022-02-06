import * as bunyan from "bunyan";
import {
  Cluster,
  createProgram,
  findAssociatedTokenAddress,
  Margin,
  State,
  Zo,
  ZO_MAINNET_STATE_KEY,
  ZoMarket,
} from "@zero_one/client";
import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { checkLamports } from "./utils";
import { Ftx } from "./Ftx";
import FTXRest from "ftx-api-rest";
import Decimal from "decimal.js";
import { PublicKey } from "@solana/web3.js";

export class Bot {
  private readonly log = bunyan.createLogger({ name: "zo-arb" });
  private readonly ftxClient: any;
  private readonly program: Program<Zo>;
  private ftx: Ftx;
  private margin: Margin;
  private state: State;
  private zoMarket: ZoMarket;

  private ftxAccountValue = new Decimal(0);

  constructor() {
    this.ftx = new Ftx();
    this.ftxClient = new FTXRest({
      key: process.env.FTX_API_KEY,
      secret: process.env.FTX_API_SECRET,
      subaccount: process.env.FTX_SUBACCOUNT,
    });
    this.program = createProgram(
      anchor.Provider.local(process.env.CONNECTION, {
        skipPreflight: true,
        commitment: "confirmed",
      }),
      Cluster.Mainnet
    );
  }

  async run(): Promise<void> {
    this.log.info({
      event: "run",
    });

    await this.setupAccounts();

    await this.arb();
    // setInterval(async () => await this.arb(), 10 * 1000);
  }

  async setupAccounts(): Promise<void> {
    this.log.info({
      event: "setupAccounts",
    });

    this.state = await State.load(this.program, ZO_MAINNET_STATE_KEY);

    // check if margin account exists (create it if it doesn't)
    try {
      this.margin = await Margin.load(
        this.program,
        this.state,
        this.state.cache
      );
    } catch (_) {
      this.log.info("Margin account does not exist, henceforth creating it", {
        event: "createMargin",
      });

      await checkLamports(this.program.provider, 0.04 * 10 ** 9, this.log);

      try {
        this.margin = await Margin.create(
          this.program,
          this.state,
          "confirmed"
        );
      } catch (e) {
        this.log.fatal({ err: e });
        throw new Error("Failed to create margin account");
      }
    }
  }

  async arb(): Promise<void> {
    this.log.info({ event: "arb" });

    await checkLamports(this.program.provider, 5_000, this.log);

    // rebalance 01 margin
    await this.rebalanceZo();

    // fetch FTX account info
    const ftxAccountInfo = await this.ftx.getFtxAccountInfo(this.ftxClient);

    // check FTX balance (USD)
    const ftxBalance = ftxAccountInfo.freeCollateral;
    this.log.info({
      event: "FtxUsdBalance",
      params: { balance: ftxBalance.toFixed() },
    });
    if (ftxBalance.lt(process.env.FTX_USD_BALANCE_THRESHOLD)) {
      this.log.error({
        event: "FtxUsdNotEnough",
        params: { balance: ftxBalance.toFixed() },
      });
      return;
    }

    // check FTX margin ratio
    const ftxMarginRatio = ftxAccountInfo.marginFraction;
    this.log.info({
      event: "FtxMarginRatio",
      params: { ftxMarginRatio: ftxMarginRatio.toFixed() },
    });
    if (
      !ftxMarginRatio.eq(0) &&
      ftxMarginRatio.lt(process.env.FTX_MARGIN_RATIO_THRESHOLD)
    ) {
      this.log.error({
        event: "FtxMarginRatioTooLow",
        params: { balance: ftxMarginRatio.toFixed() },
      });
      return;
    }

    this.ftxAccountValue = ftxAccountInfo.totalAccountValue;

    const ftxTotalPnlMaps = await this.ftx.getTotalPnLs(this.ftxClient);
    for (const marketKey in ftxTotalPnlMaps) {
      this.log.info({
        event: "FtxPnL",
        params: {
          marketKey,
          pnl: ftxTotalPnlMaps[marketKey],
        },
      });
    }

    try {
      await this.arbTrade();
      return;
    } catch (e) {
      this.log.error({
        event: "ArbTrade",
        err: e,
      });
      return;
    }
  }

  async rebalanceZo(): Promise<void> {
    this.log.info({ event: "RebalanceZo" });

    // current MF = total acc value / total position notional
    // target MF = (total acc value + Δ collateral) / total position notional
    // target MF = current MF + Δ collateral / total position notional
    // Δ collateral = (target MF - current MF) * total position notional

    const position =
      this.margin.positions[
        this.state.getMarketIndexBySymbol(process.env.MARKET)
      ];

    if (position.coins.number > 0) {
      const currentMf = this.margin.marginFraction;
      const targetMf = new Decimal(1).div(
        new Decimal(parseInt(process.env.TARGET_MF))
      );
      const deltaCollateral = targetMf
        .minus(currentMf)
        .times(this.margin.totalPositionNotional);
      this.log.info({
        event: "ZoMarginChange",
        params: {
          currentMf: currentMf.toFixed(),
          targetMf: targetMf.toFixed(),
          deltaCollateral: deltaCollateral.toFixed(),
        },
      });

      if (currentMf.gt(targetMf.plus(new Decimal(1)))) {
        let collateralToRemove = deltaCollateral.mul(-1);
        // TODO: continue here
      }

      // finished rebalancing
    }
  }

  async arbTrade(): Promise<void> {
    await this.state.refresh();
    this.log.info({ event: "ArbTrade" });

    // check wallet USDC balance (uses associate token account)
    // let usdcTokenAcc;
    // try {
    //   usdcTokenAcc =
    //     await this.program.provider.connection.getTokenAccountBalance(
    //       await findAssociatedTokenAddress(
    //         this.program.provider.wallet.publicKey,
    //         new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    //       )
    //     );
    // } catch (e) {
    //   this.log.error({ err: e });
    //   return;
    // }
    // if (usdcTokenAcc.value.uiAmount < parseInt(process.env.USDC_MINIMUM)) {
    //   this.log.error({ err: "Insufficient USDC wallet balance" });
    //   return;
    // }

    // get 01 positions
    const position =
      this.margin.positions[
        this.state.getMarketIndexBySymbol(process.env.MARKET)
      ];
    this.log.info({ event: "ZoPosition", params: position });

    // get FTX positions
    const ftxPosition = await this.ftx.getPosition(
      this.ftxClient,
      process.env.MARKET
    );
    if (ftxPosition) {
      const ftxSizeDiff = ftxPosition.netSize
        .abs()
        .sub(position.coins.decimal.abs());
      this.log({
        event: "FtxPosition",
        params: {
          marketId: ftxPosition.future,
          size: ftxPosition.netSize,
          diff: ftxSizeDiff,
        },
      });

      // TODO: rebalance position size difference
      // if (ftxSizeDiff.abs().gte()) {
      // }
    }

    // fetch prices
    const [zoPrices, ftxPrices] = await Promise.all([
      this.fetchZoPrices(),
      this.fetchFtxPrices(),
    ]);

    // calculate spread (zo - ftx)
    // (zo price > ftx price) = (zo bid > ftx ask), then short zo, long ftx
    // (zo price < ftx price) = (zo ask < ftx bid), then long zo, short ftx
    const bidAskSpreadZo = zoPrices[0].minus(ftxPrices[1]).div(ftxPrices[1]);
    const bidAskSpreadFtx = ftxPrices[0].minus(zoPrices[1]).div(ftxPrices[0]);
    this.log.info({
      event: "CalculatedSpread",
      params: {
        bidAskSpreadZo: bidAskSpreadZo.toFixed(),
        bidAskSpreadFtx: bidAskSpreadFtx.toFixed(),
      },
    });

    // TODO: calc slippage

    const maxBaseAllowed = new Decimal(process.env.MAX_BASE_ALLOWED);
    let maxBaseLeft = maxBaseAllowed.minus(position.coins.decimal.abs());
    maxBaseLeft = maxBaseLeft.lt(0) ? new Decimal(0) : maxBaseLeft; // this might happen if somehow we reduce the personal cap
    this.log.info({
      event: "ZoPersonalCap",
      params: {
        maxBaseLeft: maxBaseLeft,
        maxBaseAllowed: maxBaseAllowed,
        currentPositionSize: position.coins.number,
      },
    });

    // if bidAskSpreadZo above trigger, then open position
    if (bidAskSpreadZo.gt(process.env.ZO_SHORT_ENTRY_TRIGGER)) {
      this.log.info({ event: "ShortZoLongFtx" });
    } else if (bidAskSpreadFtx.gt(process.env.ZO_LONG_ENTRY_TRIGGER)) {
      this.log.info({ event: "LongZoShortFtx" });
    } else {
      this.log.info({ event: "NotTriggered" });
    }
  }

  async fetchZoPrices(): Promise<Decimal[]> {
    try {
      this.zoMarket = await this.state.getMarketBySymbol(process.env.MARKET);
    } catch (e) {
      console.log("zo error");
      this.log.error({ event: "FetchZoPrices", err: e });
      return;
    }
    const bid = new Decimal(
      (await this.zoMarket.loadBids(this.program.provider.connection)).getL2(
        1
      )[0][0]
    );
    const ask = new Decimal(
      (await this.zoMarket.loadAsks(this.program.provider.connection)).getL2(
        1
      )[0][0]
    );
    this.log.info({
      event: "FetchZoPrices",
      params: {
        tokenPair: process.env.MARKET,
        bid: bid.toFixed(),
        ftxAsk: ask.toFixed(),
      },
    });
    return [bid, ask];
  }

  async fetchFtxPrices(): Promise<Decimal[]> {
    const ftxMarket = await this.ftx.getMarket(process.env.MARKET);
    const ftxBid = ftxMarket.bid!;
    const ftxAsk = ftxMarket.ask!;
    this.log.info({
      event: "FetchFtxPrices",
      params: {
        tokenPair: process.env.MARKET,
        bid: ftxBid.toFixed(),
        ftxAsk: ftxAsk.toFixed(),
      },
    });
    return [ftxBid, ftxAsk];
  }
}
