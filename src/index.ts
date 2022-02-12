import { runDiffBot } from "./bot";
import * as dotenv from "dotenv";

(async () => {
  dotenv.config();
  runDiffBot();
})();
