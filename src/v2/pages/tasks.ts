import { renderPlaceholderPage } from "../components/placeholder.js";

export function renderTasksPage(): HTMLElement {
  return renderPlaceholderPage({
    title: "المهام اليومية",
    body: "المهام اليومية ستُبنى في المرحلة 4."
  });
}
