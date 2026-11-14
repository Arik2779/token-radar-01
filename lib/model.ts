// Token Radar's value model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every genuine pre-token protocol the snapshot carries: the whole watchlist (the
// floor, never a ceiling) plus every pre-token protocol below the floor that is not a wrapped, staked
// or bridged product of a token that already trades. That product rule is the watchlist's own rule,
// from the competition's RULES.txt, applied to the whole board: WBTC is Bitcoin on Ethereum and
// Binance staked ETH is ETH in a staking product, so neither is a launch the radar should rank.
// The set-aside protocols are shown in the dashboard as their own tab, never mixed into the ranking.
//
// Implied value is derived from the snapshot's own figures, never from a list of names:
//
//   ratio(category)  = the FDV/TVL ratio the market already pays that category, read off the
//                      token-bearing protocols in this same snapshot: each protocol's
//                      mcap_usd / tvl_usd, clamped to [0.001, 5], taken as the category median,
//                      then shrunk toward the global median with a prior of 8 protocols:
//                      (n * median + 8 * globalMedian) / (n + 8). A category with no token-bearing
//                      protocol of its own takes the global median. No name is special-cased.
//   growth           = clamp(change_7d, -60, 120) per cent
//   growthMult       = 1 + (growth / 100) * 0.5
//   maturity         = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   implied          = max(1, round(tvl_usd * ratio * growthMult * maturity))
//
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol). Live-token protocols are kept apart and shown with the market's own market cap, never
// mixed into the ranked board. Every farm plan is generated from the protocol's own record
// (category, chains, TVL, age): the action, the capital, the gas and the hold window all follow
// from those figures.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  ratio_cap_low: number;
  ratio_cap_high: number;
  ratio_shrink_n: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  ratio_cap_low: 0.001,
  ratio_cap_high: 5,
  ratio_shrink_n: 8,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    ratio: number;
    ratio_protocols: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  ratio: number;
  ratio_protocols: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A wrapped, staked or bridged product of a token that already trades: set aside, never ranked. */
export interface WrappedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
}

/** One category's FDV/TVL ratio as the snapshot's own token-bearing protocols price it. */
export interface CategoryRatio {
  category: string;
  protocols: number;
  median: number;
  ratio: number;
}

/** Everything the dashboard needs: the board, the set-aside sets, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_ratio: number;
  category_ratios: CategoryRatio[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  wrapped_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  wrapped: WrappedRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ---------------------------------------------------------------- the ratio table

/** Categories the watchlist rule treats as a wrapped, staked or bridged product. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name ending in a release marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word `wrapped`, `staked` or `staking`. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a wrapped product's name may begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, not a wrapped product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p) && !VERSIONED.test(p.name);
}

/** Why a pre-token protocol is set aside instead of ranked. */
export function wrappedReason(p: SnapshotProtocol): string {
  if (p.category === 'CEX') return 'it is a centralised exchange, not a protocol launch';
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return `its category, ${p.category}, is a wrapped, staked or bridged product`;
  if (WRAPPED_WORD.test(p.name)) return 'its name marks it as wrapped or staked';
  if (EXCHANGE_PREFIX.test(p.name)) return 'its name begins with an exchange';
  if (VERSIONED.test(p.name)) return 'its name ends in a version marker';
  return 'its record marks it as a product of another protocol';
}

/**
 * The FDV/TVL ratio table, read off the snapshot's token-bearing protocols: for each category the
 * median of its protocols' mcap_usd / tvl_usd (each ratio clamped to the model's caps first), shrunk
 * toward the global median with the model's prior. Returns the table and the global median.
 */
export function categoryRatios(snapshot: Snapshot, model: ModelConstants = MODEL): { table: CategoryRatio[]; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = Math.min(model.ratio_cap_high, Math.max(model.ratio_cap_low, p.mcap_usd / p.tvl_usd));
    all.push(r);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(r);
    byCategory.set(key, list);
  }
  all.sort((a, b) => a - b);
  const global = medianOf(all);
  const table: CategoryRatio[] = [];
  for (const [category, values] of byCategory) {
    values.sort((a, b) => a - b);
    const med = medianOf(values);
    const ratio = (values.length * med + model.ratio_shrink_n * global) / (values.length + model.ratio_shrink_n);
    table.push({ category, protocols: values.length, median: round6(med), ratio: round6(ratio) });
  }
  table.sort((a, b) => b.ratio - a.ratio || (a.category < b.category ? -1 : 1));
  return { table, global: round6(global) };
}

/** The ratio one category's protocols get, or the global median when the category has no token-bearing protocol. */
export function ratioFor(category: string | null, table: Map<string, CategoryRatio>, global: number): { ratio: number; protocols: number } {
  if (category === null) return { ratio: global, protocols: 0 };
  const row = table.get(category);
  if (row === undefined) return { ratio: global, protocols: 0 };
  return { ratio: row.ratio, protocols: row.protocols };
}

