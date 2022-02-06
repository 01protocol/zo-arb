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
exports.Ftx = void 0;
const bunyan = __importStar(require("bunyan"));
const decimal_js_1 = __importDefault(require("decimal.js"));
const node_fetch_1 = __importDefault(require("node-fetch"));
class Ftx {
    constructor() {
        this.log = bunyan.createLogger({ name: "Ftx" });
    }
    getMarket(marketName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield (0, node_fetch_1.default)(`https://ftx.com/api/markets/${marketName}`);
            const result = (yield response.json()).result;
            return this.toFtxMarket(result);
        });
    }
    getFtxAccountInfo(ftxClient) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield ftxClient.request({
                method: "GET",
                path: "/account",
            });
            this.log.info({
                event: "GetAccountInfo",
                params: data,
            });
            const positionsMap = {};
            for (let i = 0; i < data.result.positions.length; i++) {
                const positionEntity = data.result.positions[i];
                const position = this.toFtxPosition(positionEntity);
                positionsMap[position.future] = position;
            }
            return {
                freeCollateral: new decimal_js_1.default(data.result.freeCollateral),
                totalAccountValue: new decimal_js_1.default(data.result.totalAccountValue),
                // marginFraction is null if the account has no open positions
                marginFraction: new decimal_js_1.default(data.result.marginFraction ? data.result.marginFraction : 0),
                maintenanceMarginRequirement: new decimal_js_1.default(data.result.maintenanceMarginRequirement),
                positionsMap: positionsMap,
            };
        });
    }
    getPosition(ftxClient, marketId) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield ftxClient.request({
                method: "GET",
                path: "/positions",
            });
            this.log.info({
                event: "GetPositions",
                params: data,
            });
            const positions = {};
            for (let i = 0; i < data.result.length; i++) {
                const positionEntity = data.result[i];
                if (positionEntity.future === marketId) {
                    const position = this.toFtxPosition(positionEntity);
                    positions[position.future] = position;
                }
            }
            return positions[marketId];
        });
    }
    getTotalPnLs(ftxClient) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield ftxClient.request({
                method: "GET",
                path: "/pnl/historical_changes",
            });
            return data.result.totalPnl;
        });
    }
    placeOrder(ftxClient, payload) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield ftxClient.request({
                method: "POST",
                path: "/orders",
                data: payload,
            });
            this.log.info({
                event: "PlaceOrder",
                params: data,
            });
        });
    }
    // noinspection JSMethodCanBeStatic
    toFtxMarket(market) {
        return {
            name: market.name,
            bid: market.bid ? new decimal_js_1.default(market.bid) : undefined,
            ask: market.ask ? new decimal_js_1.default(market.ask) : undefined,
            last: market.last ? new decimal_js_1.default(market.last) : undefined,
        };
    }
    // noinspection JSMethodCanBeStatic
    toFtxPosition(positionEntity) {
        return {
            future: positionEntity.future,
            netSize: new decimal_js_1.default(positionEntity.netSize),
            entryPrice: new decimal_js_1.default(positionEntity.entryPrice ? positionEntity.entryPrice : 0),
            realizedPnl: new decimal_js_1.default(positionEntity.realizedPnl ? positionEntity.realizedPnl : 0),
            cost: new decimal_js_1.default(positionEntity.cost ? positionEntity.cost : 0),
        };
    }
}
exports.Ftx = Ftx;
//# sourceMappingURL=Ftx.js.map