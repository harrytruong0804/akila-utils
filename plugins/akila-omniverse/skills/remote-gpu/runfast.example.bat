@echo off
REM Launch akila.viewer_streaming.kit in dev mode with verbose logging/observability.
REM Generated helper around run.bat -- everything after "--" is forwarded to Kit as app args.
REM MODIFIED (remote debug): fixed-path log + advertise the box Tailscale IP as the streaming
REM candidate (stun_ip) so the FE connects media directly over the tailnet.

call "%~dp0run.bat" launch -d -n akila.viewer_streaming.kit -- ^
    --/exts/akila.main_ext/mode=dev ^
    --/exts/akila.streaming.readiness/stun_ip=100.64.174.26 ^
    --/log/file=%~dp0viewer.log ^
    --/log/level=info ^
    --no-window
