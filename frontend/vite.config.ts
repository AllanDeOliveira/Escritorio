import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Porta fixa: outros projetos Vite ocupam a 5173 e o Vite pularia para outra
  // porta em silêncio, quebrando o CORS do backend e o link do Iniciar_App.bat.
  server: { port: 5180, strictPort: true },
})
