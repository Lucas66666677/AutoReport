import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'supabase-vendor',
              test: /node_modules[\\/]@supabase[\\/]/,
            },
            {
              name: 'icons-vendor',
              test: /node_modules[\\/]lucide-react[\\/]/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      html2canvas: 'html2canvas-pro',
    },
  },
})
