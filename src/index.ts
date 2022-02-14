import { runDiffBot } from "./bot";
import { runFundingBot } from "./funding";
import * as dotenv from "dotenv";

(async () => {
  dotenv.config();
  //runDiffBot();
  runFundingBot();
})();
