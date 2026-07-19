import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPoseidon } from 'circomlibjs';
import { Wallet, keccak256, toBeHex } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEYS_DIR = path.join(__dirname, 'keys');
const DATA_DIR = path.join(__dirname, 'data');
const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'oracle.key');
const ADDRESS_FILE = path.join(KEYS_DIR, 'oracle.address');
const ROOTS_FILE = path.join(DATA_DIR, 'roots.json');
const PRICE_SHEET_FILE = path.join(DATA_DIR, 'price-sheet.json');

const API_BASE = 'https://openapi.sosovalue.com/api/v1';

// Five real SoSoValue currencies backing the fixed 5-token basket. IDs
// confirmed live against GET /currencies.
const CURRENCIES = {
  BTC: '1673723677362319866',
  ETH: '1673723677362319867',
  SOL: '1673723677362319875',
  BNB: '1673723677362319869',
  XRP: '1673723677362319871',
};

// Must match `component main = FacelessReturn(8)` in circuits/faceless_return.circom.
const TREE_DEPTH = 8;
const LEAF_COUNT = 2 ** TREE_DEPTH;

// SoSoValue's /klines endpoint caps out at 90 daily candles regardless of a
// higher requested limit (confirmed empirically). 50 days x 5 currencies =
// 250 leaves, under the circuit's fixed 256-leaf (depth 8) capacity.
const DAYS_PER_CURRENCY = 50;
if (Object.keys(CURRENCIES).length * DAYS_PER_CURRENCY > LEAF_COUNT) {
  throw new Error('CURRENCIES x DAYS_PER_CURRENCY exceeds LEAF_COUNT, tree cannot hold this many real leaves.');
}

// Prices come back as floats (e.g. 63819.0). Scale to an integer fixed-point
// representation before hashing, since Poseidon operates over field elements.
const PRICE_SCALE = 100_000_000n; // 1e8, satoshi-level precision

function priceToFixedPoint(price) {
  return BigInt(Math.round(price * 1e8));
}

function requireApiKey() {
  const key = process.env.SOSO_API_KEY;
  if (!key) {
    throw new Error(
      'SOSO_API_KEY is not set. Copy oracle/.env.example to oracle/.env and fill in your key.'
    );
  }
  return key;
}

