/** Explicit entry-page slots retain original live nodes, including asynchronously rendered access screens. */
import { pageHeader, officeSection, actionBar } from './core/dom.js';
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

/** Opt-in legacy interiors: retain roots, live controls, labels and listeners. */
export function mountOfficeSections(root = document) {
  for (const slot of root.querySelectorAll('[data-office-section]:not([data-office-section-mounted])')) {
    const title = slot.querySelector(':scope > h2, :scope > h3');
    if (!title) continue;
    const children = [...slot.childNodes].filter(node => node !== title);
    const section = officeSection({ title: title.textContent, iconName: slot.dataset.officeIcon || 'office' }, ...children);
    title.classList.add('os-h2');
    section.querySelector('.os-office-section-title .os-h2').replaceWith(title);
    slot.classList.add(...section.classList);
    slot.dataset.ui = 'surface';
    slot.dataset.officeSectionMounted = 'true';
    slot.replaceChildren(...section.childNodes);
  }
  for (const slot of root.querySelectorAll('[data-office-actions]:not([data-office-actions-mounted])')) {
    const bar = actionBar(...slot.childNodes);
    slot.classList.add(...bar.classList);
    slot.dataset.ui = 'control-group';
    slot.dataset.officeActionsMounted = 'true';
    slot.replaceChildren(...bar.childNodes);
  }
}
mountOfficeSections();
