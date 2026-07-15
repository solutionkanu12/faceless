# Faceless — System Architecture

## Non-negotiable constraint

Proof generation happens client-side, in the browser, using snarkjs with the compiled wasm and proving key. The private basket, tokens, amounts, prices, never leaves the user's device. If any backend step ever received that data, the entire privacy claim would be false. Every layer below is designed around this.

---

## 1. Frontend

**Already built:** static HTML, CSS, vanilla JS, GSAP for scroll animation, an island nav, the sealed dossier tag, a simulated wallet-to-dashboard flow.

**What changes for the real build:**
- Replace the simulated wallet modal's click handlers with real calls to `window.ethereum` (MetaMask) via `ethers.js`, loaded from CDN, no framework rewrite needed, keeps the existing file as-is structurally.
- Add a proving step in the browser: load `faceless_return_js/witness_calculator.js` and the `.wasm` + `.zkey` files, call `snarkjs.groth16.fullProve()` with the user's private inputs, entirely client-side.
- Add a small form for minting, 5 token pickers, amounts, dates, feeding the private witness.
- Submit only `proof.json` and `public.json` to the verifier contract, never the private inputs.

**Recommendation:** keep vanilla JS. A framework rewrite costs days you don't have and buys nothing the current stack can't already do.

---

## 2. Backend

Deliberately thin, because the trust model lives in the circuit and the contract, not a server. Two small services:

**A. Oracle script** (Node, runs on a schedule or on-demand)
- Calls SoSoValue's real `/currencies` and `/currencies/{id}/klines` endpoints
- Builds today's price Merkle tree (fixed depth 8, matching the circuit)
- Signs the root with a keypair we control
- Writes the signed root to the database (below), publicly readable

**B. Metadata API** (Node/Express or serverless functions)
- `GET /indexes` — public list, ticker, mint date, verified return, proof hash, status
- `GET /indexes/:id/proof` — returns `proof.json` and `public.json` for independent re-verification
- `POST /oracle/sign-root` — internal only, triggers the oracle script, not user-facing

Neither service ever receives a private basket. They only ever see and serve public, already-sealed data.

---

## 3. Database

Small and mostly public, by design. Two realistic options given the timeline:

**Recommended for speed:** Supabase (hosted Postgres, free tier, minutes to set up), three tables:
- `daily_price_sheets (day, currency_id, price)` — cache of real klines pulls
- `signed_roots (day, merkle_root, signature)` — append-only, public
- `indexes (index_id, ticker, owner_address, minted_at, verified_return, proof_hash, status)` — what the dashboard renders

**Faster still, if Supabase setup is a distraction:** a flat JSON file per table, served by the metadata API, committed to the repo. No infra to provision. Fine at this scale, upgrade later if it matters.

Nothing else is stored. No private basket data ever reaches either option.

---

## 4. Authentication

Wallet-based, not passwords. Sign-In-With-Ethereum pattern:
1. Frontend requests a nonce from the API
2. User signs a message containing that nonce with their wallet
3. API verifies the signature matches the claimed address
4. That address is now the authenticated identity for actions like "show my indexes"

No accounts, no passwords, no session data beyond a short-lived signed-nonce check.

---

## 5. APIs

**External, confirmed real:**
- Base: `https://openapi.sosovalue.com/api/v1`
- Auth header: `x-soso-api-key`
- `GET /currencies`, `GET /currencies/{id}/klines?interval=1d&limit=N`
- Rate limit: 10 req/min, 10,000/month, Demo Plan

**Internal, ours:**
- `GET /indexes`, `GET /indexes/:id/proof`, `POST /oracle/sign-root` (as above)

---

## 6. Smart contracts

- **Verifier contract**, snarkjs-generated from the circuit's proving key, deployed to Sepolia
- **Root registry contract** (small, separate concern), stores each day's signed root, checks the oracle's signature once per root, not per proof, this is what keeps the whole system cheap

---

## 7. Deployment

Matching a pattern already proven to work for you on prior builds:
- **Frontend:** Vercel, static files, same as before
- **Backend (oracle + metadata API):** Render, small Node service
- **Database:** Supabase, or flat JSON served by the same Render service
- **Contracts:** Sepolia, deployed via Foundry from the existing `ssi-protocol`-style tooling you already have installed (`forge`, `cast`, `anvil` are already on your machine per the repo clone)
- **Circuit artifacts** (`.wasm`, `.zkey`, verification key): hosted as static files alongside the frontend on Vercel, so the browser can fetch them for client-side proving without hitting the backend at all

---

## 8. Why it's this small

A judge reading this should see that the architecture is exactly as big as the trust model requires, and no bigger. Anything heavier, user accounts, session databases, server-side proving, would either weaken the privacy claim or exist for no reason. That restraint is itself part of the pitch.
