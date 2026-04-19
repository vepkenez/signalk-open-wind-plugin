import socket
import json
import os
import sys
import math
import asyncio

try:
    from bleak import BleakClient, BleakScanner
    from bleak.backends.device import BLEDevice
    from bleak.backends.scanner import AdvertisementData
    HAS_BLE = True
except ImportError:
    HAS_BLE = False

UDP_IP = "127.0.0.1"
UDP_PORT = 2000

# OpenWind "Broadcast Data" — Manufacturer Specific Data (AD type 0xFF).
# See OpenWind-Bluetooth-Data_v04.pdf §5 (Company ID 0x000F or 0x00D0).
OPENWIND_MANUFACTURER_IDS = (0x000F, 0x00D0)

# GATT (legacy --ble-gatt mode)
OPENWIND_WIND_CHARACTERISTIC_UUID = '0000cc91-0000-1000-8000-00805f9b34fb'
OPENWIND_MOV_ENABLE_CHARACTERISTIC_UUID = '0000aa82-0000-1000-8000-00805f9b34fb'
OPENWIND_FW_CHARACTERISTIC_UUID = '00002a26-0000-1000-8000-00805f9b34fb'
DEVICE_NAME = "OpenWind"
CONNECTION_TIMEOUT = 15.0

CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.openwind_cache.json')
RECONNECT_DELAY_DEFAULT = 15.0

fw_number = "0"
cached_address = None
_connected_message_sent = False


def make_udp_socket():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setblocking(False)
    return s

udp_sock = make_udp_socket()

def socket_send(msg):
    global udp_sock
    try:
        udp_sock.sendto(msg.encode('utf-8'), (UDP_IP, UDP_PORT))
    except OSError:
        try:
            udp_sock.close()
        except OSError:
            pass
        udp_sock = make_udp_socket()
        try:
            udp_sock.sendto(msg.encode('utf-8'), (UDP_IP, UDP_PORT))
        except OSError:
            pass


def load_cache():
    global cached_address, fw_number
    try:
        with open(CACHE_FILE, 'r') as f:
            data = json.load(f)
            cached_address = data.get('address')
            fw = data.get('fw_number')
            if fw:
                fw_number = fw
            if cached_address:
                print(f"Loaded cached device address: {cached_address}")
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass

def save_cache(address, fw):
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump({'address': address, 'fw_number': fw}, f)
    except OSError:
        pass


def addr_fingerprint(addr: str) -> str:
    """Normalize MAC or CoreBluetooth UUID for comparison."""
    if not addr:
        return ''
    return ''.join(c for c in addr.upper() if c.isalnum())


def addrs_match(a: str, b: str) -> bool:
    return addr_fingerprint(a) == addr_fingerprint(b)


def parse_ble_device_id() -> str:
    """Optional --ble-device-id <id> from plugin config (pick one of several OpenWinds)."""
    try:
        idx = sys.argv.index('--ble-device-id')
        return sys.argv[idx + 1].strip()
    except (ValueError, IndexError):
        return ''


def emit_ble_device_address_line(addr: str):
    """Single-line token for the Node bridge / webapp (do not translate)."""
    if addr:
        print("BLE_DEVICE_ADDRESS " + str(addr))


def apply_ble_binding():
    """Load cache, then override with --ble-device-id when provided."""
    global cached_address
    load_cache()
    arg = parse_ble_device_id()
    if arg:
        cached_address = arg
        print(f"Using configured OpenWind BLE id (only this device): {cached_address}")
    emit_ble_device_address_line(cached_address or '')


def advert_might_be_openwind(device: BLEDevice, adv: AdvertisementData) -> bool:
    """Cheap filter before parsing manufacturer payload (discovery mode)."""
    md = adv.manufacturer_data
    if md:
        for cid in md:
            if cid in OPENWIND_MANUFACTURER_IDS:
                return True
        for blob in md.values():
            if len(blob) >= 2 and int.from_bytes(blob[0:2], 'little') in OPENWIND_MANUFACTURER_IDS:
                return True
    for u in adv.service_uuids or ():
        if u and '0000cc90' in u.lower():
            return True
    for name in (adv.local_name, device.name):
        if name and DEVICE_NAME.lower() in name.lower():
            return True
    return False


def WIND_DATA_CALLBACK(sender, data):
    global fw_number

    AWA = float((data[2] << 8) | data[1]) * 0.1
    AWS = float((data[4] << 8) | data[3]) * 0.01

    print(f"AWA: {AWA:.1f}° AWS: {AWS:.1f} kts")

    socket_send(f"$WIMWV,{AWA:.1f},R,{AWS:.1f},N,A*\n")

    try:
        if float(fw_number) >= 1.25:
            YAW = float((data[6] << 8) | data[5]) * 1/16 - 90
            socket_send(f"RAWYAW: {YAW:.1f}°\n")

            if YAW < 0:
                YAW = 360 + YAW

            print(f"YAW: {YAW:.1f}°")
            socket_send(f"$WIHDM,{YAW:.1f},M*\n")
    except (ValueError, IndexError):
        pass


