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
import math
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional, Tuple

from common.arguments import arguments as args


class StopRejected(RuntimeError):
    """The controller explicitly rejected the standard Hamlib Stop."""


class StopUnconfirmed(RuntimeError):
    """No valid acknowledgement was received; physical motion is uncertain."""


class RotatorController:
    def __init__(
        self,
        model: Optional[int] = None,  # Model no longer used directly
        host: str = "127.0.0.1",
        port: int = 4533,
        verbose: bool = False,
        timeout: float = 10.0,
    ):
        # Set up logging
        device_path = f"{host}:{port}"
        self.logger = logging.getLogger("rotator-control")
        self.logger.setLevel(args.log_level)
        self.logger.info(f"Initializing RotatorController with device={device_path}")

        # Initialize attributes
        self.host = host
        self.port = port
        self.device_path = device_path
        self.verbose = verbose
        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self.connected = False
        self.timeout = timeout

    async def connect(self) -> bool:
        if self.connected:
            self.logger.warning("Already connected to rotator")
            return True

        try:
            # First ping the rotator to ensure it's responsive
            pingcheck = await self.ping()
            assert pingcheck, "Rotator did not respond to ping"

            self.logger.debug(f"Connecting to rotator at {self.device_path}")

            # Create a persistent connection
            reader_writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=self.timeout
            )
            self.reader, self.writer = reader_writer

            self.connected = True
            self.logger.info(f"Successfully connected to rotator as {self.device_path}")
            return True

        except Exception as e:
            self.logger.error(f"Error connecting to rotator: {e}")
            raise RuntimeError(f"Error connecting to rotator: {e}")

    async def disconnect(self) -> bool:
        if not self.connected or self.writer is None:
            self.logger.warning("Not connected to rotator")
            return True

        try:
            # Send a quit command (optional)
            try:
                await self._send_command("q", waitforreply=False)
            except Exception as e:
                self.logger.warning(f"Error sending quit command: {e}")

            await self.close()
            self.logger.info("Disconnected from rotator")
            return True

        except Exception as e:
            self.logger.error(f"Error disconnecting from rotator: {e}")
            return False

    async def close(self):
        """Discard the transport without sending anything on an uncertain stream."""
        writer = self.writer
        self.connected = False
        self.reader = self.writer = None
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
            except (OSError, asyncio.TimeoutError):
                pass

    async def recover_position(self) -> Tuple[float, float]:
        """Try one fresh connection and require actual coordinates before recovery."""
        await self.close()
        try:
            # Bound the whole recovery attempt, including opening the connection.
            async with asyncio.timeout(self.timeout):
                self.reader, self.writer = await asyncio.open_connection(self.host, self.port)
                self.connected = True
                return await self.get_position()
        except BaseException:
            await self.close()
            raise

    @asynccontextmanager
    async def _create_connection(self):
        """Creates a temporary connection if not already connected."""
        if self.connected and self.reader is not None and self.writer is not None:
            # Use an existing connection
            yield self.reader, self.writer
        else:
            # Create a temporary connection
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
        """Send a command to the rotator and get the response."""
        self.check_connection()

        if self.writer is None or self.reader is None:
            raise RuntimeError("Writer or reader is None")

        try:
            # Add newline to the command
            full_command = f"{command}\n"

            # Bound unsupported Stop replies without shortening other commands
            # or overriding a caller's explicitly shorter timeout.
            timeout = min(self.timeout, 5.0) if command == "S" else self.timeout
            async with asyncio.timeout(timeout):
                self.writer.write(full_command.encode("utf-8"))
                await self.writer.drain()
                response = "(no wait for reply)"
                if waitforreply:
                    # TCP packets are not protocol messages. Read complete lines
                    # so a fragmented reply cannot become the next command's ACK.
                    response_bytes = await self.reader.readline()
                    if not response_bytes:
                        raise ConnectionError("Controller closed the connection")
                    response = response_bytes.decode("utf-8", errors="replace").strip()
                    if (
                        command == "p"
                        and not response.startswith(("RPRT", "get_pos:"))
                        and len(response.split()) == 1
                    ):
                        second = await self.reader.readline()
                        if not second:
                            raise ConnectionError("Incomplete position reply")
                        response += " " + second.decode("utf-8", errors="replace").strip()

            if self.verbose:
                self.logger.debug(f"Command: {command} -> Response: {response}")

            return response

        except Exception as e:
            self.logger.error(f"Error sending command '{command}': {e}")
            raise RuntimeError(
                f"Error communicating with rotator: {str(e) or type(e).__name__}"
            ) from e

    async def ping(self):
        try:
            # Use the async connection manager
            async with self._create_connection() as (reader, writer):
                # Send position query command
                writer.write(b"p\n")
                await writer.drain()

                # Receive response with timeout
                response_bytes = await asyncio.wait_for(reader.read(1000), timeout=self.timeout)

                response = response_bytes.decode("utf-8", errors="replace").strip()

                # Parse the response
                if not response:
                    return False

                # Handle different response formats
                if response.startswith("RPRT"):
                    error_code = int(response.split()[1])
                    return error_code >= 0

                elif response.startswith("get_pos:"):
                    parts = response.split(":")[1].strip().split()
                    if len(parts) >= 2:
                        try:
                            float(parts[0])
                            float(parts[1])
                            return True
                        except ValueError:
                            return False
                    return False

                else:
                    parts = response.split()
                    if len(parts) >= 2:
                        try:
                            float(parts[0])
                            float(parts[1])
                            return True
                        except ValueError:
                            return False
                    return False

        except (asyncio.TimeoutError, ConnectionRefusedError, OSError) as e:
            # Handle all connection-related errors
            self.logger.exception(e)
            return False

        except Exception as e:
            # Catch all other exceptions
            self.logger.exception(e)
            return False

    async def get_position(self) -> Tuple[float, float]:
        """Get the current azimuth and elevation."""
        try:
            response = await self._send_command("p")

            # Handle various response formats
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    raise RuntimeError(f"Error getting position: {response}")
                raise RuntimeError(f"Position reply contained no coordinates: {response}")

            elif response.startswith("get_pos:"):
                parts = response.split(":")[1].strip().split()
                if len(parts) >= 2:
                    az = float(parts[0])
                    el = float(parts[1])
                    if not (math.isfinite(az) and math.isfinite(el)):
                        raise ValueError("Non-finite position coordinates")
                    self.logger.debug(f"Current position: az={az}, el={el}")
                    return round(az, 3), round(el, 3)
                raise RuntimeError(f"Invalid position format: {response}")

            else:
                # Try to parse as direct values
                parts = response.split()
                if len(parts) >= 2:
                    try:
                        az = float(parts[0])
                        el = float(parts[1])
                        if not (math.isfinite(az) and math.isfinite(el)):
                            raise ValueError("Non-finite position coordinates")
                        self.logger.debug(f"Current position: az={az}, el={el}")
                        return round(az, 3), round(el, 3)
                    except ValueError:
                        raise RuntimeError(f"Invalid position values: {response}")
                raise RuntimeError(f"Invalid position format: {response}")

        except Exception as e:
            self.logger.error(f"Error getting position: {e}")
            raise RuntimeError(f"Error getting position: {e}")

    async def park(self, park_az=None, park_el=None) -> bool:
        """Park the rotator."""
        try:
            if (park_az is None) != (park_el is None):
                raise ValueError("park_az and park_el must either both be set or both be null")

            if park_az is not None and park_el is not None:
                self.logger.info(
                    "Parking rotator using configured target az=%s el=%s", park_az, park_el
                )
                response = await self._send_command(f"P {park_az} {park_el}")
            else:
                self.logger.info("Parking rotator using hardware-native park command")
                # Consume K's acknowledgement before polling position on this
                # stream; an unread RPRT would corrupt the next position reply.
                response = await self._send_command("K")

            # Check response
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Park command failed: {response}")
                    return False

            self.logger.info(f"Park command: response={response}")
            return True

        except Exception as e:
            self.logger.error(f"Error parking rotator: {e}")
            raise RuntimeError(f"Error parking rotator: {e}")

    def check_connection(self) -> bool:
        """Check if connected to the rotator."""
        if not self.connected or self.writer is None or self.reader is None:
            error_msg = f"Not connected to rotator (connected: {self.connected})"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)
        return True

    async def set_position(
        self,
        target_az: float,
        target_el: float,
        update_interval: float = 2,
        az_tolerance: float = 1.0,
        el_tolerance: float = 1.0,
    ) -> AsyncGenerator[Tuple[float, float, bool], None]:
        """Set the rotator position and yield updates until it reaches the target."""
        # Start the slew operation
        try:
            self.logger.debug(f"Setting rotator position to az={target_az}, el={target_el}")

            # Format the set position command
            command = f"P {target_az} {target_el}"
            response = await self._send_command(command)

            # Check the response
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    error_msg = f"Failed to set position: {response}"
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg)

            self.logger.debug(f"Set position command: response={response}")

        except Exception as e:
            self.logger.error(f"Error setting rotator position: {e}")
            self.logger.exception(e)
            raise RuntimeError(f"Error setting rotator position: {e}")

        # Initial status
        current_az, current_el = await self.get_position()
        az_reached = abs(current_az - target_az) <= az_tolerance
        el_reached = abs(current_el - target_el) <= el_tolerance
        is_slewing = not (az_reached and el_reached)

        # First yield with the initial position
        yield current_az, current_el, is_slewing

        # Keep checking position until target is reached
        while is_slewing:
            # Get the current position
            current_az, current_el = await self.get_position()

            # Check if we've reached the target
            az_reached = abs(current_az - target_az) <= az_tolerance
            el_reached = abs(current_el - target_el) <= el_tolerance
            is_slewing = not (az_reached and el_reached)

            # Yield the current position and slewing status
            yield current_az, current_el, is_slewing

    async def stop(self) -> bool:
        """Send standard Hamlib S and require its explicit acknowledgement."""
        try:
            response = await self._send_command("S")
        except Exception as e:
            raise StopUnconfirmed(f"Controller did not acknowledge Hamlib Stop: {e}") from e
        parts = response.split()
        if len(parts) == 2 and parts[0] == "RPRT":
            try:
                code = int(parts[1])
            except ValueError:
                code = None
            if code == 0:
                return True
            if code is not None and code < 0:
                raise StopRejected(f"Controller rejected Hamlib Stop ({response})")
        raise StopUnconfirmed(f"Invalid Hamlib Stop acknowledgement: {response!r}")

    async def set_rotation_speed(self, speed: float) -> bool:
        """Set the rotation speed."""
        try:
            command = f"R {speed}"
            response = await self._send_command(command)

            # Check response
            if response.startswith("RPRT"):
                error_code = int(response.split()[1])
                if error_code < 0:
                    self.logger.error(f"Set speed command failed: {response}")
                    return False

            self.logger.info(f"Set speed command: response={response}")
            return True

        except Exception as e:
            self.logger.error(f"Error setting rotation speed: {e}")
            raise RuntimeError(f"Error setting rotation speed: {e}")

    async def get_info(self) -> str:
        """Get rotator information."""
        try:
            response = await self._send_command("_")
            return response

        except Exception as e:
            self.logger.error(f"Error getting rotator info: {e}")
            raise RuntimeError(f"Error getting rotator info: {e}")

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
        """Destructor - log a warning if still connected when object is garbage collected."""
        if hasattr(self, "connected") and self.connected and hasattr(self, "logger"):
            try:
                # Just log a warning rather than trying to run async code
                self.logger.warning(
                    "Object RotatorController being garbage collected while still connected"
                )

                # If there's a synchronous way to close the underlying connection, use it
                if hasattr(self, "writer") and self.writer is not None:
                    try:
                        # Only close the writer synchronously
                        self.writer.close()
                    except Exception as e:
                        self.logger.error(f"Error during cleanup: {e}")
            except Exception:
                # Avoid any exceptions in __del__
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
