#!/usr/bin/env python3
"""
Log BLE advertisements and detect OpenWind (broadcast manufacturer IDs
0x000F / 0x00D0 per OpenWind-Bluetooth-Data_v04, or local name "OpenWind").

  pip install bleak
  python3 scripts/ble-openwind-scan.py
  python3 scripts/ble-openwind-scan.py --duration 120 --output /tmp/ble.log
  python3 scripts/ble-openwind-scan.py --duration 0 --output /tmp/ble.log
  python3 scripts/ble-openwind-scan.py --all
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from bleak import BleakScanner
    from bleak.backends.device import BLEDevice
    from bleak.backends.scanner import AdvertisementData
except ImportError:
    print("Install bleak: pip install bleak", file=sys.stderr)
    sys.exit(1)

OPENWIND_MANUFACTURER_IDS = (0x000F, 0x00D0)
OPENWIND_NAME = "OpenWind"


def _hex(b: bytes) -> str:
    return b.hex() if b else ""


def openwind_payload_from_adv(adv: AdvertisementData) -> bytes | None:
    """Same rules as plugin/OpenWind.py get_openwind_broadcast_payload."""
    md = adv.manufacturer_data
    if not md:
        return None
    for cid in OPENWIND_MANUFACTURER_IDS:
        if cid not in md:
            continue
        data = md[cid]
        if len(data) >= 2 and int.from_bytes(data[0:2], "little") == cid:
            data = data[2:]
        if len(data) >= 4:
            return data
    for data in md.values():
        if len(data) >= 4:
            prefix = int.from_bytes(data[0:2], "little")
            if prefix in OPENWIND_MANUFACTURER_IDS:
                return data[2:]
    return None


def openwind_manufacturer_hit(adv: AdvertisementData) -> bool:
    if not adv.manufacturer_data:
        return False
    for cid in adv.manufacturer_data:
        if cid in OPENWIND_MANUFACTURER_IDS:
            return True
    for data in adv.manufacturer_data.values():
        if len(data) >= 2 and int.from_bytes(data[0:2], "little") in OPENWIND_MANUFACTURER_IDS:
            return True
    return False


def name_suggests_openwind(adv: AdvertisementData, device: BLEDevice) -> bool:
    for name in (adv.local_name, device.name):
        if name and OPENWIND_NAME.lower() in name.lower():
            return True
    return False


def decode_openwind_wind(payload: bytes) -> str | None:
    if len(payload) < 4:
        return None
    awa = ((payload[0] << 8) | payload[1]) * 0.1
    aws = ((payload[2] << 8) | payload[3]) * 0.01
    parts = [f"AWA={awa:.1f}°", f"AWS={aws:.1f}kn"]
    if len(payload) >= 6:
        yaw_raw = (payload[4] << 8) | payload[5]
        if yaw_raw >= 32768:
            yaw_raw -= 65536
        yaw = yaw_raw / 16.0 - 90.0
        if yaw < 0:
            yaw += 360.0
        parts.append(f"Yaw={yaw:.1f}°")
    return ", ".join(parts)


def format_advertisement(device: BLEDevice, adv: AdvertisementData) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    lines = [
        f"[{ts}] addr={device.address} rssi={adv.rssi}",
        f"  local_name={adv.local_name!r} device.name={device.name!r}",
    ]
    if adv.service_uuids:
        lines.append(f"  service_uuids={adv.service_uuids}")
    if adv.manufacturer_data:
        parts = []
        for cid, data in sorted(adv.manufacturer_data.items()):
            parts.append(f"0x{cid:04X}:{_hex(data)}")
        lines.append(f"  manufacturer_data={'; '.join(parts)}")
    else:
        lines.append("  manufacturer_data=(none)")
    payload = openwind_payload_from_adv(adv)
    is_ow_mfg = openwind_manufacturer_hit(adv)
    is_ow_name = name_suggests_openwind(adv, device)
    if is_ow_mfg or is_ow_name:
        lines.append("  *** OpenWind candidate (name and/or company ID) ***")
    if payload and (is_ow_mfg or is_ow_name):
        dec = decode_openwind_wind(payload)
        if dec:
            lines.append(f"  decoded_broadcast: {dec}")
        lines.append(f"  wind_payload_hex={_hex(payload)}")
    return "\n".join(lines) + "\n"


async def run_scan(args: argparse.Namespace) -> None:
    log_path: Path = args.output
    log_path.parent.mkdir(parents=True, exist_ok=True)
    throttle_s = max(0.0, args.throttle)
    ow_interval = max(0.05, args.openwind_throttle)
    last_log: dict[str, float] = {}
    last_ow: dict[str, float] = {}
    openwind_seen = False
    openwind_banner_printed = False

    def should_log(addr: str, is_openwind: bool) -> bool:
        if args.all:
            return True
        now = time.monotonic()
        if is_openwind:
            if now - last_ow.get(addr, 0.0) >= ow_interval:
                last_ow[addr] = now
                return True
            return False
        if throttle_s <= 0:
            return True
        prev = last_log.get(addr, 0.0)
        if now - prev >= throttle_s:
            last_log[addr] = now
            return True
        return False

    def on_detection(device: BLEDevice, adv: AdvertisementData) -> None:
        nonlocal openwind_seen, openwind_banner_printed
        is_ow = openwind_manufacturer_hit(adv) or name_suggests_openwind(adv, device)
        if not should_log(device.address, is_ow):
            return
        block = format_advertisement(device, adv)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(block)
        if is_ow:
            openwind_seen = True
            if not openwind_banner_printed:
                openwind_banner_printed = True
                print("\n" + "=" * 60)
                print("OPENWIND DETECTED (use --openwind-throttle 0 or --all for more frequent samples)")
                print("=" * 60)
        print(block, end="")

    print(f"Logging BLE advertisements to {log_path.resolve()}")
    if args.duration > 0:
        print(f"Scan duration: {args.duration}s (then exit)")
    else:
        print("Scan duration: unlimited (Ctrl+C to stop)")
    if not args.all:
        print(f"Non-OpenWind devices: at most one log line every {throttle_s}s per address")
        print(f"OpenWind: at most one log line every {ow_interval}s per address (use --openwind-throttle to change)")
    print("OpenWind = manufacturer 0x000F/0x00D0 and/or name containing 'OpenWind'\n")

    scanner = BleakScanner(on_detection)
    await scanner.start()
    try:
        if args.duration > 0:
            await asyncio.sleep(args.duration)
        else:
            await asyncio.Future()
    finally:
        await scanner.stop()

    if openwind_seen:
        print(f"OpenWind was seen during the scan. Full log: {log_path.resolve()}")
    else:
        print(f"No OpenWind match in this scan window. See all BLE traffic in: {log_path.resolve()}")


def main() -> None:
    p = argparse.ArgumentParser(description="Log BLE ads and detect OpenWind")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("ble-openwind-scan.log"),
        help="Append log file path (default: ./ble-openwind-scan.log)",
    )
    p.add_argument(
        "-d",
        "--duration",
        type=float,
        default=60.0,
        help="Seconds to scan (0 = until Ctrl+C). Default: 60",
    )
    p.add_argument(
        "--all",
        action="store_true",
        help="Log every advertisement for every device (very verbose)",
    )
    p.add_argument(
        "--throttle",
        type=float,
        default=10.0,
        help="Min seconds between logs for the same address when not OpenWind (default: 10)",
    )
    p.add_argument(
        "--openwind-throttle",
        type=float,
        default=0.25,
        help="Min seconds between logs for the same OpenWind address (default: 0.25)",
    )
    args = p.parse_args()
    try:
        asyncio.run(run_scan(args))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
