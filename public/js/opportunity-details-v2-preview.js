import { mountOpportunityDetailsV2 } from "./opportunity-details-v2.js";

const root = document.getElementById("previewRoot");
if (root) {
  mountOpportunityDetailsV2(root, {}, { reference: true });
}
