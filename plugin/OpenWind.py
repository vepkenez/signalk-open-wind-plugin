import socket
import json
import os
import time
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

OPENWIND_WIND_CHARACTERISTIC_UUID = '0000cc91-0000-1000-8000-00805f9b34fb'
OPENWIND_MOV_ENABLE_CHARACTERISTIC_UUID = '0000aa82-0000-1000-8000-00805f9b34fb'
OPENWIND_FW_CHARACTERISTIC_UUID = '00002a26-0000-1000-8000-00805f9b34fb'

DEVICE_NAME = "OpenWind"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.openwind_cache.json')
CONNECTION_TIMEOUT = 15.0

fw_number = "0"
cached_address = None


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
    found_event = asyncio.Event()
    result = {}

    def detection_callback(device: BLEDevice, advertisement_data: AdvertisementData):
        if device.name == DEVICE_NAME:
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
    print("Started receiving OpenWind data...")


async def stream_until_disconnect(client):
    """Keep connection alive until disconnect."""
    disconnected = asyncio.Event()

    def on_disconnect(_):
        print(f"OpenWind disconnected")
        disconnected.set()

    client.set_disconnected_callback(on_disconnect)

    await disconnected.wait()


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


async def run():
    global cached_address

    if not HAS_BLE:
        await simulate()
        return

    load_cache()
    retry_delay = 1.0
    scan_failures = 0

    while True:
        client = None
        try:
            # If we have a cached address, try direct connection first
            if cached_address:
                client = await try_direct_connect(cached_address)

            # Fall back to scanning
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
            await setup_streaming(client)
            save_cache(address, fw_number)

            await stream_until_disconnect(client)

            print("Connection lost, reconnecting in 0.5s...")
            await asyncio.sleep(0.5)

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


def main():
    asyncio.run(run())

if __name__ == "__main__":
    main()
