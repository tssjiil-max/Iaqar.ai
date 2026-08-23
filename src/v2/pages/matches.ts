import { renderPlaceholderPage } from "../components/placeholder.js";

export function renderMatchesPage(): HTMLElement {
  return renderPlaceholderPage({
    title: "المطابقة",
    body: "عرض حالة المطابقة الخلفية سيُبنى في المرحلة 5. محرك المطابقة الحالي لن يُعاد كتابته هنا."
  });
}
