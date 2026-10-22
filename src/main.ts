// WORLD OS Alpha 0.1 · 入口
import './style.css';
import { Game } from './game';

// 屏上报错显示（排查黑屏用）
window.addEventListener('error', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;background:#a00;color:#fff;padding:8px;font-size:12px;z-index:99999;border-radius:6px;word-break:break-all;';
  d.textContent = 'ERR: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno;
  document.body.appendChild(d);
});

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
new Game(app, ui).start();
