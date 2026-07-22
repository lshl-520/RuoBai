import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4175,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        ws: true,
      },
      // 用户上传的聊天图片/头像/立绘存在后端 /user_assets 下，代理过去才能显示。
      // 注意：这里只代理 /user_assets，绝不代理 /assets（那是 React 自己的装修图/立绘）。
      "/user_assets": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