// ---------------------------------------------------------------- the implied value

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The multipliers and the implied value one protocol gets under `model` and the ratio table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  ratio: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; ratios: CategoryRatio[]; global: number } {
  const { table, global } = categoryRatios(snapshot, model);
  const ratioMap = new Map(table.map((r) => [r.category, r]));
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, scored by the model itself.
  // No TVL cutoff beyond the snapshot's own $5M floor: a small protocol with a strong ratio and
  // fast growth outranks a large one with a weak ratio.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { ratio, protocols } = ratioFor(p.category, ratioMap, global);
    const v = impliedValue(p, snapshot.as_of, ratio, model);
    return { p, ratio, protocols, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      ratio: round6(s.ratio),
      ratio_protocols: s.protocols,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, ratios: table, global };
}

// ---------------------------------------------------------------- the farm plan

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas tier of a chain: what one transaction costs there, and what its gas token is. */
export function gasFor(chain: string): { gas: string; token: string } {
  const low = new Set(['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Linea', 'Blast', 'Scroll', 'Mantle', 'Mode', 'Ink', 'Unichain', 'Soneium', 'Abstract', 'Zora', 'Fraxtal', 'Berachain', 'Hyperliquid L1', 'Monad', 'Sonic', 'zkSync Era', 'Starknet', 'Aptos', 'Sui', 'Sei', 'Movement', 'MegaETH']);
  if (chain === 'Solana') return { gas: 'about $0.01 of fees', token: 'SOL' };
  if (chain === 'Ethereum') return { gas: 'about $3 to $8 of gas', token: 'ETH' };
  if (chain === 'Bitcoin') return { gas: 'about $1 to $3 of network fees', token: 'BTC' };
  if (chain === 'Tron') return { gas: 'about $1 of energy and bandwidth', token: 'TRX' };
  if (chain === 'Binance') return { gas: 'about $0.10 of gas', token: 'BNB' };
  if (chain === 'Avalanche') return { gas: 'about $0.20 of gas', token: 'AVAX' };
  if (low.has(chain)) return { gas: 'about $0.05 to $0.50 of gas', token: 'ETH' };
  return { gas: 'about $0.50 to $2 of gas', token: 'the chain gas token' };
}

/** Which family a category belongs to, for the farm action. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return 'yield';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'derivatives';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment')) return 'payments';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('index')) return 'indexes';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'curator';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('stable')) return 'stable';
  if (c.includes('liquidity manager')) return 'liquidity';
  if (c.includes('governance')) return 'governance';
  if (c.includes('nft')) return 'nft';
  if (c.includes('chain')) return 'chain';
  return 'other';
}

/** The category family's main action, in the words a farmer can follow. */
function primaryAction(family: string, p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and leave the position open so it accrues interest.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
    case 'yield':
      return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and hold the vault shares.`;
    case 'derivatives':
      return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small long and one small short, and stay near delta-neutral.`;
    case 'prediction':
      return `Fund ${name} with $${capital} on ${chain} and take one position in a market that settles after the next snapshot.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active.`;
    case 'payments':
      return `Route $${capital} of payments through ${name} on ${chain} over the next month and keep every receipt.`;
    case 'launchpad':
      return `Stake $${capital} in ${name}'s launch pool on ${chain} to qualify for the next allocation.`;
    case 'indexes':
      return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the farming wallet.`;
    case 'curator':
      return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`;
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
    case 'stable':
      return `Mint or hold $${capital} of the stable asset ${name} issues on ${chain}.`;
    case 'liquidity':
      return `Deposit $${capital} into ${name}'s managed liquidity position on ${chain} and leave it to the manager.`;
    case 'governance':
      return `Lock $${capital} of ${name}'s governance asset on ${chain} and vote on one live proposal.`;
    case 'nft':
      return `List or buy one NFT through ${name} on ${chain} with $${capital} and keep the position for the season.`;
    case 'chain':
      return `Bridge $${capital} of USDC to ${chain} through ${name} and use it in one app on that chain.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The category family's second qualifying action, so the wallet is not a one-and-done address. */
function secondAction(family: string, p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Borrow $20 of a stablecoin against the supply, repay it the same week, and repeat once a month.`;
    case 'dex':
      return `Swap $20 through ${name}'s router on ${chain} once a week so the wallet shows trading activity, not only liquidity.`;
    case 'yield':
      return `Claim the vault's yield once, restake it in the same vault, and leave the receipt in the same wallet.`;
    case 'derivatives':
      return `Close and reopen the hedge once a month so the position stays fresh in the protocol's activity log.`;
    case 'prediction':
      return `Settle one market and place a second small position before the next snapshot.`;
    case 'rwa':
      return `Top the position up by $20 once a month and keep every mint receipt.`;
    case 'insurance':
      return `Renew or extend the cover once before it lapses, so the policy never gaps.`;
    case 'payments':
      return `Send one more payment through ${name} each week, even a small one, to keep the address active.`;
    case 'launchpad':
      return `Join one more allocation round and keep the staked balance above the minimum the whole time.`;
    case 'indexes':
      return `Rebalance once: sell a tenth of the index and buy it back, so the address shows a second trade.`;
    case 'curator':
      return `Move $20 into a second vault of ${name} on ${chain} so the wallet touches more than one strategy.`;
    case 'staking':
      return `Restake the staking rewards once instead of claiming them, so the receipt balance grows.`;
    case 'stable':
      return `Swap $20 of the stable asset through ${name} once a week and hold the result.`;
    case 'liquidity':
      return `Add $20 more to the managed position once a month and keep the shares.`;
    case 'governance':
      return `Vote on a second proposal and leave a comment in the forum under the same address.`;
    case 'nft':
      return `Make one more trade through ${name} on ${chain} and keep the listing live for a week.`;
    case 'chain':
      return `Use the bridged funds in a second app on ${chain} so the address is not a bridge-and-leave.`;
    default:
      return `Make one more qualifying action, a deposit, a swap or a vote, so the wallet is not a one-and-done address.`;
  }
}

