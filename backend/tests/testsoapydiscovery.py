"""Native discovery timeouts must leave no live probes or executor threads."""

import asyncio
import os
import subprocess
import sys
import textwrap
import threading
from pathlib import Path

import pytest

from hardware import soapysdrbrowser as browser

pytestmark = pytest.mark.unit


@pytest.fixture
def probes(monkeypatch, tmp_path):
    # Exercise real subprocesses without installed bindings or SDR hardware.
    (tmp_path / "SoapySDR.py").write_text(
        textwrap.dedent(
            r"""
            import atexit
            import os
            import time
            from pathlib import Path

            SOAPY_SDR_RX = 0
            SOAPY_SDR_TX = 1

            if os.environ.get('SOAPY_TEST_MODE') == 'noisy':
                print('driver initialization')
                os.write(1, b'native initialization diagnostic\n')
                atexit.register(lambda: os.write(1, b'native shutdown diagnostic\n'))

            def block():
                Path(os.environ['SOAPY_TEST_STARTED']).write_text(str(os.getpid()))
                time.sleep(60)

            class Range:
                def minimum(self): return 0
                def maximum(self): return 100
                def step(self): return 1

            class Device:
                def __init__(self, args):
                    if os.environ.get('SOAPY_TEST_MODE') == 'antenna-timeout':
                        block()

                @staticmethod
                def enumerate(args):
                    assert args == {
                        'driver': 'remote', 'remote:host': '127.0.0.1',
                        'remote:port': '55132'
                    }
                    mode = os.environ.get('SOAPY_TEST_MODE')
                    if mode == 'enumerate-timeout':
                        block()
                    if mode == 'enumerate-error':
                        raise RuntimeError('native enumeration failed')
                    return [{'driver': 'remote', 'remote:driver': 'mock', 'serial': 'ABC'}]

                def listSampleRates(self, *args): return [1000000.0]
                def getGainRange(self, *args): return Range()
                def hasGainMode(self, *args): return False
                def listAntennas(self, direction, channel):
                    return ['RX'] if direction == SOAPY_SDR_RX else ['TX']
                def getFrequencyRange(self, *args): return [Range()]
                def listSensors(self): return []
                def getSettingInfo(self): return []
            """
        ),
        encoding="utf-8",
    )
    backend = Path(__file__).resolve().parents[1]
    monkeypatch.setenv("PYTHONPATH", os.pathsep.join([str(tmp_path), str(backend)]))
    monkeypatch.setenv("SOAPY_TEST_STARTED", str(tmp_path / "started"))
    monkeypatch.setattr(browser, "HAS_SOAPYSDR", True)
    monkeypatch.chdir(backend)
    processes = []
    create_process = asyncio.create_subprocess_exec

    async def track_process(*args, **kwargs):
        process = await create_process(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(browser.asyncio, "create_subprocess_exec", track_process)
    yield processes
    # A failed assertion must not leave test probes running for their full sleep.
    for process in processes:
        if process.returncode is None:
            process.kill()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["normal", "noisy"])
async def test_discovery_returns_enumeration_and_antenna_data(monkeypatch, probes, mode):
    monkeypatch.setenv("SOAPY_TEST_MODE", mode)
    devices, status = await browser.query_sdrs_with_python_module("127.0.0.1", 55132)

    assert status == "active"
    assert devices == [
        {
            "driver": "remote",
            "remote:driver": "mock",
            "serial": "ABC",
            "antennas": {"rx": ["RX"], "tx": ["TX"]},
        }
    ]
    assert len(probes) == 2
    assert all(process.returncode == 0 for process in probes)


@pytest.mark.asyncio
async def test_enumeration_timeout_reaps_native_call(monkeypatch, probes):
    monkeypatch.setenv("SOAPY_TEST_MODE", "enumerate-timeout")
    threads_before = set(threading.enumerate())

    devices, status = await browser.query_sdrs_with_python_module("127.0.0.1", 55132, timeout=1)

    assert devices == []
    assert status == "timeout"
    assert len(probes) == 1
    assert probes[0].returncode is not None
    assert Path(os.environ["SOAPY_TEST_STARTED"]).exists()
    assert set(threading.enumerate()) == threads_before


@pytest.mark.asyncio
async def test_antenna_timeout_keeps_device_and_reaps_probe(monkeypatch, probes):
    monkeypatch.setenv("SOAPY_TEST_MODE", "antenna-timeout")
    device = {"driver": "mock", "serial": "ABC"}

    devices = await browser.enrich_remote_sdrs_with_antennas(
        "127.0.0.1", 55132, [device], timeout=1
    )

    assert devices == [{**device, "antennas": {"rx": [], "tx": []}}]
    assert len(probes) == 1
    assert probes[0].returncode is not None
    assert Path(os.environ["SOAPY_TEST_STARTED"]).exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["enumerate-timeout", "antenna-timeout"])
