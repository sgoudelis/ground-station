# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Device processes have no dependency on tracker process lifetimes."""

import asyncio
import os
import time

import setproctitle

from hardware.runtime import DeviceRuntime


async def run_device(connection, kind, device_id, details, epoch, parent_pid):
    runtime = DeviceRuntime(kind, device_id, details, epoch)
    pending = set()

    async def execute(request):
        try:
            result = await runtime.execute(request)
            reply = {"result": result}
        except Exception as error:
            reply = {"error": str(error), "error_type": type(error).__name__}
        connection.send({"snapshot": runtime.snapshot()})
        connection.send({"request_id": request["request_id"], **reply})

    last_poll = 0.0
    try:
        while os.getppid() == parent_pid:
            while connection.poll():
                request = connection.recv()
                if request.get("method") == "shutdown":
                    return
                task = asyncio.create_task(execute(request))
                pending.add(task)
                task.add_done_callback(pending.discard)
            if time.monotonic() - last_poll >= 1 and not runtime.lock.locked():
                try:
                    await runtime.tick()
                except Exception as error:
                    runtime.data.update(error=True, error_message=str(error))
                connection.send({"snapshot": runtime.snapshot()})
                last_poll = time.monotonic()
            await asyncio.sleep(0.01)
    finally:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        if runtime.controller and runtime.data["connected"]:
            try:
                await runtime.quiesce()
            finally:
                await runtime.controller.disconnect()
        connection.close()


def device_process(connection, kind, device_id, details, epoch, parent_pid):
    setproctitle.setproctitle(f"Ground Station - {kind}[{device_id}]")
    asyncio.run(run_device(connection, kind, device_id, details, epoch, parent_pid))
