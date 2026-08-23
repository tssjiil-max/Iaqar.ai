export const V2_ROUTE_NAMES = [
  "opportunities",
  "opportunity",
  "tasks",
  "matches",
  "community",
  "agreements"
] as const;

export type V2RouteName = (typeof V2_ROUTE_NAMES)[number];

export type V2Route =
  | { name: "opportunities" }
  | { name: "opportunity"; id: string }
  | { name: "tasks" }
  | { name: "matches" }
  | { name: "community" }
  | { name: "agreements" };

export const V2_NAV_ITEMS = [
  { name: "opportunities" as const, href: "#/opportunities", label: "العروض" },
  { name: "tasks" as const, href: "#/tasks", label: "المهام" },
  { name: "matches" as const, href: "#/matches", label: "المطابقة" },
  { name: "community" as const, href: "#/community", label: "المجتمع" },
  { name: "agreements" as const, href: "#/agreements", label: "الاتفاقيات" }
];

export const V2_PAGE_TITLES: Record<V2RouteName, string> = {
  opportunities: "العروض والطلبات",
  opportunity: "تفاصيل الفرصة",
  tasks: "المهام اليومية",
  matches: "المطابقة",
  community: "مجتمع الوسطاء",
  agreements: "الاتفاقيات"
};
