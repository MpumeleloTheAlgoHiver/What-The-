const STORAGE_KEYS = {
  marketsInvest: 'mint_filters_markets_invest',
  marketsStrategies: 'mint_filters_markets_strategies',
  openStrategies: 'mint_filters_open_strategies',
};

function serializeSet(s) {
  return Array.from(s);
}

function deserializeSet(arr) {
  return new Set(arr || []);
}

export function saveMarketsInvestFilters({ sort, sectors, exchanges }) {
  try {
    localStorage.setItem(STORAGE_KEYS.marketsInvest, JSON.stringify({
      sort,
      sectors: serializeSet(sectors),
      exchanges: serializeSet(exchanges),
    }));
  } catch (e) {}
}

export function loadMarketsInvestFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.marketsInvest);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      sort: data.sort || "Market Cap",
      sectors: deserializeSet(data.sectors),
      exchanges: deserializeSet(data.exchanges),
    };
  } catch (e) {
    return null;
  }
}

export function saveMarketsStrategyFilters({ sort, risks, minInvestment, exposure, timeHorizon, sectors }) {
  try {
    localStorage.setItem(STORAGE_KEYS.marketsStrategies, JSON.stringify({
      sort,
      risks: serializeSet(risks),
      minInvestment,
      exposure: serializeSet(exposure),
      timeHorizon: serializeSet(timeHorizon),
      sectors: serializeSet(sectors),
    }));
  } catch (e) {}
}

export function loadMarketsStrategyFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.marketsStrategies);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      sort: data.sort || "Recommended",
      risks: deserializeSet(data.risks),
      minInvestment: data.minInvestment ?? null,
      exposure: deserializeSet(data.exposure),
      timeHorizon: deserializeSet(data.timeHorizon),
      sectors: deserializeSet(data.sectors),
    };
  } catch (e) {
    return null;
  }
}

export function saveOpenStrategiesFilters({ sort, risks, minInvestment, exposure, timeHorizon, sectors }) {
  try {
    localStorage.setItem(STORAGE_KEYS.openStrategies, JSON.stringify({
      sort,
      risks: serializeSet(risks),
      minInvestment,
      exposure: serializeSet(exposure),
      timeHorizon: serializeSet(timeHorizon),
      sectors: serializeSet(sectors),
    }));
  } catch (e) {}
}

export function loadOpenStrategiesFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.openStrategies);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      sort: data.sort || "Recommended",
      risks: deserializeSet(data.risks),
      minInvestment: data.minInvestment ?? null,
      exposure: deserializeSet(data.exposure),
      timeHorizon: deserializeSet(data.timeHorizon),
      sectors: deserializeSet(data.sectors),
    };
  } catch (e) {
    return null;
  }
}

function buildChipsFromFilters(filters) {
  if (!filters) return [];
  const { risks, exposure, minInvestment, timeHorizon, sectors } = filters;
  const chips = [];
  if (risks && risks.size) chips.push(...Array.from(risks));
  if (exposure && exposure.size) chips.push(...Array.from(exposure));
  if (minInvestment) chips.push(minInvestment);
  if (timeHorizon && timeHorizon.size) chips.push(...Array.from(timeHorizon));
  if (sectors && sectors.size) chips.push(...Array.from(sectors));
  return chips;
}

function buildInvestChips({ sectors, exchanges }) {
  const chips = [];
  if (sectors && sectors.size) chips.push(...Array.from(sectors));
  if (exchanges && exchanges.size) chips.push(...Array.from(exchanges));
  return chips;
}

export { buildChipsFromFilters, buildInvestChips };
