# Faceless

**Prove your alpha. Stay faceless.**

Faceless lets a trader mint a sealed on-chain index around a private thesis. Anyone can verify the returns are real. Nobody, not even Faceless, can see the trades behind them.

Built for SoSoValue WaveHack, Wave 3.

## The idea

Traders with real edge face a bad trade-off. Post your positions publicly and you get front-run within a day. Keep them private and nobody can verify you're actually good. Faceless closes that gap with zero-knowledge proofs: a trader proves their return is real, backed by real market data, without revealing a single position, weight, or trade.

## How it actually works, and what's genuinely real here

This isn't a mockup with fake numbers. Every piece below is deployed, tested live, and does what it says.

**The price data is real.** A backend oracle pulls daily BTC, ETH, SOL, BNB, and XRP prices directly from SoSoValue's live API, builds a Merkle tree of those prices using Poseidon hashing, and signs the daily root with a real ECDSA key. This runs against SoSoValue's actual endpoint, not mocked data.

**The circuit is real.** A Circom circuit, compiled to 47,665 constraints, proves a claimed return is mathematically correct against the signed price data: entry price, exit price, and a basket of five tokens, all without exposing any of it. A real Groth16 trusted setup was run using the actual Hermez/iden3 powers-of-tau ceremony file, not a locally faked one.

**Proof generation happens entirely in your browser.** When you mint an index, `snarkjs.groth16.fullProve()` runs client-side, loading the compiled circuit and proving key as static files. Your basket, your amounts, your prices never touch a server. This isn't a claim taken on faith, it was checked directly in the browser's network tab: during proof generation, the only requests that fire are the two public circuit files. Nothing else goes out.

**The verifier is real and deployed.** The generated proof gets submitted as a real transaction to a Groth16 verifier contract on Sepolia. `verifyProof()` genuinely returns true for a real, valid proof, and false for a deliberately tampered one, both confirmed on the live deployed contract, not just tested locally.

**Wallet connect is real.** Built on Reown AppKit, supporting MetaMask, OKX Wallet, WalletConnect, and others, restricted to Sepolia.

**Mint history is real, and it's verified twice.** After a proof is confirmed onchain, a Supabase Edge Function independently re-checks the actual transaction on Sepolia before recording anything: it confirms the transaction is really mined, really calls the real verifier contract, and that the return being recorded genuinely matches what the transaction proved onchain. A row can't be inserted by forging a wallet signature and typing in whatever numbers you want. Both the signature and the underlying transaction are checked server-side before anything is written.

## What isn't live, on purpose, and why

**No live integration with SoSoValue's SSI protocol or SoDEX.** Their contracts require a signer role, an owner confirmation, and participant permissions that Faceless doesn't hold. Rather than fake an integration, Faceless deploys standalone and discloses this plainly.

**Sepolia instead of ValueChain.** ValueChain's mainnet exists, but no public testnet RPC was reachable during the build. Sepolia was used instead, and that's a deliberate, disclosed substitution.

**A single oracle signer, not a decentralized network.** For this build, one keypair signs the daily price root. A production version would need multiple independent signers so no single party controls the price feed. This is the one piece of the trust model that's centralized right now, and it's the most honest thing to flag about it.

## Stack

Circom 2.2.3, snarkjs 0.7.6, Groth16, Solidity verifier deployed via Foundry on Sepolia, Reown AppKit, ethers.js, Supabase (Postgres, Row Level Security, Edge Functions), SoSoValue API for real market data.