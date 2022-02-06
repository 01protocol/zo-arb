"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bot = void 0;
const bunyan = __importStar(require("bunyan"));
const client_1 = require("@zero_one/client");
const anchor = __importStar(require("@project-serum/anchor"));
const utils_1 = require("./utils");
const Ftx_1 = require("./Ftx");
const ftx_api_rest_1 = __importDefault(require("ftx-api-rest"));
const decimal_js_1 = __importDefault(require("decimal.js"));
class Bot {
    constructor() {
        this.log = bunyan.createLogger({ name: "zo-arb" });
        this.ftxAccountValue = new decimal_js_1.default(0);
        this.ftx = new Ftx_1.Ftx();
        this.ftxClient = new ftx_api_rest_1.default({
            key: process.env.FTX_API_KEY,
            secret: process.env.FTX_API_SECRET,
            subaccount: process.env.FTX_SUBACCOUNT,
        });
        this.program = (0, client_1.createProgram)(anchor.Provider.local(process.env.CONNECTION, {
            skipPreflight: true,
            commitment: "confirmed",
        }), client_1.Cluster.Mainnet);
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log.info({
                event: "run",
            });
            yield this.setupAccounts();
            yield this.arb();
            // setInterval(async () => await this.arb(), 10 * 1000);
        });
    }
    setupAccounts() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log.info({
                event: "setupAccounts",
            });
            this.state = yield client_1.State.load(this.program, client_1.ZO_MAINNET_STATE_KEY);
            // check if margin account exists (create it if it doesn't)
            try {
                this.margin = yield client_1.Margin.load(this.program, this.state, this.state.cache);
            }
            catch (_) {
                this.log.info("Margin account does not exist, henceforth creating it", {
                    event: "createMargin",
                });
                yield (0, utils_1.checkLamports)(this.program.provider, 0.04 * Math.pow(10, 9), this.log);
                try {
                    this.margin = yield client_1.Margin.create(this.program, this.state, "confirmed");
                }
                catch (e) {
                    this.log.fatal({ err: e });
                    throw new Error("Failed to create margin account");
                }
            }
        });
    }
    arb() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log.info({ event: "arb" });
            yield (0, utils_1.checkLamports)(this.program.provider, 5000, this.log);
            // rebalance 01 margin
            yield this.rebalanceZo();
            // fetch FTX account info
            const ftxAccountInfo = yield this.ftx.getFtxAccountInfo(this.ftxClient);
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
            if (!ftxMarginRatio.eq(0) &&
                ftxMarginRatio.lt(process.env.FTX_MARGIN_RATIO_THRESHOLD)) {
                this.log.error({
                    event: "FtxMarginRatioTooLow",
                    params: { balance: ftxMarginRatio.toFixed() },
                });
                return;
            }
            this.ftxAccountValue = ftxAccountInfo.totalAccountValue;
            const ftxTotalPnlMaps = yield this.ftx.getTotalPnLs(this.ftxClient);
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
                yield this.arbTrade();
                return;
            }
            catch (e) {
                this.log.error({
                    event: "ArbTrade",
                    err: e,
                });
                return;
            }
        });
    }
    rebalanceZo() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log.info({ event: "RebalanceZo" });
            // current MF = total acc value / total position notional
            // target MF = (total acc value + Δ collateral) / total position notional
            // target MF = current MF + Δ collateral / total position notional
            // Δ collateral = (target MF - current MF) * total position notional
            const position = this.margin.positions[this.state.getMarketIndexBySymbol(process.env.MARKET)];
            if (position.coins.number > 0) {
                const currentMf = this.margin.marginFraction;
                const targetMf = new decimal_js_1.default(1).div(new decimal_js_1.default(parseInt(process.env.TARGET_MF)));
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
                if (currentMf.gt(targetMf.plus(new decimal_js_1.default(1)))) {
                    let collateralToRemove = deltaCollateral.mul(-1);
                    // TODO: continue here
                }
                // finished rebalancing
            }
        });
    }
    arbTrade() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.state.refresh();
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
            const position = this.margin.positions[this.state.getMarketIndexBySymbol(process.env.MARKET)];
            this.log.info({ event: "ZoPosition", params: position });
            // get FTX positions
            const ftxPosition = yield this.ftx.getPosition(this.ftxClient, process.env.MARKET);
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
            const [zoPrices, ftxPrices] = yield Promise.all([
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
            const maxBaseAllowed = new decimal_js_1.default(process.env.MAX_BASE_ALLOWED);
            let maxBaseLeft = maxBaseAllowed.minus(position.coins.decimal.abs());
            maxBaseLeft = maxBaseLeft.lt(0) ? new decimal_js_1.default(0) : maxBaseLeft; // this might happen if somehow we reduce the personal cap
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
            }
            else if (bidAskSpreadFtx.gt(process.env.ZO_LONG_ENTRY_TRIGGER)) {
                this.log.info({ event: "LongZoShortFtx" });
            }
            else {
                this.log.info({ event: "NotTriggered" });
            }
        });
    }
    fetchZoPrices() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.zoMarket = yield this.state.getMarketBySymbol(process.env.MARKET);
            }
            catch (e) {
                console.log("zo error");
                this.log.error({ event: "FetchZoPrices", err: e });
                return;
            }
            const bid = new decimal_js_1.default((yield this.zoMarket.loadBids(this.program.provider.connection)).getL2(1)[0][0]);
            const ask = new decimal_js_1.default((yield this.zoMarket.loadAsks(this.program.provider.connection)).getL2(1)[0][0]);
            this.log.info({
                event: "FetchZoPrices",
                params: {
                    tokenPair: process.env.MARKET,
                    bid: bid.toFixed(),
                    ftxAsk: ask.toFixed(),
                },
            });
            return [bid, ask];
        });
    }
    fetchFtxPrices() {
        return __awaiter(this, void 0, void 0, function* () {
            const ftxMarket = yield this.ftx.getMarket(process.env.MARKET);
            const ftxBid = ftxMarket.bid;
            const ftxAsk = ftxMarket.ask;
            this.log.info({
                event: "FetchFtxPrices",
                params: {
                    tokenPair: process.env.MARKET,
                    bid: ftxBid.toFixed(),
                    ftxAsk: ftxAsk.toFixed(),
                },
            });
            return [ftxBid, ftxAsk];
        });
    }
}
exports.Bot = Bot;
//# sourceMappingURL=Bot.js.map