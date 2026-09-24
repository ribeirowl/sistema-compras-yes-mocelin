import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    port: 5173,
    // Mesmo caminho do nginx em produção: PDFs da Intelbras servidos pelo próprio sistema
    proxy: {
      '/intelbras-files': {
        target: 'https://backend.intelbras.com',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/intelbras-files/, '/sites/default/files'),
        configure: proxy => proxy.on('proxyRes', res => {
          delete res.headers['x-frame-options']; delete res.headers['content-security-policy']
          res.headers['content-disposition'] = 'inline'
        }),
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          xlsx: ['xlsx'],
          supabase: ['@supabase/supabase-js'],
        }
      }
    }
  }
})
