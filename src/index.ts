import { Bot } from "./Bot";
import * as dotenv from "dotenv";

(async () => {
  dotenv.config();

  const bot = new Bot();
  await bot.run();
})();
