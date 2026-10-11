"""Release CLI regression matrix. Uses only a synthetic localhost endpoint and temp files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time


class Endpoint(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Reply(socketserver.StreamRequestHandler):
    def handle(self):
        request = json.loads(self.rfile.readline(262145))
        request_id = request['requestId']
        with self.server.lock:
            self.server.requests.append(request_id)
        scenario = request_id.split('-')[-1]
        if request['token'] != 'synthetic-cc5a-token':
            response = {'ok': False, 'error': 'Invalid fixture credential', 'retryable': False}
        elif scenario == 'server':
            response = {'ok': False, 'error': 'Synthetic server failure'}
        elif scenario == 'invalid':
            self.wfile.write(b'not-json\n')
            return
        elif scenario == 'empty':
            return
        else:
            response = {'ok': True, 'result': {'requestId': request_id, 'project': 'fixture'}}
            if scenario == 'large':
                response['result']['text'] = 'large-fixture-' * 150000
        wire = json.dumps(response, separators=(',', ':')).encode() + b'\n'
        self.wfile.write(wire)
        with self.server.lock:
            self.server.replies.append({'requestId': request_id, 'bytes': len(wire)})


def pe_subsystem(executable):
    data = executable.read_bytes()
    pe = struct.unpack_from('<I', data, 0x3C)[0]
    return struct.unpack_from('<H', data, pe + 24 + 68)[0]


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def text(raw):
    if raw.startswith(b'\xff\xfe'):
        return raw.decode('utf-16')
    return raw.decode('utf-8-sig', errors='replace')


def shell_call(shell, executable, args, mode, folder, env):
    output = folder / 'output.txt'
    status = folder / 'status.txt'
    if shell in ('ps7', 'ps51', 'codex-ps7-equivalent'):
        command = '& ' + ' '.join(ps_quote(value) for value in [executable, *args])
        if mode == 'pipe':
            command += ' | ForEach-Object { $_ }'
        if mode == 'redirect':
            command += ' > ' + ps_quote(output)
        command += '\n$code = $LASTEXITCODE\n'
        if mode == 'redirect':
            command += 'Get-Content -Raw -LiteralPath ' + ps_quote(output) + '\n'
        command += 'if ($null -eq $code) { exit 0 }; exit $code\n'
        script = folder / 'invoke.ps1'
        script.write_text(command, encoding='utf-8-sig')
        binary = (r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
                  if shell == 'ps51' else r'C:\Program Files\PowerShell\7\pwsh.exe')
        argv = [binary, '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script)]
    elif shell == 'cmd':
        # JSON strings need the native Windows argv escape, outside cmd's own quotes.
        command = ' '.join('"' + str(value).replace('"', '\\"') + '"'
                           for value in [executable, *args])
        if mode == 'pipe':
            # Keep the producer's status and bytes; cmd blocks and more change them.
            producer = folder / 'producer.cmd'
            producer.write_text('@echo off\n' + command + '\necho %errorlevel% > "' + str(status) + '"\n', encoding='utf-8')
            relay = folder / 'relay.py'
            relay.write_text('import shutil, sys\nshutil.copyfileobj(sys.stdin.buffer, sys.stdout.buffer)\n', encoding='utf-8')
            command = '"' + str(producer) + '" | "' + sys.executable + '" "' + str(relay) + '"\n'
            command += 'set /p code=<"' + str(status) + '"\nexit /b !code!\n'
        else:
            if mode == 'redirect':
                command += ' > "' + str(output) + '"'
            command += '\nset code=!errorlevel!\n'
            if mode == 'redirect':
                command += 'type "' + str(output) + '"\n'
            command += 'exit /b !code!\n'
        script = folder / 'invoke.cmd'
        script.write_text('@echo off\nsetlocal EnableDelayedExpansion\n' + command, encoding='utf-8')
        argv = [os.environ.get('COMSPEC', r'C:\Windows\System32\cmd.exe'), '/d', '/c', str(script)]
    else:
        command = ' '.join(shlex.quote(str(value).replace('\\', '/'))
                           for value in [executable, *args])
        if mode == 'pipe':
            command += ' | cat\nexit ${PIPESTATUS[0]}\n'
        elif mode == 'redirect':
            command += ' > ' + shlex.quote(output.as_posix())
            command += '\ncode=$?\ncat ' + shlex.quote(output.as_posix()) + '\nexit "$code"\n'
        else:
            command += '\nexit $?\n'
        script = folder / 'invoke.sh'
        script.write_text(command, encoding='utf-8')
        argv = [r'C:\Program Files\Git\bin\bash.exe', '--noprofile', '--norc', script.as_posix()]
    started = time.monotonic()
    result = subprocess.run(argv, cwd=folder, env=env, capture_output=True, timeout=55)
    return result, round(time.monotonic() - started, 3)


def run(options):
    executable = Path(options.binary).resolve(strict=True)
    evidence = Path(options.output).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    rows = []
    with tempfile.TemporaryDirectory(prefix='monocode-cc5a-') as temporary, Endpoint(('127.0.0.1', 0), Reply) as server:
        root = Path(temporary)
        server.lock = threading.Lock()
        server.requests, server.replies = [], []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            env = {k: v for k, v in os.environ.items()
                   if k.upper() != 'CODEX_HOME' and not k.upper().startswith(('ORCA_', 'MONOCODE_'))}
            for name in ('APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME'):
                folder = root / name
                folder.mkdir()
                env[name] = str(folder)
            env['MONOCODE_APP_ENDPOINT'] = '127.0.0.1:' + str(server.server_address[1])
            env['MONOCODE_APP_TOKEN'] = 'synthetic-cc5a-token'
            plain = root / executable.name
            shutil.copy2(executable, plain)
            spaced = root / 'path with spaces' / executable.name
            spaced.parent.mkdir()
            shutil.copy2(executable, spaced)
            for shell in ['ps7', 'ps51', 'cmd', 'bash', 'codex-ps7-equivalent']:
                for mode in ['direct', 'pipe', 'redirect', 'spaced']:
                    for kind in (['input'] if shell == 'ps51' else ['json', 'input']):
                        for scenario in ['success', 'parse', 'auth', 'server', 'help', 'large', 'invalid', 'empty']:
                            index = len(rows)
                            case = root / f'case-{index}'
                            case.mkdir()
                            request_id = f'matrix-{index}-{scenario}'
                            raw = '{' if scenario == 'parse' else '{"project":"fixture"}'
                            source = case / 'input.json'
                            source.write_text(raw, encoding='utf-8')
                            args = ['app', 'projects.list', '--request-id', request_id]
                            args += ['--json', raw] if kind == 'json' else ['--input', str(source)]
                            if scenario == 'help':
                                args = ['app', '--help']
                            case_env = dict(env)
                            if scenario == 'auth':
                                case_env['MONOCODE_APP_TOKEN'] = 'invalid-fixture-token'
                            result, elapsed = shell_call(shell, spaced if mode == 'spaced' else plain, args, mode, case, case_env)
                            stdout = text(result.stdout)
                            lines = [line for line in stdout.splitlines() if line.strip()]
                            value, failure = None, None
                            try:
                                if scenario == 'help':
                                    assert 'Usage:' in stdout and 'projects.list' in stdout
                                    assert result.returncode == 0
                                else:
                                    assert len(lines) == 1, f'expected 1 JSON line, got {len(lines)}'
                                    value = json.loads(lines[0])
                                    ok = scenario in ('success', 'large')
                                    assert value['ok'] is ok, 'unexpected ok'
                                    assert result.returncode == (0 if ok else 1), 'wrong exit code'
                                    if ok:
                                        assert value['result']['requestId'] == request_id
                                    if scenario == 'large':
                                        assert value['result']['text'] == 'large-fixture-' * 150000
                                    if scenario in ('server', 'invalid', 'empty'):
                                        assert value['requestId'] == request_id and value['retryWith'] == '--request-id ' + request_id
                            except (AssertionError, ValueError, KeyError) as error:
                                failure = str(error)
                            row = dict(shell=shell, invocation=mode, input=kind, scenario=scenario,
                                       exit=result.returncode, stdoutBytes=len(result.stdout), elapsed=elapsed,
                                       blank=not stdout.strip(), passed=failure is None, failure=failure,
                                       stderr=text(result.stderr)[:2000])
                            rows.append(row)
                            # Keep bounded evidence; large output is verified exactly above.
                            (evidence / f'case-{index}.json').write_text(json.dumps({**row, 'stdout': stdout[:4000]}, indent=2), encoding='utf-8')
                            print(f'{index + 1}: {shell}/{mode}/{kind}/{scenario}: ' + ('PASS' if not failure else 'FAIL ' + failure), flush=True)
        finally:
            server.shutdown()
            thread.join(timeout=5)
        wire = {'requests': server.requests, 'replies': server.replies}
    summary = dict(binary=str(executable), sha256=hashlib.sha256(executable.read_bytes()).hexdigest(),
                   subsystem=pe_subsystem(executable), total=len(rows), passed=sum(row['passed'] for row in rows),
                   failed=sum(not row['passed'] for row in rows), blankExitZero=sum(row['blank'] and row['exit'] == 0 for row in rows),
                   rows=rows, wire=wire,
                    harness='codex-ps7-equivalent rows use PS7 -NoProfile -File, not an actual Codex tool; see separate exec_command login:false evidence')
    (evidence / 'matrix.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in summary.items() if key not in ('rows', 'wire')}), flush=True)
    return 0 if not summary['failed'] or options.allow_failures else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--allow-failures', action='store_true', help='Record a failing baseline without failing the script.')
    raise SystemExit(run(parser.parse_args()))
