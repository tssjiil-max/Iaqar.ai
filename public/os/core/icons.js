/**
 * Icon set — 24px outline icons in one consistent style (rounded 2px strokes),
 * matched to the reference screens. Filled variants where the reference fills.
 */

/*
 * iAqar.ai icon set — solid two-tone glyphs drawn from the approved icon sheet
 * («مجموعة أيقونات منصة iAqar.ai»). Primary shapes use currentColor; secondary
 * shapes (class "t2") use currentColor at reduced opacity. Knock-outs use even-odd
 * paths (no masks/ids), so icons render inside hidden or cloned subtrees too.
 * Names are unchanged: every place keeps its icon, only the drawing changes.
 */
const S = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
const T2 = 'class="t2" opacity=".38"';
const P = {
  home: '<path fill-rule="evenodd" d="M12.9 2.9a1.3 1.3 0 0 0-1.8 0L2.6 10.6A1.1 1.1 0 0 0 3.4 12.5H5V20a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20v-7.5h1.6a1.1 1.1 0 0 0 .8-1.9ZM10 21.5v-5.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v5.2Z"/>',
  "home-plus": '<path d="M12.9 2.9a1.3 1.3 0 0 0-1.8 0L2.6 10.6A1.1 1.1 0 0 0 3.4 12.5H5V20a1.5 1.5 0 0 0 1.5 1.5H12a6.5 6.5 0 0 1 7-9.1l1.6.1a1.1 1.1 0 0 0 .8-1.9Z"/><path fill-rule="evenodd" d="M18 12.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-.9 2.2v1.9h-1.9v1.8h1.9v1.9h1.8v-1.9h1.9v-1.8h-1.9v-1.9Z"/>',
  building: '<path ' + T2 + ' d="M15.5 8.5h4a1.5 1.5 0 0 1 1.5 1.5v11h-5.5Z"/><path fill-rule="evenodd" d="M5.5 2.5h8a1.5 1.5 0 0 1 1.5 1.5v17H10v-3.5H9V21H4V4a1.5 1.5 0 0 1 1.5-1.5ZM7 6v2h2V6Zm3.5 0v2h2V6ZM7 10v2h2v-2Zm3.5 0v2h2v-2ZM7 14v2h2v-2Zm3.5 0v2h2v-2Z"/><rect x="2.5" y="20.5" width="19" height="1.5" rx=".75"/>',
  handshake: '<path ' + T2 + ' d="M.8 9.6 4.6 5.8a1 1 0 0 1 1.4 0l2.3 2.3-4.9 5.8L.8 11a1 1 0 0 1 0-1.4Z"/><path ' + T2 + ' d="M23.2 9.6 19.4 5.8a1 1 0 0 0-1.4 0l-2.3 2.3 4.9 5.8 2.6-2.9a1 1 0 0 0 0-1.4Z"/><path transform="translate(12 12.8) scale(1.28) translate(-12.4 -12.6)" fill-rule="evenodd" d="M9.1 8.6 11 7a3.1 3.1 0 0 1 3.1-.6l2.4.8 3.2 5.6-5.5 6.1a2.2 2.2 0 0 1-3.1.2l-5.9-5.1Zm.4 3.9-.8.8 2.6 2.6.8-.8Zm1.7-1.7-.8.8 2.9 2.9.8-.8Zm1.8-1.6-.8.8 2.8 2.8.8-.8Z"/>',
  "doc-check": '<path fill-rule="evenodd" d="M6.5 2A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22H12a6.5 6.5 0 0 1 7-10.9V8.2L12.8 2ZM13 3.5V8a1 1 0 0 0 1 1h4.5ZM7.5 11.2h6.5v1.6H7.5Zm0 3.5h4v1.6h-4Z"/><path fill-rule="evenodd" d="M17.8 12.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm2.4 3.1-3 3-1.5-1.5-1 1 2.5 2.5 4-4Z"/>',
  calendar: '<path ' + T2 + ' d="M3 9.5h18v9A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5Z"/><path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v1.5H3V7a2.5 2.5 0 0 1 2.5-2.5Z"/><rect x="7" y="2.5" width="2" height="4.5" rx="1"/><rect x="15" y="2.5" width="2" height="4.5" rx="1"/><rect x="6.5" y="12" width="2.6" height="2.3" rx=".6"/><rect x="10.7" y="12" width="2.6" height="2.3" rx=".6"/><rect x="14.9" y="12" width="2.6" height="2.3" rx=".6"/><rect x="6.5" y="16" width="2.6" height="2.3" rx=".6"/><rect x="10.7" y="16" width="2.6" height="2.3" rx=".6"/>',
  "calendar-clock": '<path ' + T2 + ' d="M3 9.5h18v2A6.5 6.5 0 0 0 11.6 21H5.5A2.5 2.5 0 0 1 3 18.5Z"/><path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v1.5H3V7a2.5 2.5 0 0 1 2.5-2.5Z"/><rect x="7" y="2.5" width="2" height="4.5" rx="1"/><rect x="15" y="2.5" width="2" height="4.5" rx="1"/><path fill-rule="evenodd" d="M17.5 12a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.8 2.3v3.6l2.7 1.7.8-1.3-2-1.2v-2.8Z"/>',
  clock: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2.4a7.6 7.6 0 1 0 0 15.2 7.6 7.6 0 0 0 0-15.2Z"/><path ' + S + ' d="M12 7.5V12l3 2"/>',
  user: '<circle cx="12" cy="7.2" r="4.7"/><path d="M3.5 20.2a8.5 8.5 0 0 1 17 0 1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3Z"/>',
  users: '<circle ' + T2 + ' cx="16.5" cy="7.5" r="3.8"/><path ' + T2 + ' d="M14.3 13.2a7 7 0 0 1 8.7 6.8 1 1 0 0 1-1 1h-4.2a9 9 0 0 0-3.5-7.8Z"/><circle cx="9" cy="7.5" r="4.2"/><path d="M1.5 19.7a7.5 7.5 0 0 1 15 0A1.3 1.3 0 0 1 15.2 21H2.8a1.3 1.3 0 0 1-1.3-1.3Z"/>',
  search: '<path fill-rule="evenodd" d="M10.5 2.5a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z"/><path ' + S + ' stroke-width="3" d="m16.8 16.8 4.2 4.2"/>',
  plus: '<path ' + S + ' stroke-width="2.6" d="M12 5v14M5 12h14"/>',
  "chev-left": '<path ' + S + ' stroke-width="2.6" d="m15 18-6-6 6-6"/>',
  "chev-right": '<path ' + S + ' stroke-width="2.6" d="m9 18 6-6-6-6"/>',
  "chev-down": '<path ' + S + ' stroke-width="2.6" d="m6 9 6 6 6-6"/>',
  "chev-up": '<path ' + S + ' stroke-width="2.6" d="m6 15 6-6 6 6"/>',
  check: '<path ' + S + ' stroke-width="2.8" d="m5 12.5 4.5 4.5L19 7.5"/>',
  "check-circle": '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm4.2 5.9-5.6 5.6-2.8-2.8-1.7 1.7 4.5 4.5 7.3-7.3Z"/>',
  x: '<path ' + S + ' stroke-width="2.6" d="M6 6l12 12M18 6 6 18"/>',
  "x-circle": '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20ZM8.9 7.2 7.2 8.9l3.1 3.1-3.1 3.1 1.7 1.7 3.1-3.1 3.1 3.1 1.7-1.7-3.1-3.1 3.1-3.1-1.7-1.7-3.1 3.1Z"/>',
  heart: '<path d="M12 21.2S2.5 15.6 2.5 9.2A5 5 0 0 1 12 6.6a5 5 0 0 1 9.5 2.6c0 6.4-9.5 12-9.5 12Z"/>',
  eye: '<path fill-rule="evenodd" d="M12 4.8c6.6 0 10.3 6.2 10.5 6.5a1.4 1.4 0 0 1 0 1.4c-.2.3-3.9 6.5-10.5 6.5S1.7 13 1.5 12.7a1.4 1.4 0 0 1 0-1.4C1.7 11 5.4 4.8 12 4.8Zm0 3.2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><circle cx="12" cy="12" r="2"/>',
  edit: '<path d="M15.2 3.9a2.6 2.6 0 0 1 3.7 0l1.2 1.2a2.6 2.6 0 0 1 0 3.7L9.3 19.6 3 21l1.4-6.3Z"/><rect ' + T2 + ' x="12" y="19.5" width="9" height="2" rx="1"/>',
  edit3: '<path d="M15.2 3.9a2.6 2.6 0 0 1 3.7 0l1.2 1.2a2.6 2.6 0 0 1 0 3.7L9.3 19.6 3 21l1.4-6.3Z"/><rect ' + T2 + ' x="12" y="19.5" width="9" height="2" rx="1"/>',
  trash: '<path d="M9.5 2.5h5A1.5 1.5 0 0 1 16 4v1h4a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2h4V4a1.5 1.5 0 0 1 1.5-1.5Z"/><path fill-rule="evenodd" d="M5.5 8.5h13l-1 11.6A2 2 0 0 1 15.5 22h-7a2 2 0 0 1-2-1.9ZM9.2 11v8h1.6v-8Zm4 0v8h1.6v-8Z"/>',
  archive: '<rect x="2.5" y="3" width="19" height="5.5" rx="1.5"/><path fill-rule="evenodd" d="M4 10h16v8.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5Zm5.5 2.5v1.8h5v-1.8Z"/>',
  restore: '<path ' + S + ' d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M2.5 3.2v6.3h6.3Z"/>',
  coins: '<ellipse cx="11" cy="5.5" rx="7.5" ry="3"/><path d="M3.5 7.8c1.4 1.4 4.3 2.2 7.5 2.2s6.1-.8 7.5-2.2V10c0 1.7-3.4 3-7.5 3s-7.5-1.3-7.5-3Z"/><path ' + T2 + ' d="M3.5 12.3c1.4 1.4 4.3 2.2 7.5 2.2l1.5-.1a6.4 6.4 0 0 0-.9 3.1H11c-4.1 0-7.5-1.3-7.5-3Z"/><path fill-rule="evenodd" d="M17.5 12a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.8 1.8v.8c-1 .2-1.7.9-1.7 1.8 0 1.1.9 1.5 1.9 1.8.8.2 1 .4 1 .7s-.3.5-.8.5c-.6 0-1-.2-1.4-.6l-.8.9c.4.4 1 .7 1.6.8v.9h1.4v-.9c1-.2 1.6-.9 1.6-1.8 0-1.1-.8-1.5-1.8-1.8-.9-.2-1.1-.4-1.1-.7s.2-.5.7-.5 .9.2 1.2.5l.8-.9a2.8 2.8 0 0 0-1.3-.7v-.8Z"/>',
  database: '<ellipse cx="12" cy="5.2" rx="8" ry="3.2"/><path d="M4 7.6c1.5 1.5 4.6 2.4 8 2.4s6.5-.9 8-2.4v4c0 1.8-3.6 3.2-8 3.2s-8-1.4-8-3.2Z"/><path ' + T2 + ' d="M4 14c1.5 1.5 4.6 2.4 8 2.4s6.5-.9 8-2.4v4.3c0 1.8-3.6 3.2-8 3.2s-8-1.4-8-3.2Z"/>',
  pin: '<path fill-rule="evenodd" d="M12 1.8a7.8 7.8 0 0 1 7.8 7.8c0 5.4-6.3 11.6-7 12.3a1.1 1.1 0 0 1-1.6 0c-.7-.7-7-6.9-7-12.3A7.8 7.8 0 0 1 12 1.8Zm0 4.9a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z"/>',
  area: '<path ' + S + ' stroke-width="2.3" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path ' + S + ' stroke-width="2.3" d="m4 4 5 5M20 4l-5 5M4 20l5-5M20 20l-5-5"/>',
  bed: '<path d="M2 6.5a1.2 1.2 0 0 1 2.4 0V12H2Z"/><circle ' + T2 + ' cx="7.7" cy="9.3" r="2.3"/><path d="M11 8h7.5a3.5 3.5 0 0 1 3.5 3.5V13H11Z"/><path d="M2 13.5h20V19a1 1 0 0 1-2 0v-2H4v2a1 1 0 0 1-2 0Z"/>',
  whatsapp: '<path fill-rule="evenodd" d="M12 2a9.9 9.9 0 0 1 8.5 15l1.3 4.6-4.8-1.3A9.9 9.9 0 1 1 12 2Zm-3 5.2c-.3 0-.7.1-1 .5-.4.4-1.1 1.1-1.1 2.6s1.1 3 1.3 3.2c.2.2 2.2 3.4 5.4 4.6 2.6 1 3.2.8 3.7.8.6-.1 1.8-.7 2.1-1.5.3-.8.3-1.4.2-1.5l-.6-.4-2-1c-.3-.1-.5-.1-.7.2l-.9 1.1c-.2.2-.3.2-.6.1a7.5 7.5 0 0 1-3.9-3.4c-.2-.4.2-.4.6-1.2.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5Z"/>',
  send: '<path d="M21.3 2.7a1 1 0 0 1 .3 1.1l-6 17a1 1 0 0 1-1.8.2l-3.4-6.2 5.8-6.9-6.9 5.8L3 10.3a1 1 0 0 1 .2-1.8l17-6a1 1 0 0 1 1.1.2Z"/>',
  note: '<path fill-rule="evenodd" d="M6.5 2A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8.2L13.8 2ZM13 3.5V8a1 1 0 0 0 1 1h4.5ZM8 12.2h8v1.8H8Zm0 3.8h5.5v1.8H8Z"/>',
  clipboard: '<path fill-rule="evenodd" d="M9 3.5V3a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3v.5h2A2.5 2.5 0 0 1 19.5 6v13.5A2.5 2.5 0 0 1 17 22H7a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 7 3.5Zm1.5 0V5h3V3.5ZM11 10.2v1.8h5.5v-1.8Zm0 3.6v1.8h5.5v-1.8Zm0 3.6v1.8h4v-1.8Zm-3.5-7.3v1.8h2v-1.8Zm0 3.6v1.8h2v-1.8Zm0 3.6v1.8h2v-1.8Z"/>',
  info: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.2 8.5v7h2.4v-7Zm1.2-4.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>',
  question: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 13.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm.2-10.3c-2.2 0-3.7 1.3-3.9 3.2h2.3c.1-.8.7-1.2 1.5-1.2s1.4.5 1.4 1.2c0 .6-.3.9-1.2 1.5-1 .6-1.5 1.3-1.5 2.4v.6h2.2v-.4c0-.6.2-.9 1.1-1.4 1-.6 1.7-1.4 1.7-2.8 0-1.9-1.5-3.1-3.6-3.1Z"/>',
  reply: '<path d="M10 4.5a.9.9 0 0 1 1.5.7V8.5c5.8.4 9.5 4.3 9.5 10.5a.6.6 0 0 1-1.1.3c-1.6-2.8-4.4-4.1-8.4-4.3v3.3a.9.9 0 0 1-1.5.7l-7-6a1 1 0 0 1 0-1.5Z"/>',
  hourglass: '<rect x="5" y="2" width="14" height="2.4" rx="1.2"/><rect x="5" y="19.6" width="14" height="2.4" rx="1.2"/><path ' + T2 + ' d="M7 4.4h10v2.4c0 2-1.3 3.7-3.2 5.2 1.9 1.5 3.2 3.2 3.2 5.2v2.4H7v-2.4c0-2 1.3-3.7 3.2-5.2C8.3 10.5 7 8.8 7 6.8Z"/><path d="M8.8 19.6c.3-1.8 1.7-3 3.2-3.8 1.5.8 2.9 2 3.2 3.8ZM9 6.5h6c-.3 1.3-1.4 2.4-3 3.4-1.6-1-2.7-2.1-3-3.4Z"/>',
  bell: '<path d="M12 2.5a6.8 6.8 0 0 1 6.8 6.8v3.8l1.8 3a1.2 1.2 0 0 1-1 1.9H4.4a1.2 1.2 0 0 1-1-1.9l1.8-3V9.3A6.8 6.8 0 0 1 12 2.5Z"/><path d="M9.2 19.3h5.6a2.8 2.8 0 0 1-5.6 0Z"/>',
  logout: '<path ' + T2 + ' d="M5 3h8a2 2 0 0 1 2 2v3h-2V5H5v14h8v-3h2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M17 7.5a.8.8 0 0 1 1.3-.6l4.3 4.4a1 1 0 0 1 0 1.4l-4.3 4.4a.8.8 0 0 1-1.3-.6V14H10a1.2 1.2 0 0 1 0-2.4v.4h7Z"/>',
  flag: '<rect x="3.8" y="2.5" width="2.2" height="19" rx="1.1"/><path d="M6 3.5h12.6a.8.8 0 0 1 .7 1.2L17.2 8.3l2.1 3.6a.8.8 0 0 1-.7 1.2H6Z"/>',
  sparkles: '<path d="M10 3.5c.6 3.7 2.6 5.8 6.3 6.4-3.7.6-5.7 2.7-6.3 6.4-.6-3.7-2.6-5.8-6.3-6.4 3.7-.6 5.7-2.7 6.3-6.4Z"/><path ' + T2 + ' d="M18 13c.3 2 1.4 3.1 3.4 3.4-2 .3-3.1 1.4-3.4 3.4-.3-2-1.4-3.1-3.4-3.4 2-.3 3.1-1.4 3.4-3.4Z"/>',
  phone: '<path d="M6.8 2.5 9 2.3a1.4 1.4 0 0 1 1.4.9l1.3 3.4a1.4 1.4 0 0 1-.4 1.6L9.8 9.5a12 12 0 0 0 4.7 4.7l1.3-1.5a1.4 1.4 0 0 1 1.6-.4l3.4 1.3a1.4 1.4 0 0 1 .9 1.4l-.2 2.2a3.3 3.3 0 0 1-3.5 3A17.6 17.6 0 0 1 3.8 6 3.3 3.3 0 0 1 6.8 2.5Z"/>',
  key: '<path fill-rule="evenodd" d="M8.5 9a6 6 0 0 1 5.3 3.2H21a1 1 0 0 1 1 1v2.3a1 1 0 0 1-1 1h-1.5v1.8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1.8h-1.7A6 6 0 1 1 8.5 9Zm0 3.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z" transform="rotate(-45 12 12)"/>',
  refresh: '<path ' + S + ' d="M19.5 10.5A7.8 7.8 0 0 0 5.3 7"/><path d="M3.5 3.3v6.2h6.2Z"/><path ' + S + ' d="M4.5 13.5A7.8 7.8 0 0 0 18.7 17"/><path d="M20.5 20.7v-6.2h-6.2Z"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/>',
  play: '<path d="M8.2 4.3a1.2 1.2 0 0 0-1.8 1v13.4a1.2 1.2 0 0 0 1.8 1l10.4-6.7a1.2 1.2 0 0 0 0-2Z"/>',
  inbox: '<path ' + T2 + ' d="M5.8 3.5h12.4a2 2 0 0 1 1.9 1.4l2.1 7.6H16a4 4 0 0 1-8 0H1.8l2.1-7.6a2 2 0 0 1 1.9-1.4Z"/><path d="M1.5 14h5.3a5.3 5.3 0 0 0 10.4 0h5.3v4.5a2.5 2.5 0 0 1-2.5 2.5H4a2.5 2.5 0 0 1-2.5-2.5Z"/>',
  shield: '<path fill-rule="evenodd" d="M12 1.8 20.5 5v6.3c0 5.3-3.6 9.6-8.5 10.9-4.9-1.3-8.5-5.6-8.5-10.9V5Zm3.4 6.9-4.4 4.4-2-2-1.6 1.6 3.6 3.6 6-6Z"/>',
  more: '<circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/>',
  swap: '<path d="M16 2.8a.8.8 0 0 1 1.3-.6l4.4 4a1 1 0 0 1 0 1.5l-4.4 4a.8.8 0 0 1-1.3-.6V8.3H4.5a1.4 1.4 0 0 1 0-2.8H16Z"/><path ' + T2 + ' d="M8 12.2a.8.8 0 0 0-1.3-.6l-4.4 4a1 1 0 0 0 0 1.5l4.4 4a.8.8 0 0 0 1.3-.6v-2.8h11.5a1.4 1.4 0 0 0 0-2.8H8Z"/>',
  alert: '<path fill-rule="evenodd" d="M10.3 3.3a2 2 0 0 1 3.4 0l8.4 14.6a2 2 0 0 1-1.7 3H3.6a2 2 0 0 1-1.7-3Zm.5 5.7.3 6.2h1.8l.3-6.2Zm1.2 7.5a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z"/>',
  tag: '<path fill-rule="evenodd" d="M3.8 2.5h7.1a2 2 0 0 1 1.4.6l8.9 8.9a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0L3 12.5a2 2 0 0 1-.6-1.4V3.9a1.4 1.4 0 0 1 1.4-1.4Zm4.2 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
  link: '<path ' + S + ' stroke-width="2.6" d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path ' + S + ' stroke-width="2.6" d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3A4.5 4.5 0 0 0 11 19.4l1-1"/>',
  // — Sheet: التنقل والواجهة / المطابقة / العملاء والأطراف / العقود / المواعيد —
  dashboard: '<rect x="3" y="3" width="8" height="8" rx="2.2"/><rect ' + T2 + ' x="13" y="3" width="8" height="8" rx="2.2"/><rect ' + T2 + ' x="3" y="13" width="8" height="8" rx="2.2"/><rect x="13" y="13" width="8" height="8" rx="2.2"/>',
  "tasks-check": '<path fill-rule="evenodd" d="M7 3.5h1.5V5a1.5 1.5 0 0 0 1.5 1.5h4A1.5 1.5 0 0 0 15.5 5V3.5H17A2.5 2.5 0 0 1 19.5 6v13.5A2.5 2.5 0 0 1 17 22H7a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 7 3.5Zm-.5 3v13h11v-13Z"/><rect x="9.5" y="1.8" width="5" height="3.4" rx="1.2"/><path ' + S + ' stroke-width="1.8" d="m8.3 11 1.2 1.2 2-2.1M8.3 15.6l1.2 1.2 2-2.1"/><rect x="12.8" y="10.4" width="3.2" height="1.7" rx=".8"/><rect x="12.8" y="15" width="3.2" height="1.7" rx=".8"/>',
  offers: '<path fill-rule="evenodd" d="M6.5 2A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8.2L13.8 2ZM13 3.5V8a1 1 0 0 0 1 1h4.5ZM8 12.2h8v1.8H8Zm0 3.8h8v1.8H8Z"/>',
  match: '<circle ' + T2 + ' cx="16.5" cy="7" r="3.7"/><path ' + T2 + ' d="M13.7 12.9a7 7 0 0 1 9.3 6.6 1 1 0 0 1-1 1h-3.3a9.4 9.4 0 0 0-5-7.6Z"/><circle cx="8.5" cy="7.2" r="4.2"/><path d="M1 19.5a7.5 7.5 0 0 1 12.6-5.5 4.6 4.6 0 0 0-2.3 6.8H2.3A1.3 1.3 0 0 1 1 19.5Z"/><path ' + S + ' stroke-width="1.7" d="m16.3 17.9 1.6-1.6a1.5 1.5 0 0 1 2.1 2.1l-1.6 1.6a1.5 1.5 0 0 1-2.1 0M17.4 20.6l-1.6 1.6a1.5 1.5 0 0 1-2.1-2.1l1.6-1.6a1.5 1.5 0 0 1 2.1 0"/>',
  owner: '<circle cx="9" cy="7" r="4.3"/><path d="M1.5 19.5a7.5 7.5 0 0 1 12-6v7.3H2.8a1.3 1.3 0 0 1-1.3-1.3Z"/><path ' + T2 + ' d="M18.5 11.3a.8.8 0 0 0-1 0l-4.2 3.6a.6.6 0 0 0 .4 1h.8v4.6a.8.8 0 0 0 .8.8h1.7v-2.8h1.9v2.8h1.7a.8.8 0 0 0 .8-.8v-4.6h.8a.6.6 0 0 0 .4-1Z"/>',
  client: '<circle cx="12" cy="6.8" r="4.5"/><path fill-rule="evenodd" d="M3.5 20a8.5 8.5 0 0 1 17 0 1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 20Zm7.4-7.3 1.1 1.2 1.1-1.2Zm.3 2 -.9 5h3.4l-.9-5Z"/>',
  broker: '<circle cx="10" cy="7" r="4.5"/><path d="M1.5 19.7a8.5 8.5 0 0 1 12.8-7.3 6 6 0 0 0-1.1 9.1H3.3a1.8 1.8 0 0 1-1.8-1.8Z"/><path fill-rule="evenodd" d="M18.5 13a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 1.6-.8 1.7-1.9.2 1.4 1.3-.4 1.8 1.7-.9 1.7.9-.4-1.8 1.4-1.3-1.9-.2Z"/>',
  contract: '<path fill-rule="evenodd" d="M6.5 2A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h6.2l.4-2H6.5a.5.5 0 0 1-.5-.5v-15a.5.5 0 0 1 .5-.5H13v3.5a1.5 1.5 0 0 0 1.5 1.5H18v2.2l2 -2V8.2L13.8 2ZM8 11h7v1.8H8Zm0 3.6h4.5v1.8H8Z"/><path d="M19.6 12.4a1.6 1.6 0 0 1 2.3 2.3l-5.7 5.7-3 .7.7-3Z"/>',
  mail: '<path fill-rule="evenodd" d="M4.5 4.5h15A2.5 2.5 0 0 1 22 7v10a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17V7a2.5 2.5 0 0 1 2.5-2.5Zm-.1 2.8L12 12.6l7.6-5.3v2.3L12 14.9 4.4 9.6Z"/>',
  "inbox-in": '<path d="M2.5 13h5.2l1.6 2.6h5.4l1.6-2.6h5.2v6a2.5 2.5 0 0 1-2.5 2.5h-14A2.5 2.5 0 0 1 2.5 19Z"/><path ' + T2 + ' d="M4.8 11.5 6.2 5a2 2 0 0 1 2-1.5h.8v2H8.2l-1.3 6Zm14.4 0L17.8 5a2 2 0 0 0-2-1.5H15v2h.8l1.3 6Z"/><rect x="10.9" y="2" width="2.2" height="8" rx="1.1"/><path d="M8 8.6a1 1 0 0 1 1.5-1.2l2.5 2.2 2.5-2.2A1 1 0 0 1 16 8.6l-4 3.9Z"/>',
  "chart-up": '<rect ' + T2 + ' x="3" y="14" width="4" height="7" rx="1.2"/><rect ' + T2 + ' x="10" y="10.5" width="4" height="10.5" rx="1.2"/><rect x="17" y="7" width="4" height="14" rx="1.2"/><path ' + S + ' stroke-width="2" d="M3.5 10.5 9 5.5l3.5 2.5 5.5-5"/><path d="M15.2 2.2h4.6v4.6Z"/>',
  // — Sheet: العقارات (الأنواع) —
  apartment: '<path ' + T2 + ' d="M15.5 8.5h4a1.5 1.5 0 0 1 1.5 1.5v11h-5.5Z"/><path fill-rule="evenodd" d="M5.5 2.5h8a1.5 1.5 0 0 1 1.5 1.5v17H10v-3.5H9V21H4V4a1.5 1.5 0 0 1 1.5-1.5ZM7 6v2h2V6Zm3.5 0v2h2V6ZM7 10v2h2v-2Zm3.5 0v2h2v-2ZM7 14v2h2v-2Zm3.5 0v2h2v-2Z"/><rect x="2.5" y="20.5" width="19" height="1.5" rx=".75"/>',
  tower: '<path ' + T2 + ' d="M2.5 11h3.5v10H2.5Zm15.5 0h3.5v10H18Z"/><path fill-rule="evenodd" d="M7.5 2h9A1.5 1.5 0 0 1 18 3.5V21h-4.5v-3h-3v3H6V3.5A1.5 1.5 0 0 1 7.5 2ZM8.3 4.6v1.8h1.8V4.6Zm2.8 0v1.8h1.8V4.6Zm2.8 0v1.8h1.8V4.6ZM8.3 8v1.8h1.8V8Zm2.8 0v1.8h1.8V8Zm2.8 0v1.8h1.8V8ZM8.3 11.4v1.8h1.8v-1.8Zm2.8 0v1.8h1.8v-1.8Zm2.8 0v1.8h1.8v-1.8ZM8.3 14.8v1.8h1.8v-1.8Zm5.6 0v1.8h1.8v-1.8Z"/><rect x="1.5" y="20.8" width="21" height="1.4" rx=".7"/>',
  office: '<path ' + T2 + ' d="M2.5 9.5h4v11.5h-4Z"/><path fill-rule="evenodd" d="M8 3h11.5A1.5 1.5 0 0 1 21 4.5V21h-5v-3.5h-3.5V21H6.5V4.5A1.5 1.5 0 0 1 8 3Zm1.2 3v2.2h2.4V6Zm4 0v2.2h2.4V6ZM9.2 10v2.2h2.4V10Zm4 0v2.2h2.4V10Zm4-4v2.2h2.4V6Zm0 4v2.2h2.4V10Zm-8 4v2.2h2.4V14Zm8 0v2.2h2.4V14Z"/><rect x="1.5" y="20.8" width="21" height="1.4" rx=".7"/>',
  villa: '<path fill-rule="evenodd" d="M9.2 4.3a1 1 0 0 1 1.3 0l6.9 6.2a.8.8 0 0 1-.5 1.4h-1.4V21H3.4v-9.1H2a.8.8 0 0 1-.5-1.4ZM8 16v5h3.7v-5Z"/><path ' + T2 + ' d="M19 21.5c-.4-2.7-.4-5.6.2-8.6h1.3c-.6 3-.7 5.9-.3 8.6Z"/><path d="M19.8 12.6c-.4-1.9-2.2-2.8-4-2.3 1.3-1.4 3.5-1.3 4.6.1.4-1.7 2.2-2.6 3.6-1.8-1.7.1-2.9 1.3-3 2.6 1-.4 2.2 0 2.7.9-1.3-.5-2.8-.2-3.9.5Z"/>',
  floor: '<path fill-rule="evenodd" d="M12.9 2.9a1.3 1.3 0 0 0-1.8 0L2.6 10.6A1.1 1.1 0 0 0 3.4 12.5H5V20a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20v-7.5h1.6a1.1 1.1 0 0 0 .8-1.9ZM10 21.5v-5.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v5.2Z"/>',
  duplex: '<path fill-rule="evenodd" d="M12.8 2.3a1.2 1.2 0 0 0-1.6 0L2.4 9.6a.9.9 0 0 0 .6 1.6h1.2v9.3a1 1 0 0 0 1 1h13.6a1 1 0 0 0 1-1v-9.3H21a.9.9 0 0 0 .6-1.6ZM7 11.5v3h3v-3Zm7 0v3h3v-3Zm-3.5 5v5h3v-5Z"/><rect ' + T2 + ' x="11" y="6.5" width="2" height="2.6" rx=".6"/>',
  land: '<path ' + T2 + ' d="M5.6 14.5h12.8a1 1 0 0 1 .9.6l2.5 5.5a1 1 0 0 1-.9 1.4H3.1a1 1 0 0 1-.9-1.4l2.5-5.5a1 1 0 0 1 .9-.6Z"/><path fill-rule="evenodd" d="M12 1.5a5.8 5.8 0 0 1 5.8 5.8c0 3.9-4.6 8.5-5.1 9a1 1 0 0 1-1.4 0c-.5-.5-5.1-5.1-5.1-9A5.8 5.8 0 0 1 12 1.5Zm0 3.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"/>',
  shop: '<path d="M3.5 3h17l1.5 5.3a2.6 2.6 0 0 1-4.9 1.2 2.6 2.6 0 0 1-4.6 0 2.6 2.6 0 0 1-4.6 0A2.6 2.6 0 0 1 2 8.3Z"/><path ' + T2 + ' d="M4 12h16v9H4Z"/><path d="M9.3 14.5h5.4V21H9.3Z"/><rect x="2.5" y="20.6" width="19" height="1.4" rx=".7"/>',
  warehouse: '<path fill-rule="evenodd" d="M11.3 2.3a1.6 1.6 0 0 1 1.4 0l8.4 4.2a1.6 1.6 0 0 1 .9 1.4V20a1.5 1.5 0 0 1-1.5 1.5h-2V11a1 1 0 0 0-1-1H6.5a1 1 0 0 0-1 1v10.5h-2A1.5 1.5 0 0 1 2 20V7.9a1.6 1.6 0 0 1 .9-1.4Z"/><path ' + T2 + ' d="M7 11.5h10v10H7Z"/><rect x="7" y="13" width="10" height="1.3" rx=".4"/><rect x="7" y="15.8" width="10" height="1.3" rx=".4"/><rect x="7" y="18.6" width="10" height="1.3" rx=".4"/>',
  gear: '<path fill-rule="evenodd" d="M10.3 1.8h3.4l.6 2.7a8 8 0 0 1 2 1.2l2.6-.9 1.7 3-2 1.8a8 8 0 0 1 0 2.4l2 1.8-1.7 3-2.6-.9a8 8 0 0 1-2 1.2l-.6 2.7h-3.4l-.6-2.7a8 8 0 0 1-2-1.2l-2.6.9-1.7-3 2-1.8a8 8 0 0 1 0-2.4l-2-1.8 1.7-3 2.6.9a8 8 0 0 1 2-1.2ZM12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z"/>'
};

/** Project property types (records-domain PROPERTY_TYPES) → sheet icon. Unknown types keep the house. */
export const PROPERTY_TYPE_ICON = Object.freeze({
  "شقة": "apartment", "فيلا": "villa", "دور": "floor", "دوبلكس": "duplex", "أرض": "land", "عمارة": "tower",
  "محل تجاري": "shop", "مكتب": "office", "استراحة": "villa", "مستودع": "warehouse", "غرفة": "bed"
});
export function propertyTypeIcon(type) {
  const key = String(type || "").trim();
  return PROPERTY_TYPE_ICON[key] || (/محل/.test(key) ? "shop" : /أرض/.test(key) ? "land" : "home");
}

export function iconMarkup(name) {
  return P[name] || P.info;
}

export function icon(name, { filled, label = "" } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("class", "os-ico");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  svg.innerHTML = iconMarkup(name);
  return svg;
}
