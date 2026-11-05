# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.


import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional, Tuple


class RigController:
    def __init__(
        self,
        model: Optional[int] = None,  # Model is no longer used directly
        host: str = "127.0.0.1",
        port: int = 4532,
        verbose: bool = False,
        timeout: float = 3.0,
    ):
        # Set up logging
        device_path = f"{host}:{port}"
        self.logger = logging.getLogger("rig-control")
        self.logger.info(f"Initializing RigController with device={device_path}")

        # Initialize attributes
        self.host = host
        self.port = port
        self.device_path = device_path
        self.verbose = verbose
        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self.connected = False
        self.timeout = timeout
        self.command_lock = asyncio.Lock()
        self.supports_split_tx_cmd = False
        self.supports_vfo_opt = False
        self.supports_explicit_vfo_cmd = False
        self.supports_ptt_query = False

    async def connect(self) -> bool:
        if self.connected:
            self.logger.warning("Already connected to rig")
            return True

        try:
            # First ping the rig to ensure it's responsive
            pingcheck = await self.ping()
            assert pingcheck, "Rig did not respond to ping"

            self.logger.debug(f"Connecting to rig at {self.device_path}")

            # Create a persistent connection
            reader_writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=self.timeout
            )
            self.reader, self.writer = reader_writer

            self.connected = True
            await self._probe_capabilities()
            self.logger.info(f"Successfully connected to rig at {self.device_path}")
            return True

        except Exception as e:
            self.logger.error(f"Error connecting to rig: {e}")
            raise RuntimeError(f"Error connecting to rig: {e}")

    async def disconnect(self) -> bool:
        if not self.connected or self.writer is None:
            self.logger.warning("Not connected to rig")
            return True

        try:
            # Send a quit command (optional)
            try:
                await self._send_command("q", waitforreply=False)
            except Exception:
                self.logger.warning("Error sending quit command to rig")

            await self.close()
            self.logger.info("Disconnected from rig")
            return True

        except Exception as e:
            self.logger.error(f"Error disconnecting from rig: {e}")
            return False

    async def close(self):
        """Discard a transport without sending commands on an uncertain stream."""
        writer = self.writer
        self.connected = False
        self.reader = self.writer = None
        self.supports_split_tx_cmd = False
        self.supports_vfo_opt = False
        self.supports_explicit_vfo_cmd = False
        self.supports_ptt_query = False
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
            except (OSError, asyncio.TimeoutError):
                pass

    @asynccontextmanager
    async def _create_connection(self):
        """Creates a temporary connection if not already connected."""
        if self.connected and self.reader is not None and self.writer is not None:
            # Use existing connection
            yield self.reader, self.writer
        else:
            # Create temporary connection
            reader = writer = None
            try:
                # Use asyncio's open_connection with timeout
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port), timeout=self.timeout
                )
                yield reader, writer
            finally:
                # Close the connection if it was opened temporarily
                if writer is not None and (not self.connected or writer is not self.writer):
                    writer.close()
                    try:
                        # Wait for the writer to close, but with a timeout
                        await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
                    except (asyncio.TimeoutError, Exception):
                        # Ignore errors during cleanup
                        pass

    async def _send_command(self, command: str, waitforreply: bool = True) -> str:
        """Send a command to the rig and get the response."""
        self.check_connection()

        if self.writer is None or self.reader is None:
            raise RuntimeError("Writer or reader is None")

        try:
            async with self.command_lock:
                # Add newline to the command
                full_command = f"{command}\n"

                # Send the command
                self.writer.write(full_command.encode("utf-8"))
                await self.writer.drain()
                self.logger.debug(f"TX -> {command}")

                if waitforreply:
                    # Read first response line
                    first_line = await asyncio.wait_for(
                        self.reader.readline(), timeout=self.timeout
                    )
                    response = first_line.decode("utf-8", errors="replace").strip()
                    self.logger.debug(f"RX <- {response}")

                    # Drain any additional lines to keep protocol in sync.
                    while True:
                        try:
                            extra_line = await asyncio.wait_for(
                                self.reader.readline(), timeout=0.03
                            )
                        except asyncio.TimeoutError:
                            break
                        if not extra_line:
                            break
                        extra = extra_line.decode("utf-8", errors="replace").strip()
                        if extra:
                            self.logger.debug(f"RX <- (extra) {extra}")
                else:
                    response = "(no wait for reply)"
                    self.logger.debug("RX <- (skipped, waitforreply=False)")

                return response

        except Exception as e:
            self.logger.error(f"Error sending command '{command}': {e}")
            raise RuntimeError(f"Error communicating with rig: {e}")

    async def ping(self):
        try:
            # Use the async connection manager
            async with self._create_connection() as (reader, writer):
                # Send frequency query command
                writer.write(b"f\n")
                await writer.drain()
                self.logger.debug("TX -> f")

                # Receive response with timeout
                response_bytes = await asyncio.wait_for(reader.read(1000), timeout=self.timeout)

                response = response_bytes.decode("utf-8", errors="replace").strip()
                self.logger.debug(f"RX <- {response}")

                # Parse the response
                if not response:
                    return False

                # Handle different response formats
                if response.startswith("RPRT"):
                    error_code = int(response.split()[1])
                    return error_code >= 0

                elif response.startswith("get_freq:"):
                    parts = response.split(":")[1].strip()
                    try:
                        float(parts)
                        return True
                    except ValueError:
                        return False

                else:
                    try:
                        float(response)
                        return True
                    except ValueError:
                        return False

        except (asyncio.TimeoutError, ConnectionRefusedError, OSError) as e:
            # Handle all connection-related errors
            self.logger.exception(e)
            return False

        except Exception as e:
            # Catch all other exceptions
            self.logger.exception(e)
            return False

    @staticmethod
    def _parse_rprt_code(response: str) -> Optional[int]:
        if not response.startswith("RPRT"):
            return None
        try:
            parts = response.split()
            return int(parts[1]) if len(parts) >= 2 else None
        except (ValueError, IndexError):
            return None

    async def _probe_capabilities(self) -> None:
        """Probe optional rigctld capabilities used by advanced tracking strategies."""
        self.supports_split_tx_cmd = False
        self.supports_vfo_opt = False
        self.supports_explicit_vfo_cmd = False
        self.supports_ptt_query = False

        try:
            tx_response = await self._send_command("i")
            tx_code = self._parse_rprt_code(tx_response)
            self.supports_split_tx_cmd = tx_code is None or tx_code >= 0
        except Exception:
            self.supports_split_tx_cmd = False

        try:
            ptt_response = await self._send_command("t")
            ptt_code = self._parse_rprt_code(ptt_response)
            self.supports_ptt_query = ptt_code is None or ptt_code >= 0
        except Exception:
            self.supports_ptt_query = False

        try:
            # Query/enable parser mode support; explicit-VFO strategy depends on this.
            set_vfo_opt_response = await self._send_command("\\set_vfo_opt 1")
            set_vfo_opt_code = self._parse_rprt_code(set_vfo_opt_response)
            self.supports_vfo_opt = set_vfo_opt_code is None or set_vfo_opt_code >= 0
            self.supports_explicit_vfo_cmd = self.supports_vfo_opt
        except Exception:
            self.supports_vfo_opt = False
            self.supports_explicit_vfo_cmd = False

        # Keep rigctld in legacy/default parsing mode because the controller currently
        # sends non-vfo_opt command forms (F/f/V without explicit leading VFO args).
        try:
            await self._send_command("\\set_vfo_opt 0")
        except Exception:
            pass

        self.logger.debug(
            "Rig capabilities: split_tx_cmd=%s, explicit_vfo_cmd=%s, vfo_opt=%s, ptt_query=%s",
            self.supports_split_tx_cmd,
            self.supports_explicit_vfo_cmd,
            self.supports_vfo_opt,
            self.supports_ptt_query,
        )

    async def set_vfo_opt(self, enabled: bool) -> bool:
        """Enable/disable rigctld VFO-aware short-command parser."""
        value = 1 if enabled else 0
        response = await self._send_command(f"\\set_vfo_opt {value}")
        error_code = self._parse_rprt_code(response)
        if error_code is not None and error_code < 0:
            self.logger.error("set_vfo_opt failed: %s", response)
            return False
        return True

    async def get_frequency(self) -> float:
        """Get the current frequency."""
        try:
            response = await self._send_command("f")

            # Handle various response formats
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting frequency: {response}")
                return 0.0  # Default value on success without frequency info

            elif response.startswith("get_freq:"):
                parts = response.split(":")[1].strip()
                try:
                    freq = float(parts)
                    self.logger.debug(f"Current frequency: {freq} Hz")
                    return round(freq, 0)
                except ValueError:
                    raise RuntimeError(f"Invalid frequency format: {response}")

            else:
                # Try to parse as direct value
                try:
                    freq = float(response)
                    self.logger.debug(f"Current frequency: {freq} Hz")
                    return round(freq, 0)
                except ValueError:
                    raise RuntimeError(f"Invalid frequency format: {response}")

        except Exception as e:
            self.logger.error(f"Error getting frequency: {e}")
            raise RuntimeError(f"Error getting frequency: {e}")

    async def get_mode(self) -> Tuple[str, int]:
        """Get the current mode and bandwidth."""
        try:
            response = await self._send_command("m")

            # Handle various response formats
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting mode: {response}")
                return "UNKNOWN", 0  # Default values on success without mode info

            elif response.startswith("get_mode:"):
                parts = response.split(":")[1].strip().split()
                if len(parts) >= 2:
                    mode = parts[0]
                    try:
                        bandwidth = int(parts[1])
                        self.logger.debug(f"Current mode: {mode}, bandwidth: {bandwidth} Hz")
                        return mode, bandwidth
                    except ValueError:
                        raise RuntimeError(f"Invalid bandwidth value: {parts[1]}")
                raise RuntimeError(f"Invalid mode format: {response}")

            else:
                # Try to parse direct values
                parts = response.split()
                if len(parts) >= 2:
                    mode = parts[0]
                    try:
                        bandwidth = int(parts[1])
                        self.logger.debug(f"Current mode: {mode}, bandwidth: {bandwidth} Hz")
                        return mode, bandwidth
                    except ValueError:
                        raise RuntimeError(f"Invalid bandwidth value: {parts[1]}")
                raise RuntimeError(f"Invalid mode format: {response}")

        except Exception as e:
            self.logger.error(f"Error getting mode: {e}")
            raise RuntimeError(f"Error getting mode: {e}")

    async def standby(self) -> bool:
        """Set the rig to standby power state."""
        try:
            self.logger.info("Setting rig to standby")

            # Format the power status command for standby (0)
            command = "set_powerstat 0"
            response = await self._send_command(command)

            # Check the response
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Standby command failed: {response}")
                    return False

            self.logger.debug(f"Standby command: response={response}")
            return True

        except Exception as e:
            self.logger.error(f"Error setting rig to standby: {e}")
            raise RuntimeError(f"Error setting rig to standby: {e}")

    def check_connection(self) -> bool:
        """Check if connected to the rig."""
        if not self.connected or self.writer is None or self.reader is None:
            error_msg = f"Not connected to rig (connected: {self.connected})"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)
        return True

    async def set_frequency(
        self,
        target_freq: float,
        update_interval: float = 0.5,
        freq_tolerance: float = 10.0,
        vfo: str = "1",
    ) -> AsyncGenerator[Tuple[float, bool], None]:
        """Set the rig frequency and yield updates until it reaches the target."""
        # Map VFO string to rigctld VFO name
        vfo_map = {
            "1": "VFOA",
            "2": "VFOB",
            "none": "VFOA",  # Default to VFO A
        }
        rigctld_vfo = vfo_map.get(vfo, "VFOA")

        # Start the frequency setting operation
        self.logger.debug(f"Setting rig frequency to {target_freq} Hz on VFO {vfo}")

        try:
            # First, set the VFO if needed
            vfo_command = f"V {rigctld_vfo}"
            vfo_response = await self._send_command(vfo_command)
            self.logger.debug(f"Set VFO command: response={vfo_response}")

            # Format the set frequency command
            command = f"F {int(round(target_freq))}"
            response = await self._send_command(command)

            # Check the response
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    error_msg = f"Failed to set frequency: {response}"
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg)

            self.logger.debug(f"Set frequency command: response={response}")

        except Exception as e:
            self.logger.error(f"Error setting rig frequency: {e}")
            self.logger.exception(e)
            raise RuntimeError(f"Error setting rig frequency: {e}")

        # Initial status
        current_freq = await self.get_frequency()
        freq_reached = abs(current_freq - target_freq) <= freq_tolerance
        is_tuning = not freq_reached

        # First yield with initial frequency
        yield current_freq, is_tuning

        # Keep checking frequency when a consumer requests an update
        while is_tuning:
            # Wait for the update interval
            await asyncio.sleep(update_interval)

            # Get current frequency
            current_freq = await self.get_frequency()

            # Check if we've reached the target
            freq_reached = abs(current_freq - target_freq) <= freq_tolerance
            is_tuning = not freq_reached

            # Yield the current frequency and tuning status
            yield current_freq, is_tuning

    async def set_mode(self, mode: str, bandwidth: int = 0) -> bool:
        """Set the rig mode and bandwidth."""
        try:
            self.logger.info(f"Setting rig mode to {mode}, bandwidth={bandwidth} Hz")

            # Format the set mode command
            command = f"M {mode} {bandwidth}"
            response = await self._send_command(command)

            # Check the response
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    error_msg = f"Failed to set mode: {response}"
                    self.logger.error(error_msg)
                    return False

            self.logger.debug(f"Set mode command: response={response}")
            return True

        except Exception as e:
            self.logger.error(f"Error setting rig mode: {e}")
            self.logger.exception(e)
            raise RuntimeError(f"Error setting rig mode: {e}")

    async def set_frequency_direct(self, target_freq: float) -> bool:
        """Set frequency on the active RX path without switching VFO."""
        try:
            response = await self._send_command(f"F {int(round(target_freq))}")
            error_code = self._parse_rprt_code(response)
            if error_code is not None and error_code < 0:
                self.logger.error(f"Set direct frequency command failed: {response}")
                return False
            return True
        except Exception as e:
            self.logger.error(f"Error setting direct frequency: {e}")
            raise RuntimeError(f"Error setting direct frequency: {e}")

    async def get_tx_frequency(self) -> float:
        """Get TX/split frequency when supported by rigctld (`i`)."""
        try:
            response = await self._send_command("i")
            error_code = self._parse_rprt_code(response)
            if error_code is not None:
                if error_code < 0:
                    raise RuntimeError(f"Error getting TX frequency: {response}")
                return 0.0

            if response.startswith("get_split_freq:"):
                parts = response.split(":")[1].strip()
                return round(float(parts), 0)

            return round(float(response.strip()), 0)
        except Exception as e:
            self.logger.error(f"Error getting TX frequency: {e}")
            raise RuntimeError(f"Error getting TX frequency: {e}")

    async def set_tx_frequency(self, target_freq: float) -> bool:
        """Set TX/split frequency when supported by rigctld (`I`)."""
        try:
            response = await self._send_command(f"I {int(round(target_freq))}")
            error_code = self._parse_rprt_code(response)
            if error_code is not None and error_code < 0:
                self.logger.error(f"Set TX frequency command failed: {response}")
                return False
            return True
        except Exception as e:
            self.logger.error(f"Error setting TX frequency: {e}")
            raise RuntimeError(f"Error setting TX frequency: {e}")

    async def set_frequency_explicit_vfo(self, vfo_name: str, target_freq: float) -> bool:
        """
        Set frequency on a specific VFO using explicit-VFO short command format.

        This uses rigctld VFO-aware parsing: ``\\set_vfo_opt 1`` + ``F VFOx <Hz>``.
        """
        if vfo_name not in {"VFOA", "VFOB"}:
            raise ValueError(f"Unsupported VFO name for explicit control: {vfo_name}")

        if not self.supports_explicit_vfo_cmd:
            self.logger.error("Explicit VFO command strategy is not supported by this rig")
            return False

        vfo_opt_enabled = False
        try:
            vfo_opt_enabled = await self.set_vfo_opt(True)
            if not vfo_opt_enabled:
                return False

            response = await self._send_command(f"F {vfo_name} {int(round(target_freq))}")
            error_code = self._parse_rprt_code(response)
            if error_code is not None and error_code < 0:
                self.logger.error("Explicit VFO set frequency failed: %s", response)
                return False
            return True
        except Exception as e:
            self.logger.error("Error setting explicit VFO frequency: %s", e)
            raise RuntimeError(f"Error setting explicit VFO frequency: {e}")
        finally:
            if vfo_opt_enabled:
                try:
                    await self.set_vfo_opt(False)
                except Exception:
                    pass

    async def get_vfo(self) -> str:
        """Get the current VFO."""
        try:
            response = await self._send_command("v")

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting VFO: {response}")
                return "UNKNOWN"

            elif response.startswith("get_vfo:"):
                vfo = response.split(":")[1].strip()
                return vfo

            else:
                return response.strip()

        except Exception as e:
            self.logger.error(f"Error getting VFO: {e}")
            raise RuntimeError(f"Error getting VFO: {e}")

    async def set_vfo(self, vfo: str) -> bool:
        """Set the VFO."""
        try:
            command = f"V {vfo}"
            response = await self._send_command(command)

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set VFO command failed: {response}")
                    return False

            return True

        except Exception as e:
            self.logger.error(f"Error setting VFO: {e}")
            raise RuntimeError(f"Error setting VFO: {e}")

    async def get_rit(self) -> int:
        """Get RIT (Receiver Incremental Tuning)."""
        try:
            response = await self._send_command("j")

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting RIT: {response}")
                return 0

            elif response.startswith("get_rit:"):
                rit_str = response.split(":")[1].strip()
                try:
                    return int(rit_str)
                except ValueError:
                    raise RuntimeError(f"Invalid RIT value: {rit_str}")

            else:
                try:
                    return int(response.strip())
                except ValueError:
                    raise RuntimeError(f"Invalid RIT value: {response}")

        except Exception as e:
            self.logger.error(f"Error getting RIT: {e}")
            raise RuntimeError(f"Error getting RIT: {e}")

    async def set_rit(self, rit: int) -> bool:
        """Set RIT (Receiver Incremental Tuning)."""
        try:
            command = f"J {rit}"
            response = await self._send_command(command)

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set RIT command failed: {response}")
                    return False

            return True

        except Exception as e:
            self.logger.error(f"Error setting RIT: {e}")
            raise RuntimeError(f"Error setting RIT: {e}")

    async def get_xit(self) -> int:
        """Get XIT (Transmitter Incremental Tuning)."""
        try:
            response = await self._send_command("z")

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting XIT: {response}")
                return 0

            elif response.startswith("get_xit:"):
                xit_str = response.split(":")[1].strip()
                try:
                    return int(xit_str)
                except ValueError:
                    raise RuntimeError(f"Invalid XIT value: {xit_str}")

            else:
                try:
                    return int(response.strip())
                except ValueError:
                    raise RuntimeError(f"Invalid XIT value: {response}")

        except Exception as e:
            self.logger.error(f"Error getting XIT: {e}")
            raise RuntimeError(f"Error getting XIT: {e}")

    async def set_xit(self, xit: int) -> bool:
        """Set XIT (Transmitter Incremental Tuning)."""
        try:
            command = f"Z {xit}"
            response = await self._send_command(command)

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set XIT command failed: {response}")
                    return False

            return True

        except Exception as e:
            self.logger.error(f"Error setting XIT: {e}")
            raise RuntimeError(f"Error setting XIT: {e}")

    async def get_ptt(self) -> bool:
        """Get PTT (Push To Talk) status."""
        try:
            response = await self._send_command("t")

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting PTT: {response}")
                return False

            elif response.startswith("get_ptt:"):
                ptt_str = response.split(":")[1].strip()
                return ptt_str == "1"

            else:
                return response.strip() == "1"

        except Exception as e:
            self.logger.error(f"Error getting PTT: {e}")
            raise RuntimeError(f"Error getting PTT: {e}")

    async def set_ptt(self, ptt_on: bool) -> bool:
        """Set PTT (Push To Talk) status."""
        try:
            ptt_value = 1 if ptt_on else 0
            command = f"T {ptt_value}"
            response = await self._send_command(command)

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set PTT command failed: {response}")
                    return False

            return True

        except Exception as e:
            self.logger.error(f"Error setting PTT: {e}")
            raise RuntimeError(f"Error setting PTT: {e}")

    async def get_split_vfo(self) -> bool:
        """Get split VFO status."""
        try:
            response = await self._send_command("s")

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting split VFO: {response}")
                return False

            elif response.startswith("get_split_vfo:"):
                split_str = response.split(":")[1].strip()
                return split_str == "1"

            else:
                return response.strip() == "1"

        except Exception as e:
            self.logger.error(f"Error getting split VFO: {e}")
            raise RuntimeError(f"Error getting split VFO: {e}")

    async def set_split_vfo(self, split_on: bool) -> bool:
        """Set split VFO status."""
        try:
            split_value = 1 if split_on else 0
            command = f"S {split_value}"
            response = await self._send_command(command)

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set split VFO command failed: {response}")
                    return False

            return True

        except Exception as e:
            self.logger.error(f"Error setting split VFO: {e}")
            raise RuntimeError(f"Error setting split VFO: {e}")

    async def get_vfo_frequency_and_mode(self, vfo: str) -> Tuple[float, str, int]:
        """Get frequency and mode for a specific VFO.

        Args:
            vfo: VFO identifier ("1" for VFOA, "2" for VFOB)

        Returns:
            Tuple of (frequency, mode, bandwidth)
        """
        # Map VFO string to rigctld VFO name
        vfo_map = {
            "1": "VFOA",
            "2": "VFOB",
            "none": "VFOA",
        }
        rigctld_vfo = vfo_map.get(vfo, "VFOA")

        try:
            # Set the VFO
            await self.set_vfo(rigctld_vfo)

            # Get frequency and mode
            frequency = await self.get_frequency()
            mode, bandwidth = await self.get_mode()

            return frequency, mode, bandwidth

        except Exception as e:
            self.logger.error(f"Error getting VFO {vfo} frequency and mode: {e}")
            return 0.0, "UNKNOWN", 0

    async def get_info(self) -> str:
        """Get rig information."""
        try:
            response = await self._send_command("_")
            return response

        except Exception as e:
            self.logger.error(f"Error getting rig info: {e}")
            raise RuntimeError(f"Error getting rig info: {e}")

    async def set_conf(self, parameter: str, value: str) -> bool:
        """Set a configuration parameter."""
        try:
            command = f"set_conf {parameter} {value}"
            response = await self._send_command(command)

            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set configuration failed: {response}")
                    return False

            return True

        except Exception as e:
            self.logger.error(f"Error setting configuration: {e}")
            raise RuntimeError(f"Error setting configuration: {e}")

    async def get_conf(self, parameter: str) -> str:
        """Get a configuration parameter."""
        try:
            command = f"get_conf {parameter}"
            response = await self._send_command(command)
            return response

        except Exception as e:
            self.logger.error(f"Error getting configuration: {e}")
            raise RuntimeError(f"Error getting configuration: {e}")

    def __del__(self) -> None:
        """Destructor - ensure we disconnect when the object is garbage collected."""
        if hasattr(self, "connected") and self.connected and self.writer is not None:
            # Just log a warning
            if hasattr(self, "logger"):
                self.logger.warning(
                    "Object RigController being destroyed while still connected to rig"
                )

            # Close the writer (synchronously)
            try:
                self.writer.close()
            except Exception:
                # Just ignore errors in destructor
                pass

    @staticmethod
    def get_error_message(error_code: int) -> str:
        """Map error codes to messages."""
        error_messages = {
            0: "No error",
            -1: "Invalid parameter",
            -2: "Invalid configuration",
            -3: "Memory shortage",
            -4: "Function not implemented",
            -5: "Communication timed out",
            -6: "IO error",
            -7: "Internal error",
            -8: "Protocol error",
            -9: "Command rejected",
            -10: "String truncated",
            -11: "Function not available",
            -12: "Target not available",
            -13: "Bus error",
            -14: "Bus busy",
            -15: "Invalid argument",
            -16: "Invalid VFO",
            -17: "Argument out of domain",
        }

        return error_messages.get(error_code, f"Unknown error code: {error_code}")
