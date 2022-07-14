import * as bunyan from "bunyan";
import Decimal from "decimal.js";
import fetch from "node-fetch";
import { NewOrderReq, RestClient } from "ftx-api";

export class FtxArbClient {
  private readonly log = bunyan.createLogger({
    name: "FtxArbClient",
    level: "debug",
    serializers: bunyan.stdSerializers,
  });
  private client: RestClient;
  private market: FtxMarket;
  private account: FtxAccountInfo;

  constructor() {
    this.client = new RestClient(process.env.FTX_KEY, process.env.FTX_SECRET, {
      subAccountName: process.env.FTX_SUBACCOUNT,
    });
  }

  async init() {
    try {
      this.log.info({ event: "Init" });
      this.market = await this.getMarket(process.env.FTX_MARKET);
    } catch (e) {
      this.log.error({ err: e, event: "Init" });
      process.exit(1);
    }
  }

  async getMarket(marketName: string): Promise<FtxMarket> {
    const response = await fetch(`https://ftx.com/api/markets/${marketName}`);
    const result: any[] = (await response.json()).result;
    return this.toFtxMarket(result);
  }

  async refresh(): Promise<void> {
    this.market = await this.getMarket(process.env.FTX_MARKET);
    return;
  }

  getAsk(): Decimal {
    return this.market.ask;
  }

  getBid(): Decimal {
    return this.market.bid;
  }

  async getFtxAccountInfo(): Promise<FtxAccountInfo> {
    const data = await this.client.getAccount();
    this.log.info({
      event: "GetAccountInfo",
      params: data,
    });

    const positionsMap: Record<string, FtxPosition> = {};
    for (let i = 0; i < data.result.positions.length; i++) {
      const positionEntity = data.result.positions[i];
      const position = this.toFtxPosition(positionEntity);
      positionsMap[position.future] = position;
    }

    return {
      freeCollateral: new Decimal(data.result.freeCollateral),
      totalAccountValue: new Decimal(data.result.totalAccountValue),
      // marginFraction is null if the account has no open positions
      marginFraction: new Decimal(
        data.result.marginFraction ? data.result.marginFraction : 0
      ),
      maintenanceMarginRequirement: new Decimal(
        data.result.maintenanceMarginRequirement
      ),
      positionsMap: positionsMap,
    };
  }

  async getPosition(ftxClient: any, marketId: string): Promise<FtxPosition> {
    const data = await ftxClient.request({
      method: "GET",
      path: "/positions",
    });
    this.log.info({
      event: "GetPositions",
      params: data,
    });
    const positions: Record<string, FtxPosition> = {};
    for (let i = 0; i < data.result.length; i++) {
      const positionEntity = data.result[i];
      if (positionEntity.future === marketId) {
        const position = this.toFtxPosition(positionEntity);
        positions[position.future] = position;
      }
    }
    return positions[marketId];
  }

  async getTotalPnLs(ftxClient: any): Promise<Record<string, number>> {
    const data = await ftxClient.request({
      method: "GET",
      path: "/pnl/historical_changes",
    });
    return data.result.totalPnl;
  }

  async placeOrder(payload: NewOrderReq): Promise<void> {
    const data = await this.client.placeOrder(payload);
    this.log.info({
      event: "PlaceOrder",
      params: data,
    });
  }

  // noinspection JSMethodCanBeStatic
  private toFtxMarket(market: any): FtxMarket {
    return {
      name: market.name,
      bid: market.bid ? new Decimal(market.bid) : undefined,
      ask: market.ask ? new Decimal(market.ask) : undefined,
      last: market.last ? new Decimal(market.last) : undefined,
    };
  }

  // noinspection JSMethodCanBeStatic
  private toFtxPosition(positionEntity: any): FtxPosition {
    return {
      future: positionEntity.future,
      netSize: new Decimal(positionEntity.netSize),
      entryPrice: new Decimal(
        positionEntity.entryPrice ? positionEntity.entryPrice : 0
      ),
      realizedPnl: new Decimal(
        positionEntity.realizedPnl ? positionEntity.realizedPnl : 0
      ),
      cost: new Decimal(positionEntity.cost ? positionEntity.cost : 0),
    };
  }
}

export interface FtxAccountInfo {
  freeCollateral: Decimal;
  totalAccountValue: Decimal;
  marginFraction: Decimal;
  maintenanceMarginRequirement: Decimal;
  positionsMap: Record<string, FtxPosition>;
}

export interface PlaceOrderPayload {
  market: string;
  side: string;
  price: null;
  size: number;
  type: string;
}

export interface FtxPosition {
  future: string;
  netSize: Decimal; // + is long and - is short
  entryPrice: Decimal;
  realizedPnl: Decimal;
  cost: Decimal;
}

export interface FtxMarket {
  name: string;
  bid: Decimal;
  ask: Decimal;
  last?: Decimal;
}
