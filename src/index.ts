import { Bot } from "./Bot";
import { Drift } from "./Drift";
import * as dotenv from "dotenv";
import { sleep } from "@zero_one/client";

(async () => {
  dotenv.config();

  const drift = new Drift();
  await drift.setup();

  console.log(`Market price: $${ (await drift.getMarketPrice()).toString() }`);
  await sleep(1000);
  console.log(`Market price: $${ (await drift.getMarketPrice()).toString() }`);

  //const bot = new Bot();
  //await bot.run();
})();
