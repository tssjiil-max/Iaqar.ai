/**
 * Worker-side validation for office serviceNeighborhoodIds (mirrors browser domain).
 */

import {
  validateServiceNeighborhoodIds,
  normalizeServiceNeighborhoodIds,
  SERVICE_NEIGHBORHOOD_MIN,
  SERVICE_NEIGHBORHOOD_MAX
} from "../../public/js/service-neighborhood-domain.js";

export function assertValidServiceNeighborhoodIds(ids, cityLabel, options = {}) {
  const result = validateServiceNeighborhoodIds(ids, cityLabel, options);
  if (!result.ok) {
    const error = new Error(result.message || "INVALID_SERVICE_NEIGHBORHOODS");
    error.code = result.code || "INVALID_SERVICE_NEIGHBORHOODS";
    throw error;
  }
  return result.ids;
}

export {
  validateServiceNeighborhoodIds,
  normalizeServiceNeighborhoodIds,
  SERVICE_NEIGHBORHOOD_MIN,
  SERVICE_NEIGHBORHOOD_MAX
};
