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

const API_BASE = 'https://openapi.sosovalue.com/api/v1';

// Fixed currency ids per the FACELESS spec.
const CURRENCIES = {
  BTC: '1673723677362319866',
  ETH: '1673723677362319867',
};

// Must match `component main = FacelessReturn(8)` in circuits/faceless_return.circom.
const TREE_DEPTH = 8;
const LEAF_COUNT = 2 ** TREE_DEPTH;

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

async function fetchKlines(currencyId, apiKey) {
  const url = `${API_BASE}/currencies/${currencyId}/klines?interval=1d&limit=5`;
  const res = await fetch(url, { headers: { 'x-soso-api-key': apiKey } });
  if (!res.ok) {
    throw new Error(`SoSoValue API HTTP ${res.status} for currency ${currencyId}: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.code !== 0) {
    throw new Error(`SoSoValue API error for currency ${currencyId}: ${body.message}`);
  }
  if (!Array.isArray(body.data) || body.data.length !== 5) {
    throw new Error(`Expected 5 klines for currency ${currencyId}, got ${body.data?.length ?? 0}`);
  }
  return body.data;
}

function poseidonHash(poseidon, inputs) {
  return poseidon.F.toObject(poseidon(inputs));
}

// leaf = Poseidon(currencyId, price, timestamp), matching BasketLeg's
// entryLeafHash/exitLeafHash in circuits/faceless_return.circom.
function buildLeaves(poseidon, klinesByCurrency) {
  const leaves = new Array(LEAF_COUNT).fill(0n);
  let idx = 0;
  for (const [symbol, klines] of Object.entries(klinesByCurrency)) {
    const currencyId = BigInt(CURRENCIES[symbol]);
    for (const k of klines) {
      const price = priceToFixedPoint(k.close);
      const timestamp = BigInt(k.timestamp);
      leaves[idx] = poseidonHash(poseidon, [currencyId, price, timestamp]);
      idx++;
    }
  }
  return leaves;
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

async function main() {
  const apiKey = requireApiKey();

  const klinesByCurrency = {};
  for (const symbol of Object.keys(CURRENCIES)) {
    klinesByCurrency[symbol] = await fetchKlines(CURRENCIES[symbol], apiKey);
  }

  const poseidon = await buildPoseidon();
  const leaves = buildLeaves(poseidon, klinesByCurrency);
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

  console.log(JSON.stringify(
    {
      day,
      oracleAddress: wallet.address,
      currencies: Object.fromEntries(
        Object.entries(klinesByCurrency).map(([symbol, klines]) => [
          symbol,
          klines.map((k) => k.close),
        ])
      ),
      merkleRoot: sig.rootHex,
      signature: {
        r: sig.r,
        s: sig.s,
        v: sig.v,
        compact: sig.compact,
      },
      writtenTo: ROOTS_FILE,
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
