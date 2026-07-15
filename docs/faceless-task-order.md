# Faceless — Build Task Order

Each task below is sized to be one build prompt, one commit, following your workflow: prompt, run, verify, commit, next. Ordered by real dependency, not by priority alone, nothing here can be built out of order without hitting a wall.

---

### Phase 1 — Oracle script
1.1 Node script: call real SoSoValue `/currencies`, cache the list locally
1.2 Node script: call real `/currencies/{id}/klines`, pull daily OHLCV for a small fixed set of tokens (BTC, ETH, and 3 more)
1.3 Build the daily price Merkle tree from that data, depth 8, padded with dummy leaves
1.4 Generate a signing keypair, sign the day's root
1.5 Write root + signature to storage (JSON file or Supabase row)
1.6 Verify: print the root, print the signature, confirm it's deterministic on a second run with the same data

**Checkpoint:** you have one real, signed root from real prices, sitting in a file you can inspect.

---

### Phase 2 — Circuit
2.1 Copy `faceless_return.circom` into the project, install circomlib
2.2 Compile: `circom faceless_return.circom --r1cs --wasm --sym`, fix any errors
2.3 Run `snarkjs r1cs info` to get the real constraint count
2.4 Download an appropriately sized powers-of-tau file, run Groth16 setup
2.5 Build one real `input.json` using Phase 1's actual root and real klines prices for a made-up 5-token basket
2.6 Generate a witness, generate a proof, verify it locally with `snarkjs groth16 verify`

**Checkpoint:** one real proof, generated from real data, verified locally, before touching Solidity.

---

### Phase 3 — Verifier contract
3.1 `snarkjs zkey export solidityverifier` to generate the verifier contract
3.2 Write a small root-registry contract, stores signed roots, checks the oracle's signature
3.3 Deploy both to Sepolia with Foundry
3.4 Submit Phase 2's real proof to the deployed verifier, confirm it returns true on-chain
3.5 Confirm a deliberately wrong proof returns false, this matters for judges who probe it

**Checkpoint:** a real proof, verified by a real contract, on a real testnet, inspectable on Etherscan.

---

### Phase 4 — Frontend wallet and proving
4.1 Replace the simulated wallet modal's handlers with real `ethers.js` + `window.ethereum` calls
4.2 Add the mint form: 5 token pickers, amounts, entry/exit dates
4.3 Wire client-side proving: load the `.wasm` and `.zkey` as static files, call `snarkjs.groth16.fullProve()` in-browser
4.4 Submit only `proof.json`/`public.json` to the verifier contract via the connected wallet
4.5 Confirm in devtools that the private basket values never appear in any network request

**Checkpoint:** the actual privacy claim holds, verified by watching network traffic yourself, not assumed.

---

### Phase 5 — Metadata layer
5.1 Stand up the metadata API (Express or serverless), three endpoints from the architecture doc
5.2 Wire it to Supabase or the flat JSON store
5.3 Update dashboard to read real index state instead of the current placeholder cards
5.4 Update the activity log to real events instead of placeholder rows

**Checkpoint:** the dashboard reflects what actually happened on-chain, not sample data.

---

### Phase 6 — Demo readiness
6.1 Write the README section disclosing what's real vs pending, SoDEX, SSI, ValueChain, plainly
6.2 Write the demo script: exact order of clicks and what to say at each proof step
6.3 Full dry run, mint to verify, timed, on the actual deployed contracts
6.4 Fix whatever breaks in the dry run, this always finds something

---

## What's deliberately not in this list
Everything marked Future in the PRD, variable basket size, real SSI integration, ValueChain, multi-signer oracle. Touching any of those before Phase 6 is done is scope creep against a July 18 deadline.
