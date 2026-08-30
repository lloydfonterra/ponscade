# Ponscade

Browser arcade on **Robinhood Chain**. Players check in with a **username + wallet address** (no wallet popup). **One wallet can register once.** Each wallet gets **10 turns per day**. The daily pot pays the **top 10 automatically** to those saved addresses, then the board resets at 00:00 UTC.

Trading fees on `$PONSCADE` (claimed every 20 minutes, PonsMe-style) split:

- **10%** daily prize pot
- **10%** buyback and burn
- **80%** buy top Robinhood tokens (e.g. `$PONS`) and airdrop to holders with at least **666,666** `$PONSCADE`

Not affiliated with Robinhood, Pons Labs, Webcade, or PonsMe.

## Run

```bash
cd ponscade
npm install
npm run dev
```

Open http://localhost:5173

## After you launch the token

1. Create `$PONSCADE` on [Pons](https://docs.ponsfamily.com/v2).
2. Put the mint in `.env.local`:

```
VITE_PONSCADE_TOKEN=0xYourToken
```

## MVP vs later

Ships now: check-in, three cabinets, local top-10 board, documented 10/10/80 flywheel.

Not shipped yet: fee-claim bot, real payouts to typed addresses, holder snapshot for the 666,666 airdrop floor.