async def try_direct_connect(address):
    """Try connecting directly to a known address without scanning."""
    print(f"Trying direct connect to {address}...")
    try:
        client = BleakClient(address, timeout=CONNECTION_TIMEOUT)
        await client.connect()
        if client.is_connected:
            print(f"Direct connect succeeded: {address}")
            return client
    except Exception as e:
        print(f"Direct connect failed: {e}")
    return None


async def find_device(timeout=10.0):
    """Scan until OpenWind is found or timeout expires."""
    global cached_address
    found_event = asyncio.Event()
    result = {}

    def detection_callback(device: BLEDevice, advertisement_data: AdvertisementData):
        if device.name != DEVICE_NAME:
            return
        if cached_address and not addrs_match(device.address, cached_address):
            return
        result['device'] = device
        found_event.set()

    scanner = BleakScanner(detection_callback)
    print("Scanning for OpenWind device...")
    await scanner.start()
    try:
        await asyncio.wait_for(found_event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass
    await scanner.stop()

    if 'device' in result:
        print(f"Found OpenWind device: {result['device'].address}")
        return result['device']
    print("OpenWind device not found")
    return None


async def setup_streaming(client):
    """Read firmware (if needed) and start notifications."""
    global fw_number

    if fw_number == "0":
        raw_fw = await client.read_gatt_char(OPENWIND_FW_CHARACTERISTIC_UUID)
        fw_number = "".join(map(chr, raw_fw)).strip()
        print(f"Firmware version: {fw_number}")

    write_value = bytearray([0x2C])
    await client.write_gatt_char(OPENWIND_MOV_ENABLE_CHARACTERISTIC_UUID, write_value)
    await asyncio.sleep(0.3)

    await client.start_notify(OPENWIND_WIND_CHARACTERISTIC_UUID, WIND_DATA_CALLBACK)
    print("Started receiving OpenWind data (GATT notifications)...")


async def stream_until_disconnect(client):
    """Keep connection alive until disconnect."""
    disconnected = asyncio.Event()

    def on_disconnect(_):
        print("OpenWind disconnected")
        disconnected.set()

    client.set_disconnected_callback(on_disconnect)

    await disconnected.wait()


async def run_gatt_mode():
    """Legacy: exclusive GATT connection and wind characteristic notifications."""
    global cached_address, fw_number

    reconnect_delay = parse_reconnect_delay()
    apply_ble_binding()
    retry_delay = 1.0
    scan_failures = 0

    while True:
        client = None
        try:
            if cached_address:
                client = await try_direct_connect(cached_address)

            if client is None:
                device = await find_device(timeout=10.0)
                if device is None:
                    scan_failures += 1
                    delay = min(retry_delay * (1.5 ** min(scan_failures, 6)), 30.0)
                    print(f"Retrying in {delay:.0f}s...")
                    await asyncio.sleep(delay)
                    continue

                scan_failures = 0
                cached_address = device.address

                client = BleakClient(device.address, timeout=CONNECTION_TIMEOUT)
                await client.connect()

            if not client.is_connected:
                print("Connection failed")
                await asyncio.sleep(retry_delay)
                continue

            retry_delay = 1.0
            address = client.address
            print("Connected to OpenWind (GATT)")
            emit_ble_device_address_line(address)
            await setup_streaming(client)
            save_cache(address, fw_number)

            await stream_until_disconnect(client)

            print(f"Connection lost, reconnecting in {reconnect_delay:.0f}s...")
            await asyncio.sleep(reconnect_delay)

        except Exception as e:
            print(f"Error: {e}")
            if client:
                try:
                    await client.disconnect()
                except Exception:
                    pass
            delay = min(retry_delay * 1.5, 15.0)
            retry_delay = delay
            print(f"Retrying in {delay:.0f}s...")
            await asyncio.sleep(delay)


def get_openwind_broadcast_payload(adv: AdvertisementData):
    """
    Return manufacturer payload bytes after the 16-bit company ID (wind fields
    start at index 0). Bleak usually keys manufacturer_data by company ID
    and omits those two bytes from the value; if they are duplicated, strip them.
    Some stacks use a generic key but still include the OpenWind company bytes.
    """
    md = adv.manufacturer_data
    if not md:
        return None
    for cid in OPENWIND_MANUFACTURER_IDS:
        if cid not in md:
            continue
        data = md[cid]
        if len(data) >= 2 and int.from_bytes(data[0:2], 'little') == cid:
            data = data[2:]
        if len(data) >= 4:
            return data
    for data in md.values():
        if len(data) >= 4:
            prefix = int.from_bytes(data[0:2], 'little')
            if prefix in OPENWIND_MANUFACTURER_IDS:
                return data[2:]
    return None


def send_wind_from_broadcast_payload(payload: bytes):
    """
    Broadcast layout after company ID (big-endian uint16s per OpenWind spec):
      [0:2] AWA * 0.1 °, [2:4] AWS * 0.01 kn, [4:6] yaw int16 * 1/16 - 90 °
    """
    if len(payload) < 4:
        return

    awa = float((payload[0] << 8) | payload[1]) * 0.1
    aws = float((payload[2] << 8) | payload[3]) * 0.01

    print(f"AWA: {awa:.1f}° AWS: {aws:.1f} kts")
    socket_send(f"$WIMWV,{awa:.1f},R,{aws:.1f},N,A*\n")

    if len(payload) < 6:
        return

    yaw_raw = (payload[4] << 8) | payload[5]
    if yaw_raw >= 32768:
        yaw_raw -= 65536
    yaw = float(yaw_raw) * (1.0 / 16.0) - 90.0
    socket_send(f"RAWYAW: {yaw:.1f}°\n")

    if yaw < 0:
        yaw = 360 + yaw

    print(f"YAW: {yaw:.1f}°")
    socket_send(f"$WIHDM,{yaw:.1f},M*\n")


async def run_ble_broadcast_loop():
    """
    Receive wind (and yaw) from BLE advertisements only — no GATT connection.
    Multiple clients can read the broadcast; one connection is not required.
    """
    global cached_address, _connected_message_sent

    def on_detection(device: BLEDevice, adv: AdvertisementData):
        global cached_address, _connected_message_sent

        # When we already know which sensor to use, drop every other device first
        # (no manufacturer parsing).
        if cached_address and not addrs_match(device.address, cached_address):
            return

        if not advert_might_be_openwind(device, adv):
            return

        payload = get_openwind_broadcast_payload(adv)
        if payload is None:
            return

        if not cached_address:
            cached_address = device.address
            save_cache(cached_address, fw_number)
            print(f"Found OpenWind device: {device.address}")
            emit_ble_device_address_line(cached_address)

        if not _connected_message_sent:
            print("Connected to OpenWind (BLE broadcast)")
            _connected_message_sent = True

        send_wind_from_broadcast_payload(payload)

    scanner = BleakScanner(on_detection)
    print("Scanning for OpenWind device...")
    await scanner.start()
    print("Started receiving OpenWind data (BLE advertisements)...")
    try:
        while True:
            await asyncio.sleep(3600.0)
    finally:
        await scanner.stop()
        print("OpenWind disconnected")


async def simulate():
    """Send simulated wind data over UDP when BLE is not available."""
    print("Running in simulation mode (BLE libraries not installed)")
    t = 0.0
    while True:
        awa = (90.0 + math.sin(t / 10.0) * 80.0) % 360.0
        aws = 10.0 * 0.5 * (math.sin(t) + 1.0)
        yaw = (180.0 + math.sin(t / 15.0) * 10.0) % 360.0

        socket_send(f"$WIMWV,{awa:.1f},R,{aws:.1f},N,A*\n")
        socket_send(f"$WIHDM,{yaw:.1f},M*\n")

        t += 0.1
        await asyncio.sleep(1.0)


def parse_reconnect_delay():
    """Parse --reconnect-delay <seconds> from sys.argv, falling back to RECONNECT_DELAY_DEFAULT."""
    try:
        idx = sys.argv.index('--reconnect-delay')
        return float(sys.argv[idx + 1])
    except (ValueError, IndexError):
        return RECONNECT_DELAY_DEFAULT


def use_gatt_mode():
    """GATT is disabled whenever --broadcast-only is present (plugin default)."""
    if '--broadcast-only' in sys.argv:
        if '--ble-gatt' in sys.argv:
            print('Ignoring --ble-gatt because --broadcast-only is set (broadcast-only mode).')
        return False
    return '--ble-gatt' in sys.argv


async def run():
    global _connected_message_sent

    if '--simulate' in sys.argv or not HAS_BLE:
        await simulate()
        return

    if use_gatt_mode():
        await run_gatt_mode()
        return

    reconnect_delay = parse_reconnect_delay()
    apply_ble_binding()
    retry_delay = 1.0

    while True:
        _connected_message_sent = False
        try:
            await run_ble_broadcast_loop()
        except Exception as e:
            print(f"Error: {e}")
            delay = min(retry_delay * 1.5, 30.0)
            retry_delay = delay
            wait = max(delay, reconnect_delay)
            print(f"Retrying in {wait:.0f}s...")
            await asyncio.sleep(wait)


def main():
    asyncio.run(run())

if __name__ == "__main__":
    main()
