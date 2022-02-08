import { Bot } from "./Bot";
import { main } from "./Drift";
import * as dotenv from "dotenv";

(async () => {
  dotenv.config();

  await main();

  const bot = new Bot();
  await bot.run();
})();