async function fetchKlines(currencyId, apiKey, limit) {
  const url = `${API_BASE}/currencies/${currencyId}/klines?interval=1d&limit=${limit}`;
  const res = await fetch(url, { headers: { 'x-soso-api-key': apiKey } });
  if (!res.ok) {
    throw new Error(`SoSoValue API HTTP ${res.status} for currency ${currencyId}: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.code !== 0) {
    throw new Error(`SoSoValue API error for currency ${currencyId}: ${body.message}`);
  }
  if (!Array.isArray(body.data) || body.data.length !== limit) {
    throw new Error(`Expected ${limit} klines for currency ${currencyId}, got ${body.data?.length ?? 0}`);
  }
  return body.data;
}

function poseidonHash(poseidon, inputs) {
  return poseidon.F.toObject(poseidon(inputs));
}

// leaf = Poseidon(currencyId, price, timestamp), matching BasketLeg's
// entryLeafHash/exitLeafHash in circuits/faceless_return.circom.
//
// Also returns `sheet`, the raw (non-hashed) data behind each real leaf.
// The signed root alone is not enough to prove inclusion later: whoever
// builds a Merkle inclusion path (the oracle here, or client-side proving
// code) needs the exact currencyId/price/timestamp/index behind every real
// leaf, in the same order used to build the tree. Padding leaves (index
// beyond the real data, up to LEAF_COUNT) are the field element 0n, exactly
// as circomlibjs's Poseidon would never output, so they can't collide with
// a real leaf hash.
function buildLeaves(poseidon, klinesByCurrency) {
  const leaves = new Array(LEAF_COUNT).fill(0n);
  const sheet = [];
  let idx = 0;
  for (const [symbol, klines] of Object.entries(klinesByCurrency)) {
    const currencyId = BigInt(CURRENCIES[symbol]);
    for (const k of klines) {
      const price = priceToFixedPoint(k.close);
      const timestamp = BigInt(k.timestamp);
      leaves[idx] = poseidonHash(poseidon, [currencyId, price, timestamp]);
      sheet.push({
        index: idx,
        symbol,
        currencyId: currencyId.toString(),
        price: price.toString(),
        timestamp: timestamp.toString(),
      });
      idx++;
    }
  }
  return { leaves, sheet };
}

function buildMerkleRoot(poseidon, leaves, depth) {
  let level = leaves;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidonHash(poseidon, [level[i], level[i + 1]]));
    }
    level = next;
  }
  return level[0];
}

function loadOrCreateWallet() {
  const hasKeys = fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(ADDRESS_FILE);
  if (hasKeys) {
    const privateKey = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8').trim();
    return { wallet: new Wallet(privateKey), isNew: false };
  }

  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const wallet = Wallet.createRandom();
  fs.writeFileSync(PRIVATE_KEY_FILE, wallet.privateKey + '\n', { mode: 0o600 });
  fs.writeFileSync(ADDRESS_FILE, wallet.address + '\n', { mode: 0o644 });
  try {
    fs.chmodSync(PRIVATE_KEY_FILE, 0o600);
  } catch {
    // best-effort; not all filesystems honor unix perms
  }
  return { wallet, isNew: true };
}

// Signs keccak256(bytes32(root)) directly (no personal-message prefix), so a
// root-registry contract can recover the signer with a plain ecrecover call.
function signRoot(wallet, root) {
  const rootHex = toBeHex(root, 32);
  const digest = keccak256(rootHex);
  const signature = wallet.signingKey.sign(digest);
  return {
    rootHex,
    digest,
    r: signature.r,
    s: signature.s,
    v: signature.v,
    compact: signature.serialized,
  };
}

function upsertRootRecord(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let roots = [];
  if (fs.existsSync(ROOTS_FILE)) {
    roots = JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8'));
  }
  roots = roots.filter((r) => r.day !== record.day);
  roots.push(record);
  roots.sort((a, b) => a.day.localeCompare(b.day));
  fs.writeFileSync(ROOTS_FILE, JSON.stringify(roots, null, 2) + '\n');
  return roots;
}

function writePriceSheet(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PRICE_SHEET_FILE, JSON.stringify(record, null, 2) + '\n');
}

async function main() {
  const apiKey = requireApiKey();

  const klinesByCurrency = {};
  for (const symbol of Object.keys(CURRENCIES)) {
    klinesByCurrency[symbol] = await fetchKlines(CURRENCIES[symbol], apiKey, DAYS_PER_CURRENCY);
  }

  const poseidon = await buildPoseidon();
  const { leaves, sheet } = buildLeaves(poseidon, klinesByCurrency);
  const root = buildMerkleRoot(poseidon, leaves, TREE_DEPTH);

  const { wallet, isNew } = loadOrCreateWallet();
  if (isNew) {
    console.log(`Generated new oracle keypair. Address: ${wallet.address}`);
  }

  const sig = signRoot(wallet, root);
  const day = new Date().toISOString().slice(0, 10);

  const record = {
    day,
    merkleRoot: sig.rootHex,
    signature: sig.compact,
  };

  const roots = upsertRootRecord(record);

  // This is the piece oracle/index.js never used to persist: the raw leaf
  // data behind the signed root, without which no one can build a Merkle
  // inclusion path for proving. treeDepth/leafCount are included so
  // consumers don't have to hardcode circuit constants separately.
  writePriceSheet({
    day,
    merkleRoot: sig.rootHex,
    treeDepth: TREE_DEPTH,
    leafCount: LEAF_COUNT,
    currencies: CURRENCIES,
    daysPerCurrency: DAYS_PER_CURRENCY,
    leaves: sheet,
  });

  console.log(JSON.stringify(
    {
      day,
      oracleAddress: wallet.address,
      currencies: Object.fromEntries(
        Object.entries(klinesByCurrency).map(([symbol, klines]) => [
          symbol,
          { days: klines.length, firstClose: klines[0].close, lastClose: klines[klines.length - 1].close,
            firstTimestamp: klines[0].timestamp, lastTimestamp: klines[klines.length - 1].timestamp },
        ])
      ),
      merkleRoot: sig.rootHex,
      signature: {
        r: sig.r,
        s: sig.s,
        v: sig.v,
        compact: sig.compact,
      },
      realLeaves: sheet.length,
      leafCapacity: LEAF_COUNT,
      writtenTo: ROOTS_FILE,
      priceSheetWrittenTo: PRICE_SHEET_FILE,
      totalRecordsInFile: roots.length,
    },
    null,
    2
  ));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
