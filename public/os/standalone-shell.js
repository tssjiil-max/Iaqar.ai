/** Explicit entry-page slots share the office header while retaining original live nodes. */
import { pageHeader } from './core/dom.js';
for (const slot of document.querySelectorAll('[data-office-heading]')) {
  const title = slot.querySelector('h1');
  if (!title) continue;
  const description = slot.querySelector('p');
  title.classList.add('os-page-title');
  if (description) description.classList.add('os-sub');
  const header = pageHeader(title, { description: description || '', iconName: slot.dataset.officeIcon || 'office' });
  slot.replaceChildren(header);
}
