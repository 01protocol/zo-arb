import { main } from "./bot";
import * as dotenv from "dotenv";

(async () => {
  dotenv.config();
  main();
})();