/** The category family's weekly recurring action. */
function weeklyAction(family: string, p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return 'check the borrow rate and make one small deposit or borrow';
    case 'dex':
      return 'swap $10 through the router or claim the pool fees';
    case 'yield':
      return 'claim the yield and restake it in the same vault';
    case 'derivatives':
      return 'check the funding rate and rebalance the hedge';
    case 'prediction':
      return 'close one market and open one new position';
    case 'rwa':
      return 'check the yield accrual and top the position up by $10';
    case 'insurance':
      return 'confirm the policy is still active and the premium is paid';
    case 'payments':
      return 'send one payment through the protocol';
    case 'launchpad':
      return 'confirm the staked balance is above the minimum';
    case 'indexes':
      return 'check the index composition and hold';
    case 'curator':
      return 'check the vault strategy and claim any rewards';
    case 'staking':
      return 'restake the staking rewards';
    case 'stable':
      return 'hold the stable asset and check its peg';
    case 'liquidity':
      return 'check the managed position and claim any fees';
    case 'governance':
      return 'read one new proposal and vote when one is live';
    case 'nft':
      return 'check the floor and keep the listing live';
    case 'chain':
      return 'use one app on the chain so the address stays active';
    default:
      return 'make one qualifying action, a deposit, a swap or a vote';
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyOf(p);
  const gas = gasFor(chain);
  const isSolana = chain === 'Solana';
  const walletStep = isSolana
    ? `Open a fresh Solana wallet, fund it with $${capital} of USDC plus about 0.02 SOL for fees, and store the seed phrase offline on paper.`
    : `Open a fresh EVM wallet you have never used on ${chain}, fund it with $${capital} of USDC plus ${gas.token} for gas, and store the seed phrase offline on paper.`;
  return [
    {
      text: walletStep,
      cost: isSolana ? 'about $0.02 of fees for the setup transactions' : `${gas.gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: primaryAction(family, p, capital, chain),
      cost: `$${capital} of capital and ${gas.gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(family, p, chain),
      cost: 'about $20 of activity and one transaction fee',
      time: '10 minutes',
    },
    {
      text: `Return once a week for ${Math.max(4, Math.ceil(hold / 7))} weeks: ${weeklyAction(family, p, chain)}.`,
      cost: `${gas.gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot; withdrawing early is the most common way a farm is missed.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link the protocol itself publishes, and claim only there: an airdrop claim never arrives by direct message or email, and never costs a fee to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log with the wallet address, the dates and every transaction hash, so you can repeat the position or unwind it; when you exit, withdraw in two parts and keep a little ${gas.token} for the final gas.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the dashboard data

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The wrapped, staked and bridged products set aside, by TVL, for the dashboard's Wrapped tab. */
export function wrappedRows(snapshot: Snapshot): WrappedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && (isWrappedProduct(p) || VERSIONED.test(p.name)))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      reason: wrappedReason(p),
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    ratio: row.model.ratio,
    ratio_protocols: row.model.ratio_protocols,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, ratios, global } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const wrapped = wrappedRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_ratio: global,
    category_ratios: ratios,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    wrapped_size: wrapped.length,
    rows: board.map(radarRow),
    live,
    wrapped,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
