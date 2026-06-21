import { render } from 'solid-js/web';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import './index.css';
import 'highlight.js/styles/github-dark.min.css';
import App from './App';

// Desktop app hardening
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());
document.addEventListener('dragover', e => e.preventDefault());

render(() => <App />, document.getElementById('root')!);
