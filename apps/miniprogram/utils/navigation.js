const routes = require('../app.json').pages.map((route) => '/' + route);
const tabs = require('../app.json').tabBar.list.map((tab) => '/' + tab.pagePath);

function currentRoute() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page) return '/pages/booking/booking';
  const query = Object.keys(page.options || {})
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(page.options[key]))
    .join('&');
  return '/' + page.route + (query ? '?' + query : '');
}

function safeReturnRoute(route, user) {
  const path = (route || '').split('?')[0];
  if (!routes.includes(path) || path === '/pages/auth/auth') return '/pages/booking/booking';
  if (!user || user.role !== 'editor') {
    if (path === '/pages/edit-profile/edit-profile') return '/pages/me/me';
    if (path === '/pages/edit-meeting/edit-meeting' || path === '/pages/prepare/prepare') {
      return '/pages/meeting/meeting';
    }
  }
  return route;
}

module.exports = { currentRoute, safeReturnRoute, isTabRoute: (route) => tabs.includes(route.split('?')[0]) };
