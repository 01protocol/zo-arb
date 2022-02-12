import { Keypair } from '@solana/web3.js';
import {
    initialize,
    PositionDirection,
    DriftEnv
} from '@drift-labs/sdk';
import { ZoArbClient } from './zo';
import { DriftArbClient } from './drift';
import Wallet from "@project-serum/anchor/dist/cjs/nodewallet.js";
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";
import { getTime } from './utils';


require('dotenv').config();

// % differences between markets to initiate a position.
// higher is likely more profitable but less opportunities
// at drift long it's comparing to (zo short price - drift long price) / drift long price * 100
// at rift short it's comparing (drift short price - zo long price) / zo long price * 100
// TODO: MAKE IT DYNAMIC
const THRESHOLD = parseFloat(process.env.THRESHOLD);

// size for each position, there could be multiple positions until price is within threshold
const POSITION_SIZE_USD = parseFloat(process.env.POSITION_SIZE_USD);

// Max position size before going reduce only mode (+/- POSITION_SIZE_USD)
const MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE);

// Private key array
// Please read from file system or environment...
// Also have it setup & deposit money into it via Phantom.
// You can import the array into Phantom as private key string.
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// RPC address, please don't use public ones.
const RPC_ADDRESS = process.env.RPC_ADDRESS;

export const runFundingBot = async () => {
    const sdkConfig = initialize({ env: 'mainnet-beta' as DriftEnv });

    // Set up the Wallet and Provider
    const privateKey = PRIVATE_KEY
    const keypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKey))
    );
    const wallet = new Wallet(keypair);

    const driftArbClient = new DriftArbClient();
    await driftArbClient.init(wallet);

    const zoArbClient = new ZoArbClient(wallet);
    await zoArbClient.init();

    async function mainLoop() {
        if (!driftArbClient.priceInfo.shortEntry || !driftArbClient.priceInfo.longEntry) {
            return
        }

        let [minutes, seconds] = getTime();
        //if (minutes !== 59 || seconds !== 58) {
        //    return
        //}

        const zoBid = await zoArbClient.getTopBid()
        const zoAsk = await zoArbClient.getTopAsk()

        // At the end of each hour, check the funding rates for each exchange.
        // If the funding rates sum to more than the threshold * the spread, then open a position.
        // After funding is collected, close the position.

        let zoLongFunding = await zoArbClient.getLongFunding()
        let zoShortFunding = await zoArbClient.getShortFunding()

        let driftLongFunding = await driftArbClient.getLongFunding()
        let driftShortFunding = await driftArbClient.getShortFunding()

        let zoSpread = zoAsk - zoBid
        let driftSpread = driftArbClient.priceInfo.longEntry - driftArbClient.priceInfo.shortEntry

        let zoShortDiff = (zoLongFunding + driftShortFunding - zoSpread - driftSpread) / (zoSpread + driftSpread) * 100
        let zoLongDiff = (zoShortFunding + driftLongFunding - zoSpread - driftSpread) / (zoSpread + driftSpread) * 100

        console.log(`driftFunding ${driftLongFunding} ${driftShortFunding}, zoFunding ${zoLongFunding} ${zoShortFunding}, zoSpread ${zoSpread}, driftSpread ${driftSpread}, zoShortDiff ${zoShortDiff}, zoLongDiff ${zoLongDiff}`)
        console.log(`Buy Drift Sell 01 Diff: ${zoShortDiff.toFixed(4)}%. // Buy 01 Sell Drift Diff: ${zoLongDiff.toFixed(4)}%.`)

        let canOpenDriftLong = await driftArbClient.getCanOpenLong()
        let canOpenDriftShort = await driftArbClient.getCanOpenShort()

    }
    setInterval(mainLoop, 500)
}
