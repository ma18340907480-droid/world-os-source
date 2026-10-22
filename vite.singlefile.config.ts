import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 单文件打包：应急 fallback，用 Muse 内置存储发临时体验链接时用
// 主力部署仍是默认多文件构建（dist/ → GitHub Pages）
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 2000,
  },
});
