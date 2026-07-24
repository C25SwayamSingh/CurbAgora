/**
 * Published loyalty programs from major chains, and the return bands CurbAgora
 * derives from them.
 *
 * These are reference points for an owner deciding what "normal" looks like —
 * not targets, and not promises. Every entry carries its source and the date it
 * was read, because these programs change without notice: an owner comparing
 * their cart to a stale figure is worse off than one comparing to nothing.
 *
 * Nothing here feeds the arithmetic. The engine prices rewards from the
 * vendor's own numbers; these exist so the resulting percentage can be placed
 * next to something recognizable.
 */

export type ChainBenchmark = {
  company: string;
  /** How the program earns and redeems, in one line. */
  structure: string;
  /** Customer-facing return, in basis points (500 = 5%). */
  returnBps: number;
  /** The arithmetic behind `returnBps`, so it can be checked. */
  calculation: string;
  source: string;
  /** ISO date this was last read against the published source. */
  reviewed: string;
};

/**
 * Direct cash-value programs only. A chain whose rewards are menu items has a
 * return that depends on which item you pick, so it cannot be reduced to a
 * single percentage without inventing one.
 */
export const CHAIN_BENCHMARKS: readonly ChainBenchmark[] = [
  {
    company: "Starbucks (Green)",
    structure: "1 Star per $1; 60 Stars redeems for $2 off",
    returnBps: 330,
    calculation: "$2 ÷ $60 of spend = 3.3%",
    source: "https://about.starbucks.com/starbucks-rewards-faq/",
    reviewed: "2026-07-22",
  },
  {
    company: "Subway",
    structure: "10 points per $1; 400 points becomes $2 Subway Cash",
    returnBps: 500,
    calculation: "$2 ÷ $40 of spend = 5%",
    source: "https://www.subway.com/en-us/rewards",
    reviewed: "2026-07-22",
  },
  {
    company: "McDonald's",
    structure: "100 points per $1; 4,000 points redeems for $3 off",
    returnBps: 750,
    calculation: "$3 ÷ $40 of spend = 7.5%",
    source: "https://www.mcdonalds.com/us/en-us/mymcdonalds.html",
    reviewed: "2026-07-22",
  },
] as const;

/**
 * Chains whose rewards are menu items rather than cash. Listed without a
 * percentage on purpose — the return depends on which item a customer picks,
 * and the chain's cost is not public.
 */
export const CATALOG_BENCHMARKS: readonly {
  company: string;
  structure: string;
  source: string;
  reviewed: string;
}[] = [
  {
    company: "Taco Bell",
    structure: "10 points per $1; a selectable reward every 250 points",
    source: "https://www.tacobell.com/faqs/ordering/rewards",
    reviewed: "2026-07-22",
  },
  {
    company: "Chick-fil-A",
    structure: "10 points per $1; rewards start at 200 points",
    source: "https://www.chick-fil-a.com/one",
    reviewed: "2026-07-22",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Bands derived from the benchmarks above                             */
/* ------------------------------------------------------------------ */

export type ReturnStance = "conservative" | "balanced" | "competitive";

export type ReturnBand = {
  stance: ReturnStance;
  label: string;
  lowBps: number;
  highBps: number;
  /** Who this suits, in the owner's terms. */
  bestFor: string;
};

/**
 * The observed chain range is roughly 3.3%–7.5%, clustered near 5%. These three
 * stances span that range rather than picking a single "right" answer, because
 * the right answer depends on margin and cost confidence — facts CurbAgora
 * does not have and should not guess.
 */
export const RETURN_BANDS: readonly ReturnBand[] = [
  {
    stance: "conservative",
    label: "Conservative",
    lowBps: 300,
    highBps: 450,
    bestFor: "Tight margins, or you're not sure what your items cost you",
  },
  {
    stance: "balanced",
    label: "Balanced",
    lowBps: 450,
    highBps: 650,
    bestFor: "Most independent carts — recognizable without hurting",
  },
  {
    stance: "competitive",
    label: "Competitive",
    lowBps: 650,
    highBps: 800,
    bestFor: "High-margin reward items, and you know your costs",
  },
] as const;

export const DEFAULT_STANCE: ReturnStance = "balanced";

export function bandFor(stance: ReturnStance): ReturnBand {
  return RETURN_BANDS.find((b) => b.stance === stance) ?? RETURN_BANDS[1];
}

/** Where a given return sits against the chains above. */
export function placeAgainstChains(returnBps: number): string {
  const sorted = [...CHAIN_BENCHMARKS].sort(
    (a, b) => a.returnBps - b.returnBps,
  );
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  if (returnBps < lowest.returnBps) {
    return `Leaner than every chain here — ${lowest.company} gives back the least at ${(lowest.returnBps / 100).toFixed(1)}%.`;
  }
  if (returnBps > highest.returnBps) {
    return `More generous than every chain here — ${highest.company} gives back the most at ${(highest.returnBps / 100).toFixed(1)}%.`;
  }
  const below = sorted.filter((b) => b.returnBps <= returnBps).at(-1)!;
  const above = sorted.find((b) => b.returnBps >= returnBps)!;
  return below.company === above.company
    ? `About the same as ${below.company}.`
    : `Between ${below.company} (${(below.returnBps / 100).toFixed(1)}%) and ${above.company} (${(above.returnBps / 100).toFixed(1)}%).`;
}
