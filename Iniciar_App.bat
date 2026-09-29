@echo off
cd /d "%~dp0"
title Central JVO - Inicializador Centralizado
echo =======================================
echo     Iniciando o Central JVO...
echo =======================================
echo.
echo Iniciando todos os servicos em UMA UNICA JANELA...
echo (Backend e Frontend)
echo.
echo Para encerrar o sistema inteiro depois, basta fechar esta janela ou apertar CTRL+C.
echo.

:: O start abaixo eh apenas para abrir a aba do navegador no Chrome automaticamente apos 7 segundos
start cmd /c "timeout /t 7 /nobreak > nul && start http://localhost:5173"

:: O npx concurrently vai agrupar os logs de todos os servidores nesta mesma tela do CMD
:: (a API Fastify separada foi removida - o backend Express em "npm run dev" ja cobre tudo)
npx concurrently@10.0.5 --kill-others --names "BEND, FEND" --prefix-colors "yellow.bold,blue.bold" "cd backend && npm run dev" "cd frontend && npm run dev"

pause
