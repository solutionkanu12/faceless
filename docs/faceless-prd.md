# Faceless — Product Requirements Document
**SoSoValue WaveHack, Wave 3 submission**
**Deadline: July 18**

---

## 1. Problem

Every alpha caller in crypto faces the same trade off. Reveal a trading strategy and it gets copied or front run within a day, destroying the edge that made the returns real. Hide it and ask people to trust a screenshot, which proves nothing and builds no accountability. Nobody has solved provable and private at once.

## 2. Solution

Faceless lets a trader mint a sealed on-chain index around a private thesis. Followers see a verified, provably real return. The positions, weights, and identity behind that return stay sealed, even from Faceless itself. A zero-knowledge proof does the verifying, not trust.

## 3. Goals and success criteria

Mapped directly to the WaveHack judging criteria, since that's what this PRD is scored against.

| Criteria | What satisfies it |
|---|---|
| User Value & Practical Impact | A real, named trade-off solved (reveal vs trust), not invented for the hackathon |
| Functionality & Working Demo | Real circuit, real verifier contract on Sepolia, real proof generated live, not staged |
| Logic, Workflow & Product Design | Fixed 5-token basket, no-division return math, Merkle-attested prices, documented end to end |
| Data / API Integration | Real SoSoValue Data API calls (`/currencies`, `/klines`), visibly used, not mocked |
| UX & Clarity | Existing built UI: island nav, sealed dossier tag, wallet flow, dashboard |

Submission is successful if a judge can watch a real proof generate and verify on Sepolia within the live demo, using real SoSoValue price data, without any step being faked.

## 4. User stories

- As an alpha caller, I want to mint an index around my private strategy, so followers can invest in my track record without seeing my trades.
- As a follower, I want to see a verified return on a sealed index, so I can trust the number without trusting the person.
- As a judge, I want to watch a real proof generate and verify on-chain, so I can confirm the claim isn't staged.
- As Faceless the platform, I want to never have access to the underlying strategy either, so the privacy guarantee holds even against us.

## 5. User flow

1. Visitor lands on the site, sees a sealed index dossier and the core claim above the fold.
2. Clicks connect wallet, picks a simulated wallet, lands in the dashboard.
3. Dashboard shows existing sealed indexes with verified returns and a mint new index action.
4. Minting an index (real, next phase): trader privately inputs 5 tokens, amounts, entry data.
5. At exit, trader inputs exit data. The app calls SoSoValue's real API for entry and exit klines.
6. Off-chain script builds or reads the signed daily price Merkle root for those two days.
7. Circuit proves the return, given the private basket and the two roots, without revealing the basket.
8. Proof and public inputs, roots, claimed return, are submitted to the Sepolia verifier contract.
9. Verifier confirms on-chain. Dashboard updates the index card to verified with the real proof hash.
10. Anyone, including a judge, can independently verify the same proof against the same contract.

## 6. Features

### Must have
- Wallet connect to dashboard flow, already built
- Off-chain oracle script, real SoSoValue klines to daily price Merkle tree to signed root
- Circuit, 5-token basket return proof against two signed roots, no basket reveal, no division
- Solidity verifier, snarkjs-generated, plus root signature check, deployed to Sepolia
- Dashboard reflecting real index state and real proof status, currently placeholder data
- README disclosing plainly what is real versus pending, SoDEX and SSI access, ValueChain

### Nice to have
- Small AI layer reading real price and news data to suggest rebalances, closes the AI x Web3 tag gap
- Public page, paste a proof and verify it yourself
- Multiple live example indexes
- Activity log wired to real on-chain events instead of placeholder rows

### Future, explicitly out of scope now
- Variable basket size beyond a fixed 5
- Real SSI or SoDEX integration, gated behind their participant role we do not have
- ValueChain deployment, no public testnet RPC found
- Multi-signer price oracle instead of a single key
- Multi-period or rolling proofs instead of a single entry-exit snapshot

## 7. System architecture

```
SoSoValue Data API, real klines
        |
        v
Oracle script, off-chain
        |
builds daily price Merkle tree
        |
signs root with our key
        |
        v
User's private basket, 5 tokens, amounts,      Circom circuit
entry and exit prices, Merkle paths  ------->  proof.json, public.json
(never leaves the user's device)                       |
                                                        v
                                          Sepolia verifier contract
                                          checks root signature, once per day
                                          checks proof validity
                                                        |
                                                        v
                                          Dashboard reads verified state
```

## 8. Database requirements

No user financial data is stored in a traditional database, the trust model depends on the chain and the proof, not a backend record. What does need lightweight storage, off-chain, non-sensitive:

- Daily price sheets, `day, currencyId, price` rows used to build each day's Merkle tree. Source of truth is SoSoValue's API, this is a cache, not a ledger.
- Signed roots log, `day, merkleRoot, signature`, small, append only, public.
- Index metadata, public, `indexId, ticker, mintedAt, verifiedReturn, proofHash, status`, what the dashboard renders. No positions, no amounts, no wallet-identifying data beyond the owning address.
- Nothing else is stored server-side. Private basket data, tokens, amounts, individual prices, exists only on the user's device at proving time and is never transmitted or persisted anywhere, that is the entire point of the product.

## 9. APIs

### External, confirmed real
- Base, `https://openapi.sosovalue.com/api/v1`, verified working, differs from the docs' stated `/openapi/v1`
- Auth header, `x-soso-api-key`
- `GET /currencies`, list, real currency_id per token
- `GET /currencies/{currency_id}/klines?interval=1d&limit=N`, real daily OHLCV, only daily interval supported, only trailing 3 months queryable
- Rate limit, 10 requests per minute, 10,000 per month, Demo Plan, confirmed from account dashboard

### Internal, to be built
- `POST /oracle/sign-root`, internal only, builds today's price tree, signs it, not user-facing
- `GET /indexes`, public metadata list for the dashboard
- `GET /indexes/{id}/proof`, returns proof.json and public.json for independent verification

## 10. Smart contracts and circuit summary

- Circuit, fixed 5-token basket, private amounts, prices, and paths, public entry root, exit root, claimed return in basis points as a signed magnitude plus sign flag, no in-circuit signature verification, no division, Groth16.
- Verifier, snarkjs-generated Solidity contract, deployed to Sepolia.
- Root signature check, separate, cheap, outside the circuit, in the same or a small companion contract.
- Confirmed real permission fact, SoSoValue's own SSI mint and rebalance require their signer plus owner roles we do not have, this is why Faceless deploys standalone rather than integrating live with their contracts. Disclosed, not hidden.

## 11. Known limitations, disclosed on purpose

- SoDEX and SSI native minting are not live in this build, both are permission gated on their end, confirmed from their real source code.
- ValueChain is not the deploy target, no public testnet RPC found, Sepolia is used instead.
- Price attestation uses a single signer key for the hackathon, not a decentralized oracle network.
- Basket size fixed at 5 tokens for v1.

## 12. Milestones toward July 18

1. Oracle script, fetch real klines, build tree, sign root
2. Circuit compiles clean, trusted setup done, one real proof generated locally
3. Verifier deployed to Sepolia, one real proof verified on-chain
4. Dashboard wired to real proof state
5. README and demo script finalized, limitations disclosed plainly
