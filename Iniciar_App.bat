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

:: Copia antiga ainda rodando (janela fechada sem encerrar os servidores) segura as portas
:: 3001/5180 e a nova nao sobe. Encerra so se for o Central JVO: Vite da pasta Escritorio\frontend
:: na 5180, e na 3001 quem responde /api/config como o nosso backend. Outro programa: so avisa.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; foreach ($c in Get-NetTCPConnection -LocalPort 3001,5180 -State Listen) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess); $pai = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId); if ($c.LocalPort -eq 5180) { $nosso = $p.CommandLine -match 'Escritorio.frontend' } else { $nosso = $null -ne (Invoke-RestMethod http://localhost:3001/api/config -TimeoutSec 3).config }; if ($nosso) { if ($pai.CommandLine -match '--watch') { $alvo = $pai.ProcessId } else { $alvo = $p.ProcessId }; Write-Host ('Encerrando copia antiga do Central JVO (porta ' + $c.LocalPort + ')...'); taskkill /PID $alvo /T /F > $null } else { Write-Host ('ATENCAO: porta ' + $c.LocalPort + ' ocupada por outro programa (' + $p.Name + '). Feche-o e rode de novo.') } }"

:: O start abaixo eh apenas para abrir a aba do navegador no Chrome automaticamente apos 7 segundos
start cmd /c "timeout /t 7 /nobreak > nul && start http://localhost:5180"

:: O npx concurrently vai agrupar os logs de todos os servidores nesta mesma tela do CMD
:: --restart-tries -1: se o backend cair por erro nao tratado, sobe de novo em 3s.
:: (o "node --watch" sozinho NAO religa depois de um crash - fica parado ate alguem salvar um arquivo)
npx concurrently@10.0.5 --kill-others --restart-tries -1 --restart-after 3000 --names "BEND, FEND" --prefix-colors "yellow.bold,blue.bold" "cd backend && npm run dev" "cd frontend && npm run dev"

pause
