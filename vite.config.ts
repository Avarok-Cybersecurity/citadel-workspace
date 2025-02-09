import { defineConfig } from 'vite';
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const host = process.env.TAURI_DEV_HOST;
  
  return {
    plugins: [
      react(),
      mode === 'development' && componentTagger(),
    ].filter(Boolean),
    
    // Prevent vite from obscuring rust errors
    clearScreen: false,
    
    server: {
      // Tauri requires a fixed port
      port: process.env.TAURI_DEV_HOST ? 1420 : 8080,
      strictPort: !!process.env.TAURI_DEV_HOST,
      host: process.env.TAURI_DEV_HOST || "::",
      
      // Only use Tauri-specific HMR if we're in Tauri dev mode
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      
      // Custom headers for your web app
      headers: {
        'Content-Security-Policy': "default-src 'self' https://cdn.gpteng.co; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.gpteng.co; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.gpteng.co ws://localhost:8080; frame-src 'self' https://cdn.gpteng.co; img-src 'self' data: https://cdn.gpteng.co https://images.unsplash.com;"
      },
      
      watch: {
        // Tell vite to ignore watching `src-tauri` and the gitsubmodule
        ignored: ["**/src-tauri/**", "citadel_workspaces/**"],
      },
    },
    
    // Your existing alias configuration
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },

    // Ensure proper target for Tauri
    esbuild: {
      target: "esnext",
    },
  };
});
