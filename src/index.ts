import * as dotenv from "dotenv";
import { runFtxPriceArb } from "./arbs/ftxPriceArb";
import * as bunyan from "bunyan";
import { runZammFtxPriceArb } from "./arbs/zammFtxPriceArb";

(async () => {
  dotenv.config();

  switch (process.env.ARB) {
    case "ZammFtx":
      const logZamm = bunyan.createLogger({
        name: "ZoArb",
        arb: "ZammFtxPriceArb",
        level: "debug",
        serializers: bunyan.stdSerializers,
      });
      runZammFtxPriceArb(logZamm).catch((e: any) => {
        logZamm.error({ err: e });
        process.exit();
      });
      break;
    case "FtxPrice":
      const logFtx = bunyan.createLogger({
        name: "ZoArb",
        arb: "FtxPriceArb",
        level: "debug",
        serializers: bunyan.stdSerializers,
      });
      runFtxPriceArb(logFtx).catch((e: any) => {
        logFtx.error({ err: e });
        process.exit();
      });
      break;
    default:
      return process.exit(1);
  }
})();
