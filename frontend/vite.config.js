import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env variables based on mode
  // This automatically loads .env, .env.local, and .env.[mode] files

  const backendPort = process.env.GS_BACKEND_PORT || '5000';
  const backendHost = process.env.GS_BACKEND_HOST || 'localhost';

  return {
    plugins: [react()],

    // Define custom environment variables
    define: {
      // Allow using GS_BACKEND_PORT directly without VITE_ prefix
      'import.meta.env.GS_BACKEND_PORT': JSON.stringify(process.env.GS_BACKEND_PORT || '5000'),
      'import.meta.env.GS_BACKEND_HOST': JSON.stringify(process.env.GS_BACKEND_HOST || 'localhost'),
    },

    // Explicitly set the public directory
    publicDir: 'public',

    // Server configuration for development
    server: {
      port: 5173,
      strictPort: true,
      host: true, // Listen on all addresses

      // Add proxy configuration
      proxy: {
        '/satimages': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/recordings': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/observations': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/snapshots': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/decoded': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/audio': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/transcriptions': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/body-icons': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/mission-icons': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/api': {  // For regular HTTP API requests
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          secure: false,
        },
        // Engine.IO checks Origin against Host for both polling and WebSocket requests.
        // Preserve the browser-facing headers through the development proxy.
        '/socket.io/': {
          target: `http://${backendHost}:${backendPort}`,
          ws: true,
          secure: false,
        },
        '/ws': {
          target: `http://${backendHost}:${backendPort}`,
          ws: true,
          secure: false,
        },
      },
    },

    // NOTE:
    // With Vite 8 / Rolldown and satellite.js v7, worker bundles can include top-level await.
    // The default worker output format ('iife') cannot represent top-level await, which causes:
    // "Top-level await is currently not supported with the 'iife' output format".
    // Force worker output to ESM so top-level await remains valid.
    worker: {
      format: 'es',
    },

    // Build configuration
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production', // Generate sourcemaps except in production

      // Optimize chunks
      rollupOptions: {
        output: {
          // NOTE:
          // In Vite 8 / Rolldown, object-style `manualChunks` triggers an "Invalid type" warning.
          // Use function form to keep deterministic vendor chunking.
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router/') ||
              id.includes('/react-router-dom/')
            ) {
              return 'vendor';
            }
            // Tiny helpers shared by many libraries must not be hoisted into one of
            // the big UI chunks, or every page would preload that chunk for them.
            if (
              id.includes('/@babel/runtime/') ||
              id.includes('/clsx/') ||
              id.includes('/prop-types/') ||
              id.includes('/react-is/') ||
              id.includes('/tslib/') ||
              // react-redux / RTK runtime deps; otherwise hoisted next to DataGrid.
              id.includes('/use-sync-external-store/') ||
              id.includes('/reselect/')
            ) {
              return 'vendor';
            }
            // Large, rarely-changing UI libraries get their own long-lived chunks so
            // an app deploy does not force clients to re-download them.
            // MUI X (DataGrid) is deliberately not pinned: it is only used by pages,
            // so letting the bundler split it by usage keeps it off the first paint.
            if (id.includes('/@mui/x-')) return;
            if (id.includes('/@mui/') || id.includes('/@emotion/')) return 'mui';
          },
        },
      },
    },

    // Resolve configuration
    resolve: {
      alias: {
        '@': '/src', // Allow using @ as an alias for /src directory
      },
    },
  };
});
