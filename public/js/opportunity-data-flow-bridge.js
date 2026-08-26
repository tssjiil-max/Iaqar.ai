import * as opportunityDataFlowDomain from "./opportunity-data-flow-domain.js";

window.IAQAR_OPPORTUNITY_DATA_FLOW = opportunityDataFlowDomain;
window.dispatchEvent(new CustomEvent("iaqar:opportunity-data-flow-ready"));
