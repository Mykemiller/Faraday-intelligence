// Registry of Wave-3 headless-scrape adapters, keyed by source_key.
// Add an adapter here + a jw_data_source_registry row (confidence_cap='INF')
// + a state_incentive_scrape.yml `source` choice to bring a portal online.
import caCalcompetes from "./ca-calcompetes.mjs";

export const ADAPTERS = {
  [caCalcompetes.source_key]: caCalcompetes,
};
