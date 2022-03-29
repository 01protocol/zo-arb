import {
  Cluster,
  createProgram,
  findAssociatedTokenAddress,
  Margin,
  OrderType,
  State,
  Zo,
  ZO_MAINNET_STATE_KEY,
  ZoMarket,
  ZERO_ONE_DEVNET_PROGRAM_ID,
  ZERO_ONE_MAINNET_PROGRAM_ID,
  ZO_DEX_DEVNET_PROGRAM_ID,
  ZO_DEX_MAINNET_PROGRAM_ID,
} from "@zero_one/client";
import * as anchor from "@project-serum/anchor";
import { Program, Provider } from "@project-serum/anchor";
import {
  Connection,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  SignatureResult
} from "@solana/web3.js";
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";

require("dotenv").config();
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE);

export class ZoArbClient {
  private margin: Margin;
  private market: ZoMarket;
  private state: State;
  private program: Program<Zo>;
  private index: number;
  private wallet: Wallet;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
    const opts: anchor.web3.ConnectionConfig = {
      commitment: "confirmed",
    };

    const connection = new Connection(process.env.RPC_ADDRESS, opts);
    const provider = new anchor.Provider(connection, this.wallet, {
      commitment: "confirmed",
      skipPreflight: false,
    });
    this.program = createProgram(provider, Cluster.Mainnet);
  }

  async init(): Promise<void> {
    this.state = await State.load(this.program, ZO_MAINNET_STATE_KEY);
    try {
      this.margin = await Margin.load(
        this.program,
        this.state,
        this.state.cache
      );
    } catch (_) {
      console.log("Margin account does not exist, henceforth creating it", {
        event: "createMargin",
      });

      await this.checkLamports(this.program.provider, 0.04 * 10 ** 9);

      try {
        this.margin = await Margin.create(
          this.program,
          this.state,
          "confirmed"
        );
      } catch (e) {
        console.log({ err: e });
        throw new Error("Failed to create margin account");
      }
    }
    try {
      this.market = await this.state.getMarketBySymbol(
        process.env.MARKET + "-PERP"
      );
      this.index = this.state.getMarketIndexBySymbol(
        process.env.MARKET + "-PERP"
      );
    } catch (e) {
      console.log(e);
      return;
    }

  }

  async check() {
    const sym = process.env.MARKET + "-PERP";
    if (!this.state._getMarketBySymbol[sym]) {
      this.state._getMarketBySymbol[sym] = await ZoMarket.load(
        this.state.connection,
        this.state.getMarketKeyBySymbol(sym),
        this.state.provider.opts,
        this.state.program.programId.equals(ZERO_ONE_DEVNET_PROGRAM_ID)
          ? ZO_DEX_DEVNET_PROGRAM_ID
          : ZO_DEX_MAINNET_PROGRAM_ID,
      );
    }
    if (this.state._getMarketBySymbol[sym] as ZoMarket) {
      console.log("Yaya");
    } else {
      console.log("nono");
    }
  }

  async refresh() {
    await this.margin.refresh(false);
  }

  async getTopBid() {
    let bids = await this.market.loadBids(this.program.provider.connection);
    return bids.getL2(1)[0][0];
  }

  async getTopAsk() {
    let asks = await this.market.loadAsks(this.program.provider.connection);
    return asks.getL2(1)[0][0];
  }

  async getMark() {
    const topBid = await this.getTopBid();
    const topAsk = await this.getTopAsk();
    return (topAsk + topBid) / 2;
  }

  async getSpread() {
    const topBid = await this.getTopBid();
    const topAsk = await this.getTopAsk();
    return topAsk - topBid;
  }

  async getLongFunding() {
    await this.state.cache.refresh();
    const indexTwap = this.state.cache.getOracleBySymbol(
      process.env.MARKET
    ).twap;

    const markTwap = this.state.cache.data.marks[this.index].twap.close;
    return (markTwap.number - indexTwap.number) / 24.0;
  }

  async getShortFunding() {
    return -(await this.getLongFunding());
  }

  async getPositions() {
    await this.refresh();
    this.margin.loadPositions();
    return this.margin.positions[this.index];
  }

  async getAccountValue(): Promise<number> {
    await this.refresh();
    return this.margin.unweightedAccountValue.toNumber();
  }

  async marketLongIx(_unused, topAsk: number, quantity: number) {
    return await this.margin.makePlacePerpOrderIx({
      symbol: process.env.MARKET + "-PERP",
      orderType: { limit: {} },
      isLong: true,
      price: topAsk * 1.01,
      size: quantity,
    });
  }

  async marketShortIx(_unused, topBid: number, quantity: number) {
    return await this.margin.makePlacePerpOrderIx({
      symbol: process.env.MARKET + "-PERP",
      orderType: { limit: {} },
      isLong: false,
      price: topBid * 0.99,
      size: quantity,
    });
  }

  async marketLong(_unused, topAsk: number, quantity: number) {
    return await this.margin.placePerpOrder({
      symbol: process.env.MARKET + "-PERP",
      orderType: { limit: {} },
      isLong: true,
      price: topAsk * 1.01,
      size: quantity,
    });
  }

  async marketShort(_unused, topBid: number, quantity: number) {
    return await this.margin.placePerpOrder({
      symbol: process.env.MARKET + "-PERP",
      orderType: { limit: {} },
      isLong: false,
      price: topBid * 0.99,
      size: quantity,
    });
  }

  async closeLongIx(topBid: number) {
    return await this.margin.makePlacePerpOrderIx({
      symbol: process.env.MARKET + "-PERP",
      orderType: { reduceOnlyLimit: {} },
      isLong: false,
      price: topBid * 0.95,
      size: 9_999_999_999,
    });
  }

  async closeShortIx(topAsk: number) {

    return await this.margin.makePlacePerpOrderIx({
      symbol: process.env.MARKET + "-PERP",
      orderType: { reduceOnlyLimit: {} },
      isLong: true,
      price: topAsk * 1.05,
      size: 9_999_999_999,
    });
  }

  async checkLamports(provider: Provider, min: number): Promise<void> {
    const lamports = (
      await provider.connection.getAccountInfo(provider.wallet.publicKey)
    ).lamports;

    if (lamports < min) {
      console.log({ err: "Insufficient lamports" });
      throw new Error("Insufficient lamports");
    }
  }

  async send(ix) {
    /*
    let tx = new Transaction({ 
      recentBlockhash: (await this.program.provider.connection.getRecentBlockhash()).blockhash.toString(), 
      feePayer: this.program.provider.wallet.publicKey 
    });
    tx = tx.add(ix);
    tx = await this.program.provider.wallet.signTransaction(tx);
    return await sendAndConfirmTransaction(this.program.provider.connection, tx, [], { commitment: "recent" });
    */
    let tx = new Transaction();
    tx = tx.add(ix);
    return await this.program.provider.send(tx, [], { commitment: "confirmed" });
  }

  async sendAndConfirmIx(ix: TransactionInstruction) {
    const sig = await this.send(ix);
    let result = await this.program.provider.connection.confirmTransaction(sig, "confirmed");
    return result.value.err === null
  }

  getSigner() {
    return this.program.provider.wallet;
  }

  async getCanOpenShort() {
    const position = await this.getPositions();
    if (
      position.isLong
    ) {
      return true;
    }
    return (
      position.pCoins.number < MAX_POSITION_SIZE
    );
  }

  async getCanOpenLong() {
    const position = await this.getPositions();
    if (
      !position.isLong
    ) {
      return true;
    }
    return (
      -position.pCoins.number < MAX_POSITION_SIZE
    );
  }
}
