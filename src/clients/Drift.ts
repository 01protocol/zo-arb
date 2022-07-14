import { Provider } from "@project-serum/anchor";
import {
  ConfirmOptions,
  Connection,
  Signer,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  BN,
  calculateMarkPrice,
  ClearingHouse,
  ClearingHouseAccountTypes,
  initialize,
  Markets,
  Market,
  PositionDirection,
  convertToNumber,
  calculateTradeSlippage,
  MARK_PRICE_PRECISION,
  QUOTE_PRECISION,
  FUNDING_PAYMENT_PRECISION,
  DriftEnv,
  ClearingHouseUser,
} from "@drift-labs/sdk";
import { ZoArbClient } from "./Zo";
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";

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

export class DriftArbClient {
  private clearingHouse: ClearingHouse;
  private user: ClearingHouseUser;
  private sdkConfig = initialize({ env: "mainnet-beta" as DriftEnv });
  private marketInfo: Market;
  private marketIndex: BN;
  private wallet: Wallet;
  public priceInfo: { longEntry: number; shortEntry: number };

  async init(wallet: Wallet) {
    this.wallet = wallet;
    // Set up the Connection
    const connection = new Connection(RPC_ADDRESS);

    // Set up the Provider
    const provider = new Provider(connection, wallet, {
      commitment: "confirmed",
      skipPreflight: false,
    });

    // Set up the Drift Clearing House
    const clearingHousePublicKey = new PublicKey(
      this.sdkConfig.CLEARING_HOUSE_PROGRAM_ID
    );

    this.clearingHouse = ClearingHouse.from(
      connection,
      provider.wallet,
      clearingHousePublicKey
    );

    await this.clearingHouse.subscribe(["fundingRateHistoryAccount"]);

    const market = Markets.find(
      (market) => market.baseAssetSymbol === process.env.MARKET
    );

    this.marketIndex = market.marketIndex;
    this.marketInfo = this.clearingHouse.getMarket(market.marketIndex);

    // set up drift user
    // Set up Clearing House user client
    this.user = ClearingHouseUser.from(this.clearingHouse, wallet.publicKey);
    await this.user.subscribe();

    this.priceInfo = {
      longEntry: 0,
      shortEntry: 0,
    };

    this.clearingHouse.eventEmitter.addListener(
      "marketsAccountUpdate",
      async (d) => {
        const formattedPrice = convertToNumber(
          calculateMarkPrice(d["markets"][0]),
          MARK_PRICE_PRECISION
        );

        let longSlippage = convertToNumber(
          calculateTradeSlippage(
            PositionDirection.LONG,
            new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
            this.marketInfo
          )[0],
          MARK_PRICE_PRECISION
        );

        let shortSlippage = convertToNumber(
          calculateTradeSlippage(
            PositionDirection.SHORT,
            new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
            this.marketInfo
          )[0],
          MARK_PRICE_PRECISION
        );

        this.priceInfo.longEntry = formattedPrice * (1 + longSlippage);
        this.priceInfo.shortEntry = formattedPrice * (1 - shortSlippage);
      }
    );
  }

  async getLongFunding() {
    const fundingRate = this.clearingHouse.getFundingRateHistoryAccount();
    return convertToNumber(fundingRate.head, FUNDING_PAYMENT_PRECISION) / 24;
  }

  async getShortFunding() {
    const fundingRate = this.clearingHouse.getFundingRateHistoryAccount();
    return (
      convertToNumber(fundingRate.head.neg(), FUNDING_PAYMENT_PRECISION) / 24
    );
  }

  async getOpenPositionIx(
    positionSide: PositionDirection,
    positionValue: number
  ) {
    return await this.clearingHouse.getOpenPositionIx(
      positionSide,
      new BN(positionValue).mul(QUOTE_PRECISION),
      this.marketIndex
    );
  }

  async getClosePositionIx() {
    return await this.clearingHouse.getClosePositionIx(this.marketIndex);
  }

  async getCanOpenShort() {
    if (
      this.user.getPositionSide(this.user.getUserPosition(this.marketIndex)) ==
      PositionDirection.LONG
    ) {
      return true;
    }
    return (
      convertToNumber(
        this.user.getPositionValue(this.marketIndex),
        QUOTE_PRECISION
      ) < MAX_POSITION_SIZE
    );
  }

  async getCanOpenLong() {
    if (
      this.user.getPositionSide(this.user.getUserPosition(this.marketIndex)) ==
      PositionDirection.SHORT
    ) {
      return true;
    }
    return (
      convertToNumber(
        this.user.getPositionValue(this.marketIndex),
        QUOTE_PRECISION
      ) < MAX_POSITION_SIZE
    );
  }

  async sendTx(tx: Transaction, signers: Signer[], options: ConfirmOptions) {
    return await this.clearingHouse.txSender.send(tx, signers, options);
  }

  getOpts() {
    return this.clearingHouse.opts;
  }
}
