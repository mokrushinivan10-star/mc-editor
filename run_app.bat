@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto no_node
where npm >nul 2>&1
if errorlevel 1 goto no_node

if exist "backend\node_modules\" goto backend_ready
echo ������ ����������� �������...
call npm install --prefix backend
if errorlevel 1 goto install_failed
:backend_ready

if exist "frontend\node_modules\" goto frontend_ready
echo ������ ����������� ���������...
call npm install --prefix frontend
if errorlevel 1 goto install_failed
:frontend_ready

call :ensure_server 5000 backend "npm run dev"
call :ensure_server 5173 frontend "npm run dev"

echo ���, ���� ��������� ����...
set /a TRIES=0
:wait_loop
set /a TRIES+=1
call :port_open 5000
if errorlevel 1 goto still_waiting
call :port_open 5173
if errorlevel 1 goto still_waiting
goto open_window

:still_waiting
if %TRIES% GEQ 60 goto timeout
powershell -NoProfile -Command "Start-Sleep -Seconds 1" >nul
goto wait_loop

:open_window
set "URL=http://127.0.0.1:5173/"
call :launch_app_window
exit /b 0

:ensure_server
set "PORT=%~1"
set "DIR=%~2"
set "CMD=%~3"
call :port_open %PORT%
if not errorlevel 1 exit /b 0
start "MC Generator %DIR%" /D "%~dp0%DIR%" /min cmd /c "%CMD%"
exit /b 0

:port_open
powershell -NoProfile -Command "try { $client = New-Object Net.Sockets.TcpClient; $client.Connect('127.0.0.1', %~1); $client.Close(); exit 0 } catch { exit 1 }"
exit /b %errorlevel%

:launch_app_window
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto launch_edge
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto launch_chrome
start "" "%URL%"
exit /b 0

:launch_edge
start "" "%EDGE%" --app=%URL%
exit /b 0

:launch_chrome
start "" "%CHROME%" --app=%URL%
exit /b 0

:no_node
echo Node.js �� ������. ���������� ��� � https://nodejs.org � ��������� ���� ���� �����.
pause
exit /b 1

:install_failed
echo ����������� �� ������������. ���������� ��������� ����.
pause
exit /b 1

:timeout
echo ���������� �� ������� ����� �� 60 ������.
echo ���������� �������� ���� MC Generator backend � MC Generator frontend.
pause
exit /b 1
