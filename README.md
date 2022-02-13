# 01-Arb

*please use caution and burner wallets when using this experimental software*

# What is it

This is a fork of [this repo](https://github.com/chenwainuo/drifting-mango/tree/master/src), credits go to [chenwainuo](https://github.com/chenwainuo)

The program looks at 01 SOL-PERP price and Drift SOL-PERP price. 

Once the gap becomes wide enough, it opens a postion on both side to close the gap.

For example if 01 is selling at 260 and Drift is selling at 230, it will open 01 market short and Drift market long (in one transaction!).

# Pre-requisite

1. You will need a Drift account
2. Deposit USDC into Drift via UI
3. Create new 01 Account in the same wallet via UI
4. Deposit same amount of money into 01
5. Create an open orders account for the market you want to arb by placing a position on that market and closing it in the UI (for both 01 and Drift)
6. Copy `.env.example` to `.env`
7. Fill in all parameters for `.env`, don't modify the last line
8. Choose if you want to use the funding arb or the price differential arb by modifying [`src/index.ts`](src/index.ts)
9. Enjoy 

Quick Start
----
```
npm i  # or yarn
ts-node src/index.ts
```

# Disclaimer

NFA, everything is written as an experiment, please don't put more than couple bucks into it.  
Do not use software without understanding what it does.  
It also has no liquidation preventive measure, you will get liquidated.

This repo is meant as a guide for interfacing with 01 code and demonstrates some tools one might need if they wanted to write a bot.
Use with caution.