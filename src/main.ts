import { seedIfEmpty } from './core/seed';
import { startApp } from './ui/app';
import './ui/styles.css';

async function bootstrap(): Promise<void> {
  try {
    await seedIfEmpty();
  } catch (err) {
    console.error('种子数据初始化失败', err);
  }
  startApp();

  // 注册离线 Service Worker（构建产物整包缓存，转场山里无网可用）
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    // 不依赖 window load：模块可能在 load 之后才执行，监听会永久错过
    const swUrl = new URL('../sw.js', import.meta.url);
    navigator.serviceWorker.register(swUrl).catch((e) => console.warn('SW 注册失败', e));
  }
}

bootstrap();
