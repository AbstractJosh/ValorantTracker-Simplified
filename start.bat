@echo off
REM ===========================================================================
REM  Valorant Tracker - start everything.
REM
REM  Runs the scrape API and the web page in their own windows, waits until
REM  both are actually listening, then opens the app in your browser.
REM
REM  Close either window to stop that half. This window closes on its own.
REM ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"

REM Was this double-clicked, or run from a terminal that will stay open? Only
REM the first needs a keypress to stop the window vanishing before the error
REM can be read. cmdcmdline holds the command that started this shell, and it
REM names this script only when cmd was launched just to run it.
REM Set VT_NO_PAUSE=1 to never pause - for scripted or unattended runs, where
REM a keypress nobody is there to press would hang forever.
REM
REM findstr is called by full path here and below. A PATH carrying GnuWin32,
REM Git for Windows or similar puts a Unix `find` ahead of System32's, and the
REM Unix one does not understand these switches - it sits waiting on stdin
REM instead, which hangs the launcher before it prints anything.
set "DOUBLECLICKED=0"
if not defined VT_NO_PAUSE (
  echo %cmdcmdline% | "%SystemRoot%\System32\findstr.exe" /i /l /c:"%~nx0" >nul 2>&1 && set "DOUBLECLICKED=1"
)

REM Ports can be overridden for a one-off run:
REM   set VT_SERVER_PORT=8799 && set VT_PAGE_PORT=5199 && start.bat
REM vite.config.ts reads VT_SERVER_PORT too, so the page's /api proxy follows
REM the API rather than pointing at a port nothing is on.
if not defined VT_SERVER_PORT set "VT_SERVER_PORT=8787"
if not defined VT_PAGE_PORT set "VT_PAGE_PORT=5180"
set "STARTED_ANY=0"
set "SERVER_PORT=%VT_SERVER_PORT%"
set "PAGE_PORT=%VT_PAGE_PORT%"
set "PAGE_URL=http://localhost:%PAGE_PORT%/valorant.html"
set "PYTHON=.venv\Scripts\python.exe"
set "WEB=DataTableDesign\react"

echo.
echo   Valorant Tracker
echo   ----------------
echo.

REM --- prerequisites ---------------------------------------------------------

if not exist "%PYTHON%" (
  echo   [X] The Python environment is missing.
  echo.
  echo       Expected: %CD%\%PYTHON%
  echo.
  echo       Set it up once with:
  echo         python -m venv .venv
  echo         .venv\Scripts\python.exe -m pip install -e ".[all]"
  echo         .venv\Scripts\scrapling.exe install
  goto :fail
)

if not exist "%WEB%\node_modules" (
  echo   [X] The page's dependencies are not installed.
  echo.
  echo       Install them once with:
  echo         cd %WEB%
  echo         npm install
  goto :fail
)

REM --- ports -----------------------------------------------------------------
REM Both are fixed on purpose. Vite would otherwise slide to the next free
REM port, and this script would then open a URL that is not the app.

call :portbusy %SERVER_PORT%
if "%BUSY%"=="1" (
  echo   [X] Port %SERVER_PORT% is already in use ^(the scrape API needs it^).
  echo.
  echo       Something is already listening there - possibly a copy of this
  echo       app that is still running. Close it and try again, or find it:
  echo         netstat -ano ^| findstr :%SERVER_PORT%
  goto :fail
)

call :portbusy %PAGE_PORT%
if "%BUSY%"=="1" (
  echo   [X] Port %PAGE_PORT% is already in use ^(the page needs it^).
  echo.
  echo       Close whatever is using it and try again, or find it:
  echo         netstat -ano ^| findstr :%PAGE_PORT%
  goto :fail
)

REM --- start the scrape API --------------------------------------------------

echo   Starting the scrape API on port %SERVER_PORT% ...
REM `start /D dir` sets the new windows working directory, so what follows
REM `cmd /k` can stay relative and unquoted. Passing absolute paths meant
REM nesting quotes inside an already-quoted /k argument, and cmd parses that
REM inconsistently - that spelling also left a stray second process running
REM server.py under the system Python instead of the venvs.
start "Valorant Tracker - scrape API" /D "%CD%" cmd /k %PYTHON% server.py
set "STARTED_ANY=1"

call :waitport %SERVER_PORT% 90
if "%READY%"=="0" (
  echo.
  echo   [X] The scrape API is still not answering after 90 seconds.
  echo       Look at the "scrape API" window - the error will be in there.
  goto :fail
)
echo       ready.

REM --- start the page --------------------------------------------------------

echo   Starting the page on port %PAGE_PORT% ...
set "VITE=node_modules\.bin\vite.cmd"
if exist "%WEB%\%VITE%" (
  start "Valorant Tracker - page" /D "%CD%\%WEB%" cmd /k %VITE% --port %PAGE_PORT% --strictPort
) else (
  start "Valorant Tracker - page" /D "%CD%\%WEB%" cmd /k npx vite --port %PAGE_PORT% --strictPort
)

REM Vite answers in about three seconds once its dependencies are bundled.
REM The first run after `npm install` has to bundle them, which is slower, so
REM this allows two minutes before calling it a failure.
call :waitport %PAGE_PORT% 120
if "%READY%"=="0" (
  echo.
  echo   [X] The page is still not answering after 2 minutes.
  echo       It may simply be slow to start - look at the "page" window, and
  echo       if it finishes later, open this yourself:
  echo         %PAGE_URL%
  goto :fail
)
echo       ready.

REM --- open it ---------------------------------------------------------------

echo.
echo   Opening %PAGE_URL%
start "" "%PAGE_URL%"

echo.
echo   Both parts are running in their own windows.
echo   Close those windows to stop the app.
echo.
popd
endlocal
exit /b 0

REM ===========================================================================
REM  :portbusy PORT       -> BUSY=1 if something is listening on PORT
REM ===========================================================================
:portbusy
set "BUSY=0"
REM findstr exits 0 when it matched, 1 when it did not - no counting needed.
REM
REM No `-p TCP` here, deliberately. That switch lists IPv4 only, and Vite binds
REM IPv6 first on this machine - it comes up on [::1] and never appears in the
REM IPv4 table, so the check could not see the page start and always timed out.
REM Plain `netstat -ano` covers both families; "LISTENING" keeps UDP rows out,
REM since only TCP rows carry a state.
netstat -ano | "%SystemRoot%\System32\findstr.exe" /r /c:":%~1 .*LISTENING" >nul 2>&1
if not errorlevel 1 set "BUSY=1"
exit /b 0

REM ===========================================================================
REM  :waitport PORT SECONDS  -> READY=1 once PORT is listening, else 0
REM ===========================================================================
:waitport
set "READY=0"
set /a _left=%~2
:waitloop
call :portbusy %~1
if "%BUSY%"=="1" (
  set "READY=1"
  exit /b 0
)
REM ping is the reliable one-second sleep here; `timeout` refuses to run when
REM this script's input is redirected.
ping -n 2 127.0.0.1 >nul 2>&1
set /a _left-=1
if %_left% GTR 0 goto waitloop
exit /b 0

REM ===========================================================================
:fail
echo.
if "%STARTED_ANY%"=="1" (
  echo   The windows that did open are still running. Close them to stop
  echo   whatever started, then try again.
) else (
  echo   Nothing was started.
)
echo.
popd
if "%DOUBLECLICKED%"=="1" pause
endlocal
exit /b 1
