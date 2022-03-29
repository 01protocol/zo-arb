//import { runDiffBot } from "./bot";
//import { runFundingBot } from "./funding";
import * as dotenv from "dotenv";
import { runFtxDiffBot } from "./ftx_index";

(async () => {
  dotenv.config();
  //runDiffBot();
  //runFundingBot();
  runFtxDiffBot();
})();
