// Entry point of dist/webview/main.js, loaded by the page that src/views/webviewHtml.ts renders.
import { bootstrap } from './bootstrap';
import { getHostApi } from './hostApi';

bootstrap({ view: window, host: getHostApi() });
