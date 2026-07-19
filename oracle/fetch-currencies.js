import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const OUT_FILE = path.join(DATA_DIR, 'currencies.json');

const API_BASE = 'https://openapi.sosovalue.com/api/v1';

function requireApiKey() {
  const key = process.env.SOSO_API_KEY;
  if (!key) {
    throw new Error(
      'SOSO_API_KEY is not set. Copy oracle/.env.example to oracle/.env and fill in your key.'
    );
  }
  return key;
}

async function fetchCurrencies(apiKey) {
  const url = `${API_BASE}/currencies`;
  const res = await fetch(url, { headers: { 'x-soso-api-key': apiKey } });
  if (!res.ok) {
    throw new Error(`SoSoValue API HTTP ${res.status} for /currencies: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.code !== 0) {
    throw new Error(`SoSoValue API error for /currencies: ${body.message}`);
  }
  return body.data;
}

async function main() {
  const apiKey = requireApiKey();
  const currencies = await fetchCurrencies(apiKey);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(currencies, null, 2) + '\n');

  console.log(`Fetched ${currencies.length} currencies from SoSoValue. Wrote ${OUT_FILE}`);
  console.log(JSON.stringify(currencies.slice(0, 3), null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
