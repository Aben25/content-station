#!/usr/bin/env python3
"""OpenAI-compatible /chat/completions endpoint answered by the Gemini CLI.

OpenShorts' moment picker talks to any OpenAI-compatible server when
LLM_BASE_URL is set (see llm_backend.py in the OpenShorts checkout). This
bridge answers each request with `gemini -p` in headless mode, so the CLI's
own sign-in does the ranking and no API key is needed. Text only: the
OpenShorts silent-footage path still needs GEMINI_API_KEY because it uploads
video to the model.

Clip Lab starts this automatically when `gemini` is on PATH and no
GEMINI_API_KEY is set. Standalone: python3 gemini_cli_bridge.py [port]
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL = os.environ.get('GEMINI_CLI_MODEL', '')  # empty: the CLI's default model
TIMEOUT = int(os.environ.get('GEMINI_CLI_TIMEOUT', '600'))
MAX_PROMPT = 800 * 1024  # stays under macOS's argument-size limit
SLOTS = threading.Semaphore(2)
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
# An empty working directory gives the CLI no project files to read or edit.
WORKDIR = Path(tempfile.mkdtemp(prefix='gemini-cli-bridge-'))


class BridgeError(RuntimeError):
    pass


def text_of(content):
    if isinstance(content, list):  # OpenAI content parts
        return ''.join(part.get('text', '') for part in content if isinstance(part, dict))
    return str(content or '')


def build_prompt(messages):
    system = [text_of(m.get('content')) for m in messages if m.get('role') == 'system']
    rest = [text_of(m.get('content')) for m in messages if m.get('role') != 'system']
    prompt = '\n\n'.join(system + rest)
    return prompt + '\n\nReply with the JSON object only: no prose, no code fences, no tool use.'


def usage_of(stats):
    prompt = output = 0
    for model in (stats or {}).get('models', {}).values():
        tokens = model.get('tokens', {}) if isinstance(model, dict) else {}
        prompt += int(tokens.get('prompt') or 0)
        output += int(tokens.get('candidates') or 0)
    return {'prompt_tokens': prompt, 'completion_tokens': output, 'total_tokens': prompt + output}


def complete(messages, requested_model=''):
    exe = shutil.which('gemini')
    if not exe:
        raise BridgeError('The Gemini CLI is not installed (npm install -g @google/gemini-cli).')
    prompt = build_prompt(messages)
    if len(prompt.encode()) > MAX_PROMPT:
        raise BridgeError('Prompt is too large for the Gemini CLI bridge.')
    model = requested_model if requested_model.startswith('gemini-') and requested_model != 'gemini-cli' else MODEL
    # --skip-trust: headless runs refuse untrusted folders, and WORKDIR is an empty temp dir.
    command = [exe, '--output-format', 'json', '--skip-trust', '-p', prompt]
    if model:
        command += ['-m', model]
    with SLOTS:
        result = subprocess.run(command, cwd=WORKDIR, stdin=subprocess.DEVNULL, capture_output=True,
                                text=True, timeout=TIMEOUT, check=False)
    data = parse_json(result.stdout)
    if result.returncode or 'response' not in data:
        # Failures arrive as a JSON document on stderr, e.g. a missing sign-in (exit 41).
        error = data.get('error') or parse_json(result.stderr).get('error')
        if isinstance(error, dict) and error.get('message'):
            raise BridgeError(ANSI.sub('', error['message']))
        lines = [ANSI.sub('', line).strip() for line in (result.stderr or result.stdout).splitlines()]
        # Prefer the CLI's own "Error ...: reason" line over the stack trace that follows it.
        reason = next((line for line in lines if line.startswith('Error')), None)
        lines = [line for line in lines if len(line) > 2]
        raise BridgeError(reason or (lines[-1] if lines else f'gemini exited {result.returncode}'))
    return str(data['response']), usage_of(data.get('stats')), model or 'gemini-cli-default'


def parse_json(text):
    text = text.strip()
    try:
        data = json.loads(text[text.index('{'):]) if '{' in text else {}
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


class Handler(BaseHTTPRequestHandler):
    server_version = 'GeminiCliBridge'

    def log_message(self, fmt, *args):
        pass

    def reply(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip('/') in ('/health', '/v1/models', '/models'):
            return self.reply({'ok': True, 'cli': shutil.which('gemini'), 'object': 'list',
                               'data': [{'id': MODEL or 'gemini-cli', 'object': 'model'}]})
        self.reply({'error': {'message': 'Not found'}}, 404)

    def do_POST(self):
        if self.path.rstrip('/') not in ('/v1/chat/completions', '/chat/completions'):
            return self.reply({'error': {'message': 'Not found'}}, 404)
        if (self.headers.get('Host') or '').rsplit(':', 1)[0] not in ('127.0.0.1', 'localhost'):
            return self.reply({'error': {'message': 'Bridge only answers on localhost.'}}, 403)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            started = time.monotonic()
            text, usage, model = complete(body.get('messages') or [], str(body.get('model') or ''))
            sys.stderr.write(f'gemini-cli bridge: answered in {time.monotonic() - started:.1f}s\n')
        except (ValueError, TypeError):
            return self.reply({'error': {'message': 'Send an OpenAI chat completion request.'}}, 400)
        except (BridgeError, subprocess.TimeoutExpired) as error:
            sys.stderr.write(f'gemini-cli bridge: {error}\n')
            return self.reply({'error': {'message': f'Gemini CLI: {error}'}}, 502)
        self.reply({'id': 'chatcmpl-' + uuid.uuid4().hex, 'object': 'chat.completion', 'created': int(time.time()),
                    'model': model, 'usage': usage,
                    'choices': [{'index': 0, 'finish_reason': 'stop',
                                 'message': {'role': 'assistant', 'content': text}}]})


def start_bridge(port):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4321
    print(f'Gemini CLI bridge on http://127.0.0.1:{port}/v1', flush=True)
    start_bridge(port)
    threading.Event().wait()
