import { renderPlaceholderPage } from "../components/placeholder.js";

export function renderOpportunityDetailPage(id: string): HTMLElement {
  return renderPlaceholderPage({
    title: "تفاصيل الفرصة",
    body: "صفحة التفاصيل ستُبنى في المرحلة 3. المعرّف الحالي يُقرأ من الرابط ويبقى ثابتًا بعد التحديث.",
    meta: `المعرّف: ${id}`
  });
}
