/** Explicit entry-page slots retain original live nodes, including asynchronously rendered access screens. */
import { pageHeader } from './core/dom.js';
export function mountOfficeHeadings() {
  for (const slot of document.querySelectorAll('[data-office-heading]:not([data-office-heading-mounted])')) {
    const title = slot.querySelector('h1');
    if (!title) continue;
    slot.dataset.officeHeadingMounted = 'true';
    const description = slot.querySelector('p');
    const logo = slot.querySelector(':scope > img');
    title.classList.add('os-page-title');
    if (description) description.classList.add('os-sub');
    const header = pageHeader(title, { description: description || '', iconName: slot.dataset.officeIcon || 'office' });
    if (logo) header.querySelector('.os-page-icon').replaceChildren(logo);
    slot.replaceChildren(header);
  }
}
mountOfficeHeadings();
document.addEventListener('iaqar:office-heading', mountOfficeHeadings);
