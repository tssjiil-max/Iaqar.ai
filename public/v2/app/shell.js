import { renderV2Header } from "../components/header.js";
import { renderV2Nav } from "../components/nav.js";
import { renderAgreementsPage } from "../pages/agreements.js";
import { renderCommunityPage } from "../pages/community.js";
import { renderMatchesPage } from "../pages/matches.js";
import { renderOpportunitiesPage } from "../pages/opportunities.js";
import { renderOpportunityDetailPage } from "../pages/opportunity-detail.js";
import { renderTasksPage } from "../pages/tasks.js";
import { clearNode, el } from "../utils/dom.js";
export function createV2Shell(root) {
    clearNode(root);
    const app = el("div", { className: "v2-app", attrs: { dir: "rtl" } });
    const headerHost = el("div", { className: "v2-header-host" });
    const main = el("main", { className: "v2-main", attrs: { id: "v2-main" } });
    const navHost = el("div", { className: "v2-nav-host" });
    app.append(headerHost, main, navHost);
    root.append(app);
    const renderPage = (route) => {
        switch (route.name) {
            case "opportunity":
                return renderOpportunityDetailPage(route.id);
            case "tasks":
                return renderTasksPage();
            case "matches":
                return renderMatchesPage();
            case "community":
                return renderCommunityPage();
            case "agreements":
                return renderAgreementsPage();
            default:
                return renderOpportunitiesPage();
        }
    };
    return {
        render(route) {
            clearNode(headerHost);
            clearNode(main);
            clearNode(navHost);
            headerHost.append(renderV2Header(route));
            main.append(renderPage(route));
            navHost.append(renderV2Nav(route));
        }
    };
}
//# sourceMappingURL=shell.js.map