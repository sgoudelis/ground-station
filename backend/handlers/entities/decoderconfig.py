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

"""Decoder configuration handlers."""

from typing import Any, Dict, Optional, Union

from pipeline.config.decoderconfigservice import decoder_config_service


async def get_decoder_config(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Get decoder configuration for a satellite/transmitter combination.

    This handler exposes the DecoderConfigService to the UI, allowing clients
    to query decoder parameters before starting a decoder. Useful for:
    - Displaying recommended configurations in UI dropdowns
    - Validating parameters before decoder instantiation
    - Showing configuration sources (gr-satellites, metadata, defaults)

    Args:
        sio: Socket.IO server instance
        data: Configuration request containing:
            - decoder_type (required): 'gmsk', 'bpsk', 'aprs', 'gfsk', 'fsk', 'geoscanimage', 'gnss'
            - satellite (optional): {'norad_id': int, 'name': str, ...}
            - transmitter (optional): {'baud': int, 'deviation': int, 'mode': str, 'description': str, ...}
            - overrides (optional): Manual parameter overrides dict
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and decoder configuration:
        {
            "success": bool,
            "data": {
                "baudrate": int,
                "framing": str,
                "config_source": str,
                "deviation": int,
                "af_carrier": int,
                "differential": bool,
                ...
            },
            "error": str  # Only present on failure
        }

    Examples:
        # Request for GMSK satellite with gr-satellites config
        {
            "decoder_type": "gmsk",
            "satellite": {"norad_id": 43803, "name": "FOX-1E"},
            "transmitter": {"baud": 9600, "downlink_low": 145920000}
        }
        → Returns config from gr-satellites database

        # Request with manual overrides
        {
            "decoder_type": "fsk",
            "transmitter": {"baud": 9600},
            "overrides": {"framing": "ax25", "deviation": 5000}
        }
        → Returns config with manual overrides applied

    """
    logger.debug(f"Getting decoder config, data: {data}")

    # Validate input
    if not data:
        return {
            "success": False,
            "error": "Missing request data",
        }

    decoder_type = data.get("decoder_type")
    if not decoder_type:
        return {
            "success": False,
            "error": "Missing required field: decoder_type",
        }

    # Validate decoder type
    valid_types = [
        "gmsk",
        "bpsk",
        "aprs",
        "gfsk",
        "fsk",
        "geoscanimage",
        "gnss",
        "lora",
        "radiosonde",
    ]
    if decoder_type not in valid_types:
        return {
            "success": False,
            "error": f"Invalid decoder_type '{decoder_type}'. Must be one of: {', '.join(valid_types)}",
        }

    try:
        # Extract optional parameters
        satellite = data.get("satellite")
        transmitter = data.get("transmitter")
        overrides = data.get("overrides")
        # Get configuration from service
        config = decoder_config_service.get_config(
            decoder_type=decoder_type,
            satellite=satellite,
            transmitter=transmitter,
            overrides=overrides,
        )

        # Convert to dict for JSON serialization
        config_dict = config.to_dict()

        logger.info(
            f"Resolved {decoder_type.upper()} config from {config.config_source}: "
            f"baudrate={config.baudrate}, framing={config.framing}, "
            f"deviation={config.deviation}, source={config.config_source}"
        )

        return {
            "success": True,
            "data": config_dict,
        }

    except Exception as e:
        logger.error(f"Failed to get decoder config: {e}", exc_info=True)
        return {
            "success": False,
            "error": f"Failed to resolve decoder configuration: {str(e)}",
        }


async def get_decoder_configs_batch(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Get decoder configurations for multiple satellite/transmitter combinations.

    Useful for:
    - Preloading configurations for all transmitters of a satellite
    - Batch validation of configurations
    - UI dropdowns showing multiple configuration options

    Args:
        sio: Socket.IO server instance
        data: Batch request containing:
            - requests: List of configuration requests (same format as get_decoder_config)
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and list of configurations:
        {
            "success": bool,
            "data": [
                {"success": bool, "data": {...}, "error": str},
                ...
            ]
        }

    Example:
        {
            "requests": [
                {
                    "decoder_type": "gmsk",
                    "satellite": {"norad_id": 43803},
                    "transmitter": {"baud": 9600}
                },
                {
                    "decoder_type": "bpsk",
                    "satellite": {"norad_id": 43803},
                    "transmitter": {"baud": 1200}
                }
            ]
        }
        → Returns list of configs, one per request
    """
    logger.debug(f"Getting decoder configs batch, data: {data}")

    # Validate input
    if not data:
        return {
            "success": False,
            "error": "Missing request data",
        }

    requests = data.get("requests")
    if not requests or not isinstance(requests, list):
        return {
            "success": False,
            "error": "Missing or invalid 'requests' field (must be a list)",
        }

    if len(requests) > 100:
        return {
            "success": False,
            "error": "Too many requests (max 100 per batch)",
        }

    try:
        results = []

        for i, request in enumerate(requests):
            try:
                # Process each request individually
                result = await get_decoder_config(sio, request, logger, sid)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to process batch request {i}: {e}")
                results.append(
                    {
                        "success": False,
                        "error": f"Request {i} failed: {str(e)}",
                    }
                )

        logger.info(f"Processed {len(results)} decoder config requests")

        return {
            "success": True,
            "data": results,
        }

    except Exception as e:
        logger.error(f"Failed to process batch decoder config request: {e}", exc_info=True)
        return {
            "success": False,
            "error": f"Batch request failed: {str(e)}",
        }


def register_handlers(registry):
    """Register decoder configuration handlers with the command registry."""
    registry.register_batch(
        {
            "get-decoder-config": (get_decoder_config, "api_call"),
            "get-decoder-configs-batch": (get_decoder_configs_batch, "api_call"),
        }
    )
