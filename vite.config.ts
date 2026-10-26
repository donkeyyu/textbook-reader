import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            { name: "textbook", test: /content[\\/]grade-7-volume-1[\\/]/, maxSize: 500_000 },
            { name: "pixi", test: /node_modules[\\/]pixi\.js[\\/]/, maxSize: 1_500_000 },
            { name: "vendor", test: /node_modules[\\/]/, maxSize: 1_500_000 },
          ],
        },
      },
    },
  },
});
