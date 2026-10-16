// Only the bare public home changes. Every existing deep link keeps the office app.
(function () {
  if (location.pathname === '/' && !location.search && !location.hash) location.replace('/tour');
})();