async def test_cancellation_reaps_probe_before_returning(monkeypatch, probes, mode):
    monkeypatch.setenv("SOAPY_TEST_MODE", mode)
    if mode == "enumerate-timeout":
        operation = browser.query_sdrs_with_python_module("127.0.0.1", 55132, timeout=60)
    else:
        operation = browser.enrich_remote_sdrs_with_antennas(
            "127.0.0.1", 55132, [{"driver": "mock"}], timeout=60
        )
    task = asyncio.create_task(operation)
    try:

        async def wait_for_native_call():
            while not Path(os.environ["SOAPY_TEST_STARTED"]).exists():
                await asyncio.sleep(0.01)

        await asyncio.wait_for(wait_for_native_call(), timeout=5)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5)

    assert len(probes) == 1
    assert probes[0].returncode is not None


@pytest.mark.asyncio
async def test_native_enumeration_error_retains_detail(monkeypatch, probes):
    monkeypatch.setenv("SOAPY_TEST_MODE", "enumerate-error")

    devices, status = await browser.query_sdrs_with_python_module("127.0.0.1", 55132)

    assert devices == []
    assert "native enumeration failed" in status
    assert len(probes) == 1
    assert probes[0].returncode != 0


def test_timed_out_discovery_worker_completes_and_exits(monkeypatch, probes):
    monkeypatch.setenv("SOAPY_TEST_MODE", "enumerate-timeout")
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            textwrap.dedent(
                """
                import asyncio
                from hardware import soapysdrbrowser as browser
                from tasks import manager as taskmodule
                from tasks.soapysdrdiscovery import soapysdr_quick_refresh_task

                async def reachable(*args):
                    return True

                query = browser.query_sdrs_with_python_module
                async def short_query(ip, port):
                    return await query(ip, port, timeout=1)

                browser.try_simple_socket_connection = reachable
                browser.query_sdrs_with_python_module = short_query
                browser.discovered_servers['test'] = {
                    'ip': '127.0.0.1', 'port': 55132, 'status': 'active'
                }
                taskmodule.WORKER_EXIT_TIMEOUT_SECONDS = 0.2

                class Socket:
                    async def emit(self, *args):
                        pass

                async def run():
                    manager = taskmodule.BackgroundTaskManager(Socket())
                    try:
                        task_id = await manager.start_task(soapysdr_quick_refresh_task)
                        info = manager.tasks[task_id]
                        await asyncio.wait_for(manager._monitor_tasks[task_id], timeout=5)
                        assert info.status == taskmodule.TaskStatus.COMPLETED
                        assert info.return_code == 0
                        assert not info.process.is_alive()
                    finally:
                        await manager.shutdown()

                asyncio.run(run())
                """
            ),
        ],
        capture_output=True,
        text=True,
        timeout=12,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["discovery", "refresh"])
async def test_sigterm_reaps_probes_before_discovery_worker_exits(monkeypatch, probes, operation):
    monkeypatch.setenv("SOAPY_TEST_MODE", "enumerate-timeout")
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        textwrap.dedent(
            """
            import asyncio
            import sys
            from hardware import soapysdrbrowser as browser
            from tasks.soapysdrdiscovery import (
                soapysdr_discovery_task, soapysdr_quick_refresh_task
            )

            class Zeroconf:
                def __init__(self):
                    self.zeroconf = self
                async def async_close(self):
                    pass

            class ServiceBrowser:
                def __init__(self, *args, **kwargs):
                    task = asyncio.create_task(
                        browser.query_sdrs_with_python_module('127.0.0.1', 55132, timeout=60)
                    )
                    browser._service_event_tasks.add(task)
                async def async_cancel(self):
                    pass

            async def reachable(*args):
                return True

            browser.AsyncZeroconf = Zeroconf
            browser.AsyncServiceBrowser = ServiceBrowser
            browser.try_simple_socket_connection = reachable
            browser.discovered_servers['test'] = {
                'ip': '127.0.0.1', 'port': 55132, 'status': 'active'
            }
            if sys.argv[1] == 'discovery':
                result = soapysdr_discovery_task()
            else:
                result = soapysdr_quick_refresh_task()
            assert result['status'] == 'interrupted', result
            """
        ),
        operation,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def wait_for_probe():
        while not Path(os.environ["SOAPY_TEST_STARTED"]).exists():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait_for_probe(), timeout=5)
    native_pid = int(Path(os.environ["SOAPY_TEST_STARTED"]).read_text())
    process.terminate()
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=5)

    assert process.returncode == 0, stdout.decode() + stderr.decode()
    with pytest.raises(ProcessLookupError):
        os.kill(native_pid, 0)
