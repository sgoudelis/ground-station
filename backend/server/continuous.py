# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Backend-owned, unbounded observations; browsers are viewers, never controllers."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from common.continuous import Definition
from common.sdrconfig import SDRConfig
from crud import continuous
from crud.hardware import fetch_sdr
from db import AsyncSessionLocal
from observations.tasks.decoderhandler import map_scheduler_decoder_parameters
from pipeline.registries.decoderregistry import decoder_registry
from pipeline.registries.demodulatorregistry import demodulator_registry
from server import runtimestate
from session.service import session_service
from session.tracker import session_tracker
from vfos.parameters import decoder_parameter_overrides
from vfos.state import VFOManager

logger = logging.getLogger("continuous-observations")
ACTIVE = {"starting", "running", "stopping"}
PREFIX = "internal:continuous-"


class ContinuousObservations:
    def __init__(self, process_manager: Any, sio: Any, session_factory: Any = AsyncSessionLocal):
        self.process_manager = process_manager
        self.sio = sio
        self.session_factory = session_factory
        self.runs: dict[str, dict[str, Any]] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.starts: set[asyncio.Task] = set()
        self.background: set[asyncio.Task] = set()
        self.automatic: asyncio.Task | None = None
        self.closing = False

    def lock(self, identity: str) -> asyncio.Lock:
        return self.locks.setdefault(identity, asyncio.Lock())

    def snapshot(self, identity: str) -> dict[str, Any]:
        return {
            **self.runs.get(identity, {"status": "not_started", "started_at": None, "error": None}),
            "active": self.active(identity),
        }

    def active(self, identity: str) -> bool:
        run = self.runs.get(identity, {})
        info = self.process_manager.processes.get(run.get("sdr_id"), {})
        return run.get("status") in ACTIVE or run.get("session_id") in info.get("clients", set())

    async def changed(self, identity: str) -> None:
        try:
            await self.sio.emit("continuous-observations-changed", {"id": identity})
        except Exception:
            # Notification failure must not undo an accepted runtime transition.
            logger.exception("Unable to publish continuous observation %s", identity)

    async def start(
        self, identity: str, expected_updated_at: str | None = None, *, automatic: bool = False
    ) -> dict[str, Any]:
        async with self.lock(identity):
            if self.closing:
                raise continuous.DefinitionError("Backend is shutting down.", "unavailable")
            if self.active(identity):
                if self.runs[identity]["status"] in ACTIVE:
                    return self.snapshot(identity)
                raise continuous.DefinitionError(
                    "Stop the failed observation before restarting it.", "conflict"
                )
            task = asyncio.create_task(self._start(identity, expected_updated_at, automatic))
            self.starts.add(task)
            try:
                return await task
            finally:
                self.starts.discard(task)

    async def _start(
        self, identity: str, expected_updated_at: str | None, automatic: bool
    ) -> dict[str, Any]:
        async with self.session_factory() as session:
            saved = await continuous.list_definitions(session, identity)
            if automatic and not saved["auto_start"]:
                return self.snapshot(identity)
            if expected_updated_at and datetime.fromisoformat(
                expected_updated_at.replace("Z", "+00:00")
            ) != datetime.fromisoformat(saved["updated_at"]):
                raise continuous.DefinitionError(
                    "This definition changed. Refresh before starting.", "conflict"
                )
            definition = Definition.model_validate(
                {key: saved[key] for key in Definition.model_fields}
            )
            device_reply = await fetch_sdr(session, definition.sdr.id)
            if not device_reply.get("success") or not device_reply.get("data"):
                raise continuous.DefinitionError("The configured receiver no longer exists.")
            device = device_reply["data"]

        session_id = f"{PREFIX}{identity}"
        run = self.runs[identity] = {
            "status": "starting",
            "session_id": session_id,
            "sdr_id": definition.sdr.id,
            "started_at": None,
            "error": None,
            "definition_updated_at": saved["updated_at"],
        }
        try:
            await self.changed(identity)
            receiver = definition.sdr
            config = SDRConfig(
                sdr_id=receiver.id,
                center_freq=receiver.center_frequency,
                sample_rate=receiver.sample_rate,
                gain=receiver.gain,
                antenna=receiver.antenna_port,
                bias_t=receiver.bias_t,
                tuner_agc=receiver.tuner_agc,
                rtl_agc=receiver.rtl_agc,
                soapy_agc=receiver.soapy_agc,
                fft_size=16384,
                fft_window="hamming",
                fft_averaging=1,
                serial_number=device.get("serial") or device.get("serial_number") or 0,
                sdr_settings=receiver.sdr_settings.model_dump(exclude_unset=True),
            ).to_dict()
            config["continuous_observation_id"] = identity
            # Internal sessions have ten fixed VFO slots and no browser owner.
            session_tracker.register_internal_session(
                f"continuous-{identity}",
                receiver.id,
                1,
                {
                    "continuous_observation_id": identity,
                    "name": definition.name,
                    "user_agent": f"ContinuousObservation/{identity}",
                },
            )
            await session_service.configure_sdr(session_id, device, config)
            await session_service.start_streaming(session_id, device)
            info = self.process_manager.processes[receiver.id]
            live = info.get("config", config)
            status = info.get("bandwidth_status") or {}
            if status.get("error"):
                raise ValueError(f"Receiver bandwidth: {status['error']}")
            width = float(live["sample_rate"])
            if status.get("actual_hz"):
                width = min(width, float(status["actual_hz"]))
            for number, vfo in enumerate(definition.vfos, 1):
                if abs(vfo.frequency - float(live["center_freq"])) + vfo.bandwidth / 2 > width / 2:
                    raise ValueError(
                        f"VFO {number} extends outside the receiver's applied bandwidth."
                    )
                VFOManager().update_vfo_state(
                    session_id,
                    number,
                    center_freq=vfo.frequency,
                    bandwidth=int(vfo.bandwidth),
                    modulation=vfo.modulation,
                    decoder=vfo.decoder,
                    active=True,
                    locked_transmitter_id="none",
                    parameters_enabled=True,
                )
                if vfo.decoder != "none":
                    overrides = map_scheduler_decoder_parameters(
                        vfo.decoder, vfo.decoder_parameters
                    )
                    # ADS-B exposes prefixed settings, just like its live VFO editor.
                    if vfo.decoder == "adsb":
                        overrides.update(vfo.decoder_parameters)
                    decoder_parameter_overrides[f"{session_id}_{number}"] = overrides
                    decoder_class = decoder_registry.get_decoder_class(vfo.decoder)
                    if decoder_class is None or not self.process_manager.start_decoder(
                        sdr_id=receiver.id,
                        session_id=session_id,
                        decoder_class=decoder_class,
                        data_queue=info["data_queue"],
                        audio_out_queue=runtimestate.audio_queue,
                        vfo_center_freq=vfo.frequency,
                        vfo=number,
                        decoder_param_overrides=overrides,
                        output_dir="data/decoded",
                        caller="continuous-observation",
                    ):
                        raise RuntimeError(
                            f"Unable to start {vfo.decoder} decoder for VFO {number}."
                        )
                elif vfo.modulation != "none":
                    mode = vfo.modulation
                    ssb = mode in {"usb", "lsb", "cw"}
                    demodulator = demodulator_registry.get_demodulator_class("ssb" if ssb else mode)
                    if demodulator is None or not self.process_manager.start_demodulator(
                        receiver.id,
                        session_id,
                        demodulator,
                        runtimestate.audio_queue,
                        vfo_number=number,
                        **({"mode": mode} if ssb else {}),
                    ):
                        raise RuntimeError(f"Unable to start {mode} demodulator for VFO {number}.")
            if run["error"] or not self.process_manager.is_sdr_process_running(receiver.id):
                raise RuntimeError(run["error"] or "Receiver stopped during startup.")
            run.update(status="running", started_at=datetime.now(timezone.utc).isoformat())
        except BaseException as error:
            run.update(
                status="failed",
                error=(
                    "Startup cancelled."
                    if isinstance(error, asyncio.CancelledError)
                    else str(error)
                ),
            )
            try:
                await self._cleanup(identity)
            except Exception:
                logger.exception("Unable to roll back continuous observation %s", identity)
            await self.changed(identity)
            raise
        await self.changed(identity)
        return self.snapshot(identity)

    async def _cleanup(self, identity: str) -> None:
        # Worker teardown sets a stopping flag before yielding. Once begun, it
        # must finish even when the caller's startup request is cancelled.
        task = asyncio.create_task(self._release(identity))
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def _release(self, identity: str) -> None:
        run = self.runs[identity]
        info = self.process_manager.processes.get(run["sdr_id"], {})
        if info.get("continuous_observation_id") == identity:
            # Closing the observation also closes every viewer; a JOIN must not
            # keep an ended observation's receiver worker alive.
            await self.process_manager.stop_sdr_process(run["sdr_id"])
        await session_service.cleanup_internal_observation(f"continuous-{identity}")

    async def stop(
        self, identity: str, *, failed: bool = False, expected_run: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        async with self.lock(identity):
            if identity not in self.runs or (
                expected_run is not None and self.runs[identity] is not expected_run
            ):
                # A delayed failure callback must not stop a replacement run.
                return self.snapshot(identity)
            run = self.runs[identity]
            run["status"] = "stopping"
            await self.changed(identity)
            try:
                await self._cleanup(identity)
                run["status"] = "failed" if failed else "stopped"
                if not failed:
                    run["error"] = None
            except Exception as error:
                run.update(status="failed", error=str(error))
                raise
            finally:
                await self.changed(identity)
            return self.snapshot(identity)

    async def handle_failure(self, sdr_id: str, session_ids: set[str], message: str) -> None:
        for identity, run in list(self.runs.items()):
            if run["session_id"] not in session_ids or run["status"] not in {"starting", "running"}:
                continue
            starting = run["status"] == "starting"
            run.update(status="failed", error=f"SDR {sdr_id} failed: {message}")
            await self.changed(identity)
            if not starting:
                # The worker monitor owns teardown while invoking this callback.
                # Cleanup must run after it returns, never wait on itself.
                self._background(self._finish_failure(identity, run))

    async def _finish_failure(self, identity: str, run: dict[str, Any]) -> None:
        try:
            await self.stop(identity, failed=True, expected_run=run)
        except Exception:
            logger.exception("Failed observation cleanup: %s", identity)

    def _background(self, operation: Any) -> asyncio.Task:
        task = asyncio.create_task(operation)
        self.background.add(task)
        task.add_done_callback(self.background.discard)
        return task

    async def start_enabled(self) -> None:
        try:
            async with self.session_factory() as session:
                definitions = await continuous.list_definitions(session)
            # Deterministic order makes competing definitions predictable. One
            # unavailable receiver never prevents the other definitions starting.
            for definition in definitions:
                if self.closing:
                    break
                if definition["auto_start"]:
                    try:
                        await self.start(definition["id"], automatic=True)
                    except Exception:
                        logger.exception(
                            "Unable to start continuous observation %s", definition["id"]
                        )
        except Exception:
            logger.exception("Unable to load continuous observations for startup")

    def start_automatic(self) -> None:
        self.automatic = self._background(self.start_enabled())

    async def shutdown(self) -> None:
        self.closing = True
        # Cancel startup, but drain failure cleanup without interrupting worker
        # teardown. Cancelling teardown can strand its shared stopping flag.
        if self.automatic and not self.automatic.done():
            if not self.automatic.cancelling():
                self.automatic.cancel()
            await asyncio.gather(self.automatic, return_exceptions=True)
        tasks = set(self.starts)
        for task in tasks:
            if not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(*self.background, return_exceptions=True)
        results = await asyncio.gather(
            *(self.stop(identity) for identity in self.runs), return_exceptions=True
        )
        for result in results:
            if isinstance(result, BaseException):
                logger.error("Continuous observation shutdown failed: %s", result)
