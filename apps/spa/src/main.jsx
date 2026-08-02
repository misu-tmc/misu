import { render } from 'preact';
import { Router } from 'wouter-preact';
import { App } from './App.jsx';
import { registerPwa } from './pwa.js';
import '../css/tokens.css';
import '../css/base.css';
import '../css/components.css';

document.documentElement.classList.toggle('wechat-browser', /MicroMessenger/i.test(navigator.userAgent));

render(
  <Router base="">
    <App />
  </Router>,
  document.getElementById('app')
);

registerPwa();